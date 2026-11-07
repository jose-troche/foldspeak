import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as baseEnv } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

import uniprotGfp from "./fixtures/upstream/uniprot-P42212.json";
import uniprotP53 from "./fixtures/upstream/uniprot-P04637.json";
import uniprotTitin from "./fixtures/upstream/uniprot-Q8WZ42.json";
import alphafoldGfp from "./fixtures/upstream/alphafold-P42212.json";
import alphafoldP53 from "./fixtures/upstream/alphafold-P04637.json";
import interproGfp from "./fixtures/upstream/interpro-P42212.json";
import interproP53 from "./fixtures/upstream/interpro-P04637.json";
import interproTitin from "./fixtures/upstream/interpro-Q8WZ42.json";
import pubmedGfp from "./fixtures/upstream/pubmed-P42212.json";
import pubmedP53 from "./fixtures/upstream/pubmed-P04637.json";
import pubmedTitin from "./fixtures/upstream/pubmed-Q8WZ42.json";
import searchP53 from "./fixtures/upstream/search-p53.json";
import searchP53Human from "./fixtures/upstream/search-p53-human.json";

export const UPSTREAM: Record<string, Record<string, unknown>> = {
  uniprot: { P42212: uniprotGfp, P04637: uniprotP53, Q8WZ42: uniprotTitin },
  alphafold: { P42212: alphafoldGfp, P04637: alphafoldP53 },
  interpro: { P42212: interproGfp, P04637: interproP53, Q8WZ42: interproTitin },
  pubmed: { P42212: pubmedGfp, P04637: pubmedP53, Q8WZ42: pubmedTitin },
};

export type Source = "uniprot" | "alphafold" | "interpro" | "pubmed" | "search" | "siteverify";

/** What each mocked source should do: serve its fixture, or fail in a particular way. */
export type Behaviour = "fixture" | "down" | "timeout" | "404" | "500" | ((url: string) => Response | Promise<Response>);

export function sourceOf(url: string): Source | null {
  const u = new URL(url);
  if (u.hostname === "rest.uniprot.org") return u.pathname.endsWith("/search") ? "search" : "uniprot";
  if (u.hostname === "alphafold.ebi.ac.uk") return "alphafold";
  if (u.hostname === "www.ebi.ac.uk") return "interpro";
  if (u.hostname === "eutils.ncbi.nlm.nih.gov") return "pubmed";
  if (u.hostname === "challenges.cloudflare.com") return "siteverify";
  return null;
}

function accessionOf(url: string, source: Source): string {
  const u = new URL(url);
  if (source === "pubmed") {
    // Map the PMIDs back to whichever fixture contains them.
    const ids = u.searchParams.get("id") ?? "";
    for (const [acc, body] of Object.entries(UPSTREAM.pubmed!)) {
      if (JSON.stringify(body).includes(`"${ids.split(",")[0]}"`)) return acc;
    }
    return "";
  }
  const parts = u.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Replace global fetch for upstream calls. The Worker under test runs in the same
 * isolate as the test, so this intercepts its outbound requests.
 */
export function mockUpstreams(overrides: Partial<Record<Source, Behaviour>> = {}) {
  const calls: { source: Source; url: string }[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const source = sourceOf(url);
    if (!source) throw new Error(`Unexpected outbound fetch in test: ${url}`);
    calls.push({ source, url });
    const behaviour = overrides[source] ?? "fixture";
    if (typeof behaviour === "function") return behaviour(url);
    if (behaviour === "down") throw new TypeError("network down");
    if (behaviour === "timeout") {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }
    if (behaviour === "404") return json({}, 404);
    if (behaviour === "500") return json({}, 500);
    if (source === "search") {
      const q = new URL(url).searchParams.get("query") ?? "";
      return json(q.includes("organism_id:9606") ? searchP53Human : searchP53);
    }
    if (source === "siteverify") {
      const form = init?.body as FormData;
      return json({ success: form?.get("response") === "good-token" });
    }
    const body = UPSTREAM[source]?.[accessionOf(url, source)];
    return body === undefined ? json({}, 404) : json(body);
  });
  return { calls, spy, count: (s: Source) => calls.filter((c) => c.source === s).length };
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...(baseEnv as unknown as Env), ...overrides };
}

/** Call the Worker with a (possibly overridden) env and wait for waitUntil work. */
export async function call(path: string, init: RequestInit = {}, env: Env = testEnv()): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://foldspeak.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Like `call`, but reads the body before waiting on waitUntil (needed for streams). */
export async function callAndRead(
  path: string,
  init: RequestInit = {},
  env: Env = testEnv(),
): Promise<{ res: Response; text: string }> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://foldspeak.test${path}`, init), env, ctx);
  const text = await res.text();
  await waitOnExecutionContext(ctx);
  return { res, text };
}

export function postJson(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  };
}

/** A fake Workers AI binding that streams the given pieces as SSE in both event shapes. */
export function fakeAi(pieces: (string | number)[] = ["## What it does\n", "GFP glows ", 238, " residues [UniProt]."]) {
  const run = vi.fn(async () => {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(ctrl) {
        pieces.forEach((p, i) => {
          const ev =
            typeof p === "number" || i % 2 === 1
              ? { choices: [{ delta: { content: String(p) } }] }
              : { response: p };
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        });
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ response: "", usage: { prompt_tokens: 1000, completion_tokens: 50 } })}\n\n`));
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    });
  });
  return { binding: { run } as unknown as Ai, run };
}
