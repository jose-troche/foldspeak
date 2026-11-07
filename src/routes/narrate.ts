import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { AppError } from "../lib/errors";
import { CACHE_TTL_SECONDS, cacheGet, cachePut, narrationKey } from "../lib/cache";
import { loadDossier } from "../dossier/assemble";
import { AccessionSchema, DEPTHS } from "../dossier/schema";
import { clientIp } from "../middleware/rateLimit";
import { verifyTurnstile } from "../middleware/turnstile";
import { counterStub } from "../budget/NeuronCounter";
import { actualNeurons, narrationEstimate, startNarration } from "../ai/narrate";

export const narrate = new Hono<AppBindings>();

const BodySchema = z.object({
  accession: AccessionSchema,
  depth: z.enum(DEPTHS).default("student"),
  turnstileToken: z.string().max(2048).optional(),
});

/** What we store in NARRATION_CACHE: the generated markdown plus provenance. */
export interface CachedNarration {
  text: string;
  model: string;
  generatedAt: string;
}

export const BUDGET_MESSAGE =
  "Today's AI budget is used up — cached explanations are still available, and fresh ones resume at midnight UTC.";

const TEXT_HEADERS = {
  "Content-Type": "text/markdown; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Order matters and is the point of this handler:
 *   rate limit (middleware) → narration cache → Turnstile → dossier → budget → model.
 * Cached narrations are never gated, so repeat visitors never see a challenge, and
 * Turnstile protects exactly the scarce resource: an actual model call.
 */
narrate.post("/", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Expected a JSON body.");
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("BAD_REQUEST", "Expected { accession, depth: curious|student|expert, turnstileToken }.");
  }
  const { accession, depth, turnstileToken } = parsed.data;
  const key = narrationKey(accession, depth);

  // 1. Cache hit: stream cached text, no Turnstile, no model call.
  const cached = await cacheGet<CachedNarration>(c.env.NARRATION_CACHE, key);
  if (cached?.text) {
    return new Response(cached.text, { headers: { ...TEXT_HEADERS, "X-Narration-Cache": "HIT" } });
  }

  // 2. Cache miss: this request will cost a model call, so it must pass Turnstile.
  const verdict = await verifyTurnstile(turnstileToken, clientIp(c.req.raw), c.env);
  if (!verdict.success) {
    throw new AppError(
      "TURNSTILE_FAILED",
      turnstileToken
        ? "Verification failed or expired. Please complete the check again."
        : "A quick verification is needed before generating a fresh explanation.",
    );
  }

  // 3. Grounding context (usually a dossier cache hit; the page just fetched it).
  const dossier = await loadDossier(accession, c.env, (p) => c.executionCtx.waitUntil(p));

  // 4. Circuit breaker: reserve the worst-case spend before calling the model.
  const counter = counterStub(c.env.NEURON_COUNTER);
  const budget = Number(c.env.NEURON_DAILY_BUDGET) || 0;
  const estimate = narrationEstimate(c.env, dossier, depth);
  const reservation = await counter.reserve(estimate, budget);
  if (!reservation.allowed) throw new AppError("AI_BUDGET_EXHAUSTED", BUDGET_MESSAGE);

  // 5. The model call. Release the reservation if it fails before streaming.
  let narration;
  try {
    narration = await startNarration(c.env, dossier, depth);
  } catch {
    c.executionCtx.waitUntil(counter.reconcile(-estimate));
    throw new AppError("UPSTREAM_UNAVAILABLE", "The AI service is unavailable right now. Please try again shortly.");
  }

  c.executionCtx.waitUntil(
    narration.done.then(
      async (result) => {
        await counter.reconcile(actualNeurons(narration.model, narration.inputTokens, result) - estimate);
        if (result.text.trim().length > 0) {
          const value: CachedNarration = { text: result.text, model: narration.model, generatedAt: new Date().toISOString() };
          await cachePut(c.env.NARRATION_CACHE, key, value, CACHE_TTL_SECONDS);
        }
      },
      () => {
        // Stream failed mid-way: keep the reservation (tokens were likely spent), cache nothing.
      },
    ),
  );

  return new Response(narration.stream, { headers: { ...TEXT_HEADERS, "X-Narration-Cache": "MISS" } });
});

