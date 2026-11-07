import { z } from "zod";
import type { Env } from "../env";
import { fetchJson } from "../lib/fetchJson";
import type { SearchResult } from "../dossier/schema";

const BASE = "https://rest.uniprot.org/uniprotkb";

/**
 * Narrow field set: parsing ~20KB instead of ~400KB is what keeps a cold request
 * inside the 10ms CPU budget. Literature references are deliberately not requested;
 * PubMed IDs come from evidence tags instead (see pubmed.ts).
 */
export const UNIPROT_FIELDS = [
  "accession",
  "id",
  "protein_name",
  "gene_names",
  "organism_name",
  "organism_id",
  "length",
  "sequence",
  "cc_function",
  "cc_disease",
  "ft_domain",
  "ft_region",
  "ft_motif",
  "ft_dna_bind",
  "ft_zn_fing",
  "ft_act_site",
  "ft_binding",
  "ft_site",
  "ft_crosslnk",
  "ft_mod_res",
].join(",");

const Evidence = z.object({ source: z.string().optional(), id: z.string().optional() });
const Text = z.object({ value: z.string(), evidences: z.array(Evidence).optional() });
const Name = z.object({ value: z.string() });

const Position = z.object({ value: z.number().int().nullable().optional() });

export const UniProtEntrySchema = z.object({
  entryType: z.string(),
  primaryAccession: z.string(),
  uniProtkbId: z.string().optional(),
  organism: z
    .object({
      scientificName: z.string(),
      commonName: z.string().optional(),
      taxonId: z.number().int(),
    })
    .optional(),
  proteinDescription: z
    .object({
      recommendedName: z.object({ fullName: Name }).optional(),
      submissionNames: z.array(z.object({ fullName: Name })).optional(),
    })
    .optional(),
  genes: z
    .array(
      z.object({
        geneName: Name.optional(),
        synonyms: z.array(Name).optional(),
        orderedLocusNames: z.array(Name).optional(),
        orfNames: z.array(Name).optional(),
      }),
    )
    .optional(),
  comments: z
    .array(
      z.object({
        commentType: z.string(),
        texts: z.array(Text).optional(),
        disease: z
          .object({
            diseaseId: z.string(),
            acronym: z.string().optional(),
            description: z.string().optional(),
            evidences: z.array(Evidence).optional(),
          })
          .optional(),
        note: z.object({ texts: z.array(Text) }).optional(),
      }),
    )
    .optional(),
  features: z
    .array(
      z.object({
        type: z.string(),
        location: z.object({ start: Position, end: Position }),
        description: z.string().optional(),
        ligand: z.object({ name: z.string() }).optional(),
        evidences: z.array(Evidence).optional(),
      }),
    )
    .optional(),
  sequence: z.object({ value: z.string(), length: z.number().int() }).optional(),
});

export type UniProtEntry = z.infer<typeof UniProtEntrySchema>;

/** Returns null when UniProt has no active entry for the accession. */
export async function fetchUniProt(accession: string, env: Env): Promise<UniProtEntry | null> {
  const url = `${BASE}/${encodeURIComponent(accession)}?fields=${UNIPROT_FIELDS}&format=json`;
  const entry = await fetchJson(url, UniProtEntrySchema, { source: "UniProt", userAgent: env.USER_AGENT });
  // Merged/deleted entries come back as "Inactive" with no data.
  if (!entry || entry.entryType.startsWith("Inactive") || !entry.sequence) return null;
  return entry;
}

const SearchResponseSchema = z.object({
  results: z.array(
    z.object({
      entryType: z.string(),
      primaryAccession: z.string(),
      organism: z.object({ scientificName: z.string(), taxonId: z.number().int().optional() }).optional(),
      proteinDescription: UniProtEntrySchema.shape.proteinDescription,
      genes: UniProtEntrySchema.shape.genes,
      sequence: z.object({ length: z.number().int() }).optional(),
    }),
  ),
});

export function proteinNameOf(desc: UniProtEntry["proteinDescription"]): string | null {
  return desc?.recommendedName?.fullName.value ?? desc?.submissionNames?.[0]?.fullName.value ?? null;
}

export function geneNameOf(genes: UniProtEntry["genes"]): string | null {
  const g = genes?.[0];
  return g?.geneName?.value ?? g?.orderedLocusNames?.[0]?.value ?? g?.orfNames?.[0]?.value ?? null;
}

const HUMAN_TAX_ID = 9606;

const SearchHitSchema = SearchResponseSchema.shape.results.element;
type SearchHit = z.infer<typeof SearchHitSchema>;

function toResult(r: SearchHit): SearchResult {
  return {
    accession: r.primaryAccession,
    name: proteinNameOf(r.proteinDescription) ?? r.primaryAccession,
    gene: geneNameOf(r.genes),
    organism: r.organism?.scientificName ?? "Unknown organism",
    reviewed: r.entryType.includes("reviewed (Swiss-Prot)"),
    length: r.sequence?.length ?? 0,
  };
}

/**
 * Rank: reviewed (Swiss-Prot) first, since TrEMBL entries are unreviewed and far
 * noisier; then an exact name/gene/synonym match; then the term appearing in the
 * name; then human, which is what most visitors mean by "p53" or "insulin".
 * UniProt's own relevance order breaks remaining ties.
 */
export function rankResults(hits: SearchHit[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  const wordRe = new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
  const scored = hits.map((hit, index) => {
    const names = [
      proteinNameOf(hit.proteinDescription),
      ...(hit.genes ?? []).flatMap((g) => [g.geneName?.value, ...(g.synonyms ?? []).map((s) => s.value)]),
    ]
      .filter((n): n is string => !!n)
      .map((n) => n.toLowerCase());
    const result = toResult(hit);
    const exact = names.includes(q);
    const mentions = exact || names.some((n) => wordRe.test(n));
    // Human only breaks ties between hits that are actually about the query term.
    const human = mentions && hit.organism?.taxonId === HUMAN_TAX_ID;
    const score = (result.reviewed ? 4 : 0) + (exact ? 3 : 0) + (mentions ? 2 : 0) + (human ? 1 : 0);
    return { result, score, index };
  });
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.result)
    .filter((r) => (seen.has(r.accession) ? false : (seen.add(r.accession), true)));
}

async function searchOnce(query: string, size: number, env: Env): Promise<SearchHit[]> {
  const params = new URLSearchParams({
    query,
    fields: "accession,id,protein_name,gene_names,organism_name,organism_id,length,reviewed",
    size: String(size),
    format: "json",
  });
  const data = await fetchJson(`${BASE}/search?${params}`, SearchResponseSchema, {
    source: "UniProt",
    userAgent: env.USER_AGENT,
  });
  return data?.results ?? [];
}

/**
 * Free text → candidate accessions. Two queries in parallel: the general one, and the
 * same term restricted to human, because UniProt's relevance has no organism
 * preference and "p53" otherwise returns dog and macaque before human.
 */
export async function searchUniProt(term: string, env: Env, size = 10): Promise<SearchResult[]> {
  const [general, human] = await Promise.allSettled([
    searchOnce(term, size, env),
    searchOnce(`(${term}) AND (organism_id:${HUMAN_TAX_ID}) AND (reviewed:true)`, 3, env),
  ]);
  if (general.status === "rejected" && human.status === "rejected") throw general.reason;
  const hits = [
    ...(general.status === "fulfilled" ? general.value : []),
    ...(human.status === "fulfilled" ? human.value : []),
  ];
  return rankResults(hits, term.replace(/^accession:/, "")).slice(0, size);
}
