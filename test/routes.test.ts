import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dossierKey } from "../src/lib/cache";
import type { Dossier } from "../src/dossier/schema";
import { call, mockUpstreams, testEnv } from "./helpers";

beforeEach(async () => {
  await reset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/health and friends", () => {
  it("health is 200", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("config exposes only the public Turnstile site key", async () => {
    const body = await (await call("/api/config")).json<Record<string, unknown>>();
    expect(Object.keys(body)).toEqual(["turnstileSiteKey"]);
  });

  it("curated set has 100 unique accessions", async () => {
    const { proteins } = await (await call("/api/curated")).json<{ proteins: { accession: string }[] }>();
    expect(proteins).toHaveLength(100);
    expect(new Set(proteins.map((p) => p.accession)).size).toBe(100);
  });

  it("unknown API path returns the error shape", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: expect.any(String) } });
  });
});

describe("GET /api/protein/:accession", () => {
  it("cold request fans out, warm request hits KV with zero upstream calls", async () => {
    const m = mockUpstreams();
    const cold = await call("/api/protein/P42212");
    expect(cold.status).toBe(200);
    const coldBody = await cold.json<Dossier>();
    expect(coldBody.cached).toBe(false);
    const upstreamCalls = m.calls.length;
    expect(upstreamCalls).toBeGreaterThanOrEqual(4);

    const stored = await env.PROTEIN_CACHE.get(dossierKey("P42212"), "json");
    expect(stored).toMatchObject({ accession: "P42212" });

    const warm = await call("/api/protein/p42212"); // case-insensitive
    const warmBody = await warm.json<Dossier>();
    expect(warmBody.cached).toBe(true);
    expect(warmBody.proteinName).toBe("Green fluorescent protein");
    expect(m.calls.length).toBe(upstreamCalls);
  });

  it("sources is never empty", async () => {
    mockUpstreams({ alphafold: "down", interpro: "down", pubmed: "down" });
    const body = await (await call("/api/protein/P04637")).json<Dossier>();
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it("a degraded dossier is served but not cached", async () => {
    mockUpstreams({ alphafold: "timeout" });
    const res = await call("/api/protein/P04637");
    expect(res.status).toBe(200);
    expect(await env.PROTEIN_CACHE.get(dossierKey("P04637"))).toBeNull();
  });

  it("rejects malformed accessions with 400 before any upstream call", async () => {
    const m = mockUpstreams();
    const res = await call("/api/protein/not-an-accession");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(m.calls).toHaveLength(0);
  });

  it("returns NOT_FOUND for an accession UniProt does not know", async () => {
    mockUpstreams({ uniprot: "404" });
    const res = await call("/api/protein/A0A000");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns UPSTREAM_UNAVAILABLE (502) when UniProt is down", async () => {
    mockUpstreams({ uniprot: "500" });
    const res = await call("/api/protein/P42212");
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "UPSTREAM_UNAVAILABLE" } });
  });
});

describe("cache write failure is non-fatal", () => {
  it("KV put throwing does not fail the request", async () => {
    mockUpstreams();
    const brokenKv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {
        throw new Error("KV put() limit exceeded for the day.");
      }),
    } as unknown as KVNamespace;
    const res = await call("/api/protein/P42212", {}, testEnv({ PROTEIN_CACHE: brokenKv }));
    expect(res.status).toBe(200);
    expect((await res.json<Dossier>()).proteinName).toBe("Green fluorescent protein");
    expect(brokenKv.put).toHaveBeenCalledOnce();
  });

  it("KV get throwing is treated as a miss", async () => {
    mockUpstreams();
    const brokenKv = {
      get: vi.fn(async () => {
        throw new Error("KV unavailable");
      }),
      put: vi.fn(async () => {}),
    } as unknown as KVNamespace;
    const res = await call("/api/protein/P42212", {}, testEnv({ PROTEIN_CACHE: brokenKv }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/search", () => {
  it("ranks reviewed human entries first for an ambiguous name", async () => {
    mockUpstreams();
    const res = await call("/api/search?q=p53");
    expect(res.status).toBe(200);
    const { results } = await res.json<{ results: { accession: string; reviewed: boolean }[] }>();
    expect(results[0]?.accession).toBe("P04637");
    const firstUnreviewed = results.findIndex((r) => !r.reviewed);
    if (firstUnreviewed >= 0) expect(results.slice(firstUnreviewed).every((r) => !r.reviewed)).toBe(true);
  });

  it("treats an accession query as an exact accession lookup", async () => {
    const m = mockUpstreams();
    await call("/api/search?q=p04637");
    expect(new URL(m.calls[0]!.url).searchParams.get("query")).toBe("accession:P04637");
  });

  it("strips UniProt query syntax from free text", async () => {
    const m = mockUpstreams();
    await call(`/api/search?q=${encodeURIComponent("insulin) OR (organism_id:*")}`);
    const q = new URL(m.calls[0]!.url).searchParams.get("query")!;
    expect(q).not.toMatch(/[():*]/);
  });

  it("validates query length", async () => {
    expect((await call("/api/search?q=a")).status).toBe(400);
    expect((await call(`/api/search?q=${"x".repeat(101)}`)).status).toBe(400);
  });

  it("upstream failure is a 502 with the error shape", async () => {
    mockUpstreams({ search: "500" });
    const res = await call("/api/search?q=insulin");
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "UPSTREAM_UNAVAILABLE" } });
  });
});

describe("rate limiting", () => {
  const denied = { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit;

  it("returns RATE_LIMITED with retryAfter and Retry-After header", async () => {
    const m = mockUpstreams();
    const res = await call("/api/protein/P42212", {}, testEnv({ BROWSE_LIMITER: denied }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({
      error: { code: "RATE_LIMITED", message: expect.any(String), retryAfter: 60 },
    });
    expect(m.calls).toHaveLength(0);
  });

  it("keys the limit on CF-Connecting-IP", async () => {
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    mockUpstreams();
    await call("/api/search?q=insulin", { headers: { "CF-Connecting-IP": "198.51.100.4" } }, testEnv({
      BROWSE_LIMITER: limiter as unknown as RateLimit,
    }));
    expect(limiter.limit).toHaveBeenCalledWith({ key: "198.51.100.4" });
  });

  it("health and static config are not rate limited", async () => {
    const res = await call("/api/health", {}, testEnv({ BROWSE_LIMITER: denied, NARRATE_LIMITER: denied }));
    expect(res.status).toBe(200);
  });
});
