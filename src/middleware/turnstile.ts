import { z } from "zod";
import type { Env } from "../env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const SiteverifySchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

export interface TurnstileResult {
  success: boolean;
  errorCodes: string[];
}

/**
 * Server-side Turnstile validation. Called on the narration path only after the
 * narration cache has missed, so repeat visitors never see a challenge.
 *
 * Tokens are single-use: siteverify rejects a replayed token with
 * `timeout-or-duplicate`, which we surface as a failure like any other.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string,
  env: Env,
): Promise<TurnstileResult> {
  if (!token || token.length > 2048) return { success: false, errorCodes: ["missing-input-response"] };
  if (!env.TURNSTILE_SECRET_KEY) return { success: false, errorCodes: ["missing-input-secret"] };

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (remoteIp !== "unknown") form.append("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    const parsed = SiteverifySchema.safeParse(await res.json());
    if (!parsed.success) return { success: false, errorCodes: ["bad-siteverify-response"] };
    return { success: parsed.data.success, errorCodes: parsed.data["error-codes"] ?? [] };
  } catch {
    return { success: false, errorCodes: ["siteverify-unreachable"] };
  }
}
