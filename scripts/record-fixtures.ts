/**
 * Re-record upstream fixtures from the live services:
 *   npx tsx scripts/record-fixtures.ts
 *
 * Writes the raw upstream JSON each source client receives to test/fixtures/upstream/
 * (used by the Vitest suite to catch upstream shape changes), the assembled dossiers
 * to test/fixtures/dossiers/ (seeded into local KV for Playwright), and the GFP
 * structure + PAE image the browser fetches (served by page.route in e2e).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assembleDossier } from "../src/dossier/assemble";
import type { Env } from "../src/env";

const ACCESSIONS = ["P42212", "P04637", "Q8WZ42"];
// String paths (not file URLs): Node and Workers type definitions disagree on URL.
const ROOT = "test/fixtures";
const USER_AGENT = "foldspeak/1.0 (https://github.com/jose-troche/foldspeak)";

function fixtureName(url: string): string | null {
  const u = new URL(url);
  if (u.hostname === "rest.uniprot.org") return `uniprot-${u.pathname.split("/").pop()}.json`;
  if (u.hostname === "alphafold.ebi.ac.uk") return `alphafold-${u.pathname.split("/").pop()}.json`;
  if (u.hostname === "www.ebi.ac.uk") return `interpro-${u.pathname.split("/").filter(Boolean).pop()}.json`;
  if (u.hostname === "eutils.ncbi.nlm.nih.gov") return `pubmed-${current}.json`;
  return null;
}

let current = "";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const res = await realFetch(input, init);
  const name = fixtureName(url);
  if (name) {
    const body = res.status === 200 ? await res.clone().text() : JSON.stringify({ __status: res.status });
    await writeFile(join(ROOT, "upstream", name), body.endsWith("\n") ? body : `${body}\n`);
  }
  return res;
};

const env = { USER_AGENT, NCBI_API_KEY: process.env.NCBI_API_KEY ?? "" } as Env;

await mkdir(join(ROOT, "upstream"), { recursive: true });
await mkdir(join(ROOT, "dossiers"), { recursive: true });
await mkdir(join(ROOT, "structures"), { recursive: true });

for (const acc of ACCESSIONS) {
  current = acc;
  const { dossier, complete } = await assembleDossier(acc, env, new Date("2026-11-07T00:00:00Z"));
  await writeFile(join(ROOT, "dossiers", `${acc}.json`), `${JSON.stringify(dossier, null, 2)}\n`);
  console.log(acc, dossier.proteinName, complete ? "complete" : "PARTIAL");
}

// Browser-side assets for the GFP e2e run.
globalThis.fetch = realFetch;
const gfp = (await import("../test/fixtures/dossiers/P42212.json", { with: { type: "json" } })).default;
for (const [url, file] of [
  [gfp.structure.cifUrl, "structures/P42212.cif"],
  [gfp.structure.paeImageUrl, "structures/P42212-pae.png"],
] as const) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  await writeFile(join(ROOT, file), Buffer.from(await res.arrayBuffer()));
  console.log("saved", file);
}
