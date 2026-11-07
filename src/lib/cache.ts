/**
 * Best-effort KV wrapper. KV allows only 1,000 writes/day on the Free plan, so a
 * failed write must never fail a request: a broken cache is a slow app, not a down app.
 *
 * Every KV access in the codebase goes through these two functions.
 */

export const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Key prefixes are versioned: bump to v2 when the dossier shape changes. */
export const KEY_VERSION = "v1";

export function dossierKey(accession: string): string {
  return `${KEY_VERSION}:dossier:${accession}`;
}

export function narrationKey(accession: string, depth: string): string {
  return `${KEY_VERSION}:narration:${accession}:${depth}`;
}

export async function cacheGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key, "json");
  } catch {
    return null;
  }
}

export async function cachePut(
  kv: KVNamespace,
  key: string,
  value: unknown,
  ttlSeconds: number = CACHE_TTL_SECONDS,
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) });
  } catch {
    // Write budget exhausted, or a KV hiccup. Non-fatal by design. Do not throw.
  }
}
