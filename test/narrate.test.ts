import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dossierKey, narrationKey } from "../src/lib/cache";
import type { CachedNarration } from "../src/routes/narrate";
import gfpDossier from "./fixtures/dossiers/P42212.json";
import { callAndRead, fakeAi, mockUpstreams, postJson, testEnv } from "./helpers";

const cachedText = "## What it does\nA cached explanation [UniProt].";

beforeEach(async () => {
  await reset();
  await env.PROTEIN_CACHE.put(dossierKey("P42212"), JSON.stringify(gfpDossier));
});
afterEach(() => vi.restoreAllMocks());

async function seedNarration(depth = "student") {
  const value: CachedNarration = { text: cachedText, model: "test", generatedAt: "2026-11-07T00:00:00Z" };
  await env.NARRATION_CACHE.put(narrationKey("P42212", depth), JSON.stringify(value));
}

describe("POST /api/narrate", () => {
  it("cache hit: streams cached text, no Turnstile, no model call", async () => {
    await seedNarration();
    const m = mockUpstreams();
    const ai = fakeAi();
    const { res, text } = await callAndRead("/api/narrate", postJson({ accession: "P42212", depth: "student" }), testEnv({ AI: ai.binding }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Narration-Cache")).toBe("HIT");
    expect(res.headers.get("Content-Type")).toMatch(/text\/markdown/);
    expect(text).toBe(cachedText);
    expect(ai.run).not.toHaveBeenCalled();
    expect(m.count("siteverify")).toBe(0);
  });

  it("cache miss without a token: 403 TURNSTILE_FAILED, never reaches the AI binding", async () => {
    mockUpstreams();
    const ai = fakeAi();
    const { res, text } = await callAndRead("/api/narrate", postJson({ accession: "P42212" }), testEnv({ AI: ai.binding }));
    expect(res.status).toBe(403);
    expect(JSON.parse(text)).toMatchObject({ error: { code: "TURNSTILE_FAILED" } });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("Turnstile rejection: 403 and never reaches the AI binding", async () => {
    const m = mockUpstreams();
    const ai = fakeAi();
    const { res } = await callAndRead(
      "/api/narrate",
      postJson({ accession: "P42212", turnstileToken: "forged-token" }),
      testEnv({ AI: ai.binding }),
    );
    expect(res.status).toBe(403);
    expect(m.count("siteverify")).toBe(1);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("siteverify receives the secret, the token, and the client IP", async () => {
    let form: FormData | undefined;
    mockUpstreams({
      siteverify: () => new Response(JSON.stringify({ success: false })),
    });
    vi.mocked(globalThis.fetch).mockImplementationOnce(async (_input, init) => {
      form = init?.body as FormData;
      return new Response(JSON.stringify({ success: false }));
    });
    await callAndRead("/api/narrate", postJson({ accession: "P42212", turnstileToken: "tok" }));
    expect(form?.get("secret")).toBe("test-secret");
    expect(form?.get("response")).toBe("tok");
    expect(form?.get("remoteip")).toBe("203.0.113.7");
  });

  it("verified miss: streams model text (both SSE shapes), caches it, records spend", async () => {
    mockUpstreams();
    const ai = fakeAi();
    const testenv = testEnv({ AI: ai.binding });
    const { res, text } = await callAndRead(
      "/api/narrate",
      postJson({ accession: "P42212", depth: "expert", turnstileToken: "good-token" }),
      testenv,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Narration-Cache")).toBe("MISS");
    expect(text).toBe("## What it does\nGFP glows 238 residues [UniProt].");
    expect(ai.run).toHaveBeenCalledOnce();
    const [model, inputs] = ai.run.mock.calls[0] as unknown as [string, { messages: { role: string; content: string }[]; stream: boolean }];
    expect(model).toBe("@cf/meta/llama-3.2-3b-instruct");
    expect(inputs.stream).toBe(true);
    expect(inputs.messages[1]!.content).toContain("<dossier>");

    const cached = await env.NARRATION_CACHE.get<CachedNarration>(narrationKey("P42212", "expert"), "json");
    expect(cached?.text).toBe(text);

    const stub = env.NEURON_COUNTER.get(env.NEURON_COUNTER.idFromName("global"));
    const status = await stub.status(8000);
    expect(status.spent).toBeGreaterThan(0);
    expect(status.spent).toBeLessThan(40);
  });

  it("a cache write failure after generation does not break the response", async () => {
    mockUpstreams();
    const ai = fakeAi();
    const brokenKv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {
        throw new Error("KV write limit");
      }),
    } as unknown as KVNamespace;
    const { res, text } = await callAndRead(
      "/api/narrate",
      postJson({ accession: "P42212", turnstileToken: "good-token" }),
      testEnv({ AI: ai.binding, NARRATION_CACHE: brokenKv }),
    );
    expect(res.status).toBe(200);
    expect(text).toContain("GFP glows");
    expect(brokenKv.put).toHaveBeenCalledOnce();
  });

  it("validates the body", async () => {
    const bad = await callAndRead("/api/narrate", postJson({ accession: "P42212", depth: "toddler" }));
    expect(bad.res.status).toBe(400);
    const notJson = await callAndRead("/api/narrate", { method: "POST", body: "nope" });
    expect(notJson.res.status).toBe(400);
  });

  it("is rate limited separately and more strictly", async () => {
    const denied = { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit;
    const { res } = await callAndRead("/api/narrate", postJson({ accession: "P42212" }), testEnv({ NARRATE_LIMITER: denied }));
    expect(res.status).toBe(429);
  });

  it("AI failure before streaming: 502 and the reservation is released", async () => {
    mockUpstreams();
    const ai = { run: vi.fn(async () => Promise.reject(new Error("model down"))) };
    const { res, text } = await callAndRead(
      "/api/narrate",
      postJson({ accession: "P42212", depth: "curious", turnstileToken: "good-token" }),
      testEnv({ AI: ai as unknown as Ai }),
    );
    expect(res.status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({ error: { code: "UPSTREAM_UNAVAILABLE" } });
    const stub = env.NEURON_COUNTER.get(env.NEURON_COUNTER.idFromName("global"));
    expect((await stub.status(8000)).spent).toBe(0);
  });
});

describe("neuron circuit breaker", () => {
  it("blocks the AI call at the threshold with AI_BUDGET_EXHAUSTED", async () => {
    mockUpstreams();
    const ai = fakeAi();
    const { res, text } = await callAndRead(
      "/api/narrate",
      postJson({ accession: "P42212", turnstileToken: "good-token" }),
      testEnv({ AI: ai.binding, NEURON_DAILY_BUDGET: "10" }),
    );
    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: { code: "AI_BUDGET_EXHAUSTED", message: expect.stringMatching(/Today's AI budget is used up/) },
    });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("still serves cached narrations when the budget is exhausted", async () => {
    await seedNarration("curious");
    const ai = fakeAi();
    const { res, text } = await callAndRead(
      "/api/narrate",
      postJson({ accession: "P42212", depth: "curious" }),
      testEnv({ AI: ai.binding, NEURON_DAILY_BUDGET: "0" }),
    );
    expect(res.status).toBe(200);
    expect(text).toBe(cachedText);
    expect(ai.run).not.toHaveBeenCalled();
  });
});
