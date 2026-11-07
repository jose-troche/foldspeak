/**
 * Seed local KV for the Playwright run, so the Worker under test never calls
 * UniProt, AlphaFold, InterPro, PubMed, or Workers AI.
 *
 *   PROTEIN_CACHE:   every dossier in test/fixtures/dossiers/
 *   NARRATION_CACHE: every narration in test/fixtures/narrations/ ({acc}.{depth}.md)
 *
 * p53 (P04637) has a dossier but deliberately no narration: it is the "cache miss"
 * protein the Turnstile and budget specs use.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const E2E_PERSIST_DIR = ".wrangler/e2e";
const FIXTURES = "test/fixtures";
const OUT = join(E2E_PERSIST_DIR, "seed");

interface KvPair {
  key: string;
  value: string;
}

function bulkPut(binding: string, pairs: KvPair[]): void {
  const file = join(OUT, `${binding}.json`);
  writeFileSync(file, JSON.stringify(pairs));
  execFileSync("npx", ["wrangler", "kv", "bulk", "put", file, "--binding", binding, "--local", "--persist-to", E2E_PERSIST_DIR], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log(`seeded ${pairs.length} keys into local ${binding}`);
}

mkdirSync(OUT, { recursive: true });

const dossiers: KvPair[] = readdirSync(join(FIXTURES, "dossiers"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ key: `v1:dossier:${f.replace(".json", "")}`, value: readFileSync(join(FIXTURES, "dossiers", f), "utf8") }));

const narrations: KvPair[] = readdirSync(join(FIXTURES, "narrations"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const [acc, depth] = f.replace(".md", "").split(".");
    const text = readFileSync(join(FIXTURES, "narrations", f), "utf8");
    return {
      key: `v1:narration:${acc}:${depth}`,
      value: JSON.stringify({ text, model: "fixture", generatedAt: "2026-11-07T00:00:00Z" }),
    };
  });

bulkPut("PROTEIN_CACHE", dossiers);
bulkPut("NARRATION_CACHE", narrations);
