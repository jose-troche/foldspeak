import { z } from "zod";
import type { Env } from "../env";
import { fetchJson } from "../lib/fetchJson";
import type { Publication } from "../dossier/schema";
import type { UniProtEntry } from "./uniprot";

const MAX_PUBLICATIONS = 5;

const SummarySchema = z.object({
  result: z
    .object({ uids: z.array(z.string()) })
    .catchall(z.unknown())
    .optional(),
});

const DocSchema = z.object({
  uid: z.string(),
  title: z.string().optional(),
  pubdate: z.string().optional(),
  source: z.string().optional(),
});

/**
 * The PubMed IDs UniProt curators cite as evidence for this entry's function,
 * disease, and feature annotations, ranked by how many annotations cite them.
 * These are the most relevant papers by construction, and need no search call.
 */
export function collectPmids(entry: UniProtEntry, max = MAX_PUBLICATIONS): string[] {
  const counts = new Map<string, number>();
  const add = (evs: { source?: string | undefined; id?: string | undefined }[] | undefined, weight: number) => {
    for (const ev of evs ?? []) {
      if (ev.source === "PubMed" && ev.id && /^\d+$/.test(ev.id)) {
        counts.set(ev.id, (counts.get(ev.id) ?? 0) + weight);
      }
    }
  };
  for (const c of entry.comments ?? []) {
    for (const t of c.texts ?? []) add(t.evidences, 3);
    add(c.disease?.evidences, 2);
    for (const t of c.note?.texts ?? []) add(t.evidences, 2);
  }
  for (const f of entry.features ?? []) add(f.evidences, 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    .slice(0, max)
    .map(([id]) => id);
}

/** One E-utilities call per protein: esummary for titles and years. */
export async function fetchPubMed(pmids: string[], env: Env): Promise<Publication[]> {
  if (pmids.length === 0) return [];
  const params = new URLSearchParams({ db: "pubmed", id: pmids.join(","), retmode: "json", tool: "foldspeak" });
  if (env.NCBI_API_KEY) params.set("api_key", env.NCBI_API_KEY);
  const data = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`,
    SummarySchema,
    { source: "PubMed", userAgent: env.USER_AGENT },
  );
  const result = data?.result;
  if (!result) return [];
  const pubs: Publication[] = [];
  for (const uid of result.uids) {
    const doc = DocSchema.safeParse(result[uid]);
    if (!doc.success || !doc.data.title) continue;
    const year = doc.data.pubdate?.match(/\d{4}/)?.[0];
    const pub: Publication = { pmid: uid, title: doc.data.title, year: year ? Number(year) : null };
    if (doc.data.source) pub.journal = doc.data.source;
    pubs.push(pub);
  }
  return pubs;
}
