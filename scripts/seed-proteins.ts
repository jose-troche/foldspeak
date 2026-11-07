/**
 * Seed the curated showcase set into production KV:
 *
 *   npm run seed                      # dossiers + student-depth narrations
 *   npm run seed -- --depths student,curious
 *   npm run seed -- --no-narrations   # dossiers only
 *   npm run seed -- --only P42212,P04637 --dry-run
 *
 * Dossiers are assembled with the Worker's own code (src/dossier/assemble.ts) and
 * narrations use the Worker's own prompt (src/ai/prompts.ts) through the Workers AI
 * REST API, so seeded content is identical to what the Worker would produce.
 *
 * Narrations already in remote KV are skipped, so a re-run never re-spends neurons.
 * Seeded entries have no expiry: the key prefix (v1:) changes with the schema, which
 * is when this script should run again.
 *
 * Neuron cost: about 32 per narration, so 100 student-depth narrations use roughly a
 * third of one day's free 10,000 allocation. Run it once, not on every deploy.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { assembleDossier } from "../src/dossier/assemble";
import { buildMessages } from "../src/ai/prompts";
import { MAX_OUTPUT_TOKENS } from "../src/ai/narrate";
import { DEPTHS, type Depth, type Dossier } from "../src/dossier/schema";
import { dossierKey, narrationKey } from "../src/lib/cache";
import type { Env } from "../src/env";
import curated from "./curated.json" with { type: "json" };

const { values: args } = parseArgs({
  options: {
    depths: { type: "string", default: "student" },
    "no-narrations": { type: "boolean", default: false },
    only: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
});

const toml = readFileSync("wrangler.toml", "utf8");
const tomlVar = (name: string) => toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? "";
const MODEL = tomlVar("AI_MODEL");
const USER_AGENT = tomlVar("USER_AGENT");
const OUT = ".seed";

const env = { USER_AGENT, NCBI_API_KEY: process.env.NCBI_API_KEY ?? "", AI_MODEL: MODEL } as Env;

function wrangler(args: string[], capture = false): string {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : ["ignore", "inherit", "inherit"],
  });
}

function credentials(): { accountId: string; token: string } {
  const token = process.env.CLOUDFLARE_API_TOKEN ?? wrangler(["auth", "token"], true).trim().split("\n").pop()!.trim();
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  if (!accountId) {
    const who = wrangler(["whoami"], true);
    accountId = who.match(/\b([0-9a-f]{32})\b/)?.[1] ?? "";
  }
  if (!token || !accountId) throw new Error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or run `wrangler login`.");
  return { accountId, token };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const REQUIRED_HEADINGS = ["What it does", "The parts that matter", "What goes wrong when it breaks"];

async function narrate(d: Dossier, depth: Depth, creds: { accountId: string; token: string }): Promise<string | null> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/${MODEL}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: buildMessages(d, depth), max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.2 }),
    });
    const body = (await res.json()) as { success: boolean; result?: { response?: unknown }; errors?: unknown };
    const text = typeof body.result?.response === "string" ? body.result.response.trim() : "";
    // Quality gate: the three sections must be there, or we would cache a bad answer for good.
    if (body.success && REQUIRED_HEADINGS.every((h) => text.includes(h))) return text;
    console.warn(`  ${d.accession}/${depth}: attempt ${attempt} rejected`, body.success ? "(missing sections)" : body.errors);
  }
  return null;
}

async function main() {
  const depths = args.depths.split(",").map((s) => s.trim()) as Depth[];
  for (const d of depths) if (!DEPTHS.includes(d)) throw new Error(`Unknown depth ${d}`);
  const only = args.only?.split(",").map((s) => s.trim().toUpperCase());
  const accessions = curated.proteins.map((p) => p.accession).filter((a) => !only || only.includes(a));
  const concurrency = Number(args.concurrency) || 4;
  mkdirSync(OUT, { recursive: true });

  console.log(`Assembling ${accessions.length} dossiers…`);
  const completeSet = new Set<string>();
  const dossiers = (
    await pool(accessions, concurrency, async (acc) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { dossier, complete } = await assembleDossier(acc, env);
          if (complete) completeSet.add(acc);
          if (complete || attempt === 3) {
            console.log(`  ${acc} ${dossier.proteinName}${complete ? "" : " (partial)"}`);
            return dossier;
          }
        } catch (err) {
          if (attempt === 3) console.error(`  ${acc} FAILED: ${(err as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
      return null;
    })
  ).filter((d): d is Dossier => d !== null);

  const partial = dossiers.filter((d) => !completeSet.has(d.accession)).map((d) => d.accession);
  if (partial.length > 0) {
    console.warn(`Partial dossiers (an optional source failed after retries): ${partial.join(", ")}`);
    console.warn("Re-run later with --only for these; delete their narration keys first so they regenerate.");
  }

  const proteinPairs = dossiers.map((d) => ({ key: dossierKey(d.accession), value: JSON.stringify(d) }));
  writeFileSync(join(OUT, "protein-cache.json"), JSON.stringify(proteinPairs));
  console.log(`${proteinPairs.length} dossiers ready.`);

  const narrationPairs: { key: string; value: string }[] = [];
  if (!args["no-narrations"]) {
    const existing = new Set(
      args["dry-run"]
        ? []
        : (JSON.parse(wrangler(["kv", "key", "list", "--binding", "NARRATION_CACHE", "--remote", "--prefix", "v1:narration:"], true)) as { name: string }[]).map(
            (k) => k.name,
          ),
    );
    const jobs = dossiers.flatMap((d) => depths.map((depth) => ({ d, depth }))).filter((j) => !existing.has(narrationKey(j.d.accession, j.depth)));
    console.log(`Generating ${jobs.length} narrations with ${MODEL} (${existing.size} already cached, ~${Math.round(jobs.length * 32)} neurons)…`);
    if (!args["dry-run"] && jobs.length > 0) {
      const creds = credentials();
      await pool(jobs, 3, async ({ d, depth }) => {
        const text = await narrate(d, depth, creds);
        if (!text) return;
        narrationPairs.push({
          key: narrationKey(d.accession, depth),
          value: JSON.stringify({ text, model: MODEL, generatedAt: new Date().toISOString() }),
        });
        console.log(`  ${d.accession}/${depth} ✓`);
      });
    }
    writeFileSync(join(OUT, "narration-cache.json"), JSON.stringify(narrationPairs));
  }

  if (args["dry-run"]) {
    console.log(`Dry run: wrote ${OUT}/, uploaded nothing.`);
    return;
  }
  wrangler(["kv", "bulk", "put", join(OUT, "protein-cache.json"), "--binding", "PROTEIN_CACHE", "--remote"]);
  if (narrationPairs.length > 0) {
    wrangler(["kv", "bulk", "put", join(OUT, "narration-cache.json"), "--binding", "NARRATION_CACHE", "--remote"]);
  }
  console.log(`Seeded ${proteinPairs.length} dossiers and ${narrationPairs.length} narrations.`);
}

await main();
