import type { z } from "zod";

/** An upstream service failed in a way that is not "this record does not exist". */
export class UpstreamError extends Error {
  readonly source: string;
  readonly status: number | null;

  constructor(source: string, message: string, status: number | null = null) {
    super(`${source}: ${message}`);
    this.name = "UpstreamError";
    this.source = source;
    this.status = status;
  }
}

export interface FetchJsonOptions {
  source: string;
  userAgent: string;
  timeoutMs?: number;
  init?: RequestInit;
}

/**
 * GET (or POST) JSON from an upstream with a timeout and a descriptive User-Agent,
 * validated against a Zod schema.
 *
 * Returns `null` when the upstream says the record does not exist (404, 204).
 * Throws `UpstreamError` on timeouts, network errors, 5xx, or a shape mismatch.
 */
export async function fetchJson<S extends z.ZodType>(
  url: string,
  schema: S,
  { source, userAgent, timeoutMs = 5000, init = {} }: FetchJsonOptions,
): Promise<z.infer<S> | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", "User-Agent": userAgent, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "network error";
    throw new UpstreamError(source, reason);
  }

  if (res.status === 404 || res.status === 204 || res.status === 410) {
    await res.body?.cancel();
    return null;
  }
  if (res.status === 400) {
    // UniProt answers 400 for syntactically invalid accessions: that is "no such record".
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new UpstreamError(source, `HTTP ${res.status}`, res.status);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new UpstreamError(source, "invalid JSON", res.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamError(source, `unexpected response shape: ${parsed.error.issues[0]?.message ?? "?"}`);
  }
  return parsed.data;
}
