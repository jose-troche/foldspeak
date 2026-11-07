import type { Env } from "../env";
import { AppError } from "../lib/errors";
import { UpstreamError } from "../lib/fetchJson";
import { CACHE_TTL_SECONDS, cacheGet, cachePut, dossierKey } from "../lib/cache";
import { fetchAlphaFold } from "../sources/alphafold";
import { fetchInterPro } from "../sources/interpro";
import { collectPmids, fetchPubMed } from "../sources/pubmed";
import { fetchUniProt, geneNameOf, proteinNameOf } from "../sources/uniprot";
import type { Domain, Dossier, Publication, Source, Structure } from "./schema";
import { trimDiseases, trimFeatures, trimFunction } from "./trim";

export interface Assembled {
  dossier: Dossier;
  /** True when every optional source answered. Only complete dossiers are cached. */
  complete: boolean;
}

/**
 * Fan out to every upstream and merge. UniProt failing is fatal; everything else is
 * optional, so a protein with no AlphaFold model, no InterPro domains, and no
 * publications still produces a useful dossier. Partial failure degrades, never 500s.
 *
 * PubMed is chained off UniProt (it needs the curated PMIDs) but still runs in
 * parallel with AlphaFold and InterPro.
 */
export async function assembleDossier(accession: string, env: Env, now: Date = new Date()): Promise<Assembled> {
  const uniprotP = fetchUniProt(accession, env);
  const pubmedP = uniprotP.then((u) => (u ? fetchPubMed(collectPmids(u), env) : []));

  const [uniprot, alphafold, interpro, pubmed] = await Promise.allSettled([
    uniprotP,
    fetchAlphaFold(accession, env),
    fetchInterPro(accession, env),
    pubmedP,
  ]);

  if (uniprot.status === "rejected") {
    const reason = uniprot.reason instanceof UpstreamError ? uniprot.reason.message : "UniProt request failed";
    throw new AppError("UPSTREAM_UNAVAILABLE", `Could not reach UniProt (${reason}). Try again shortly.`);
  }
  const entry = uniprot.value;
  if (!entry || !entry.sequence) {
    throw new AppError("NOT_FOUND", `No UniProt entry found for ${accession}.`);
  }

  const retrieved = now.toISOString();
  const acc = entry.primaryAccession;
  const sources: Source[] = [{ name: "UniProt", url: `https://www.uniprot.org/uniprotkb/${acc}/entry`, retrieved }];

  const structure: Structure = alphafold.status === "fulfilled" ? alphafold.value : { available: false };
  if (structure.available) {
    sources.push({ name: "AlphaFold DB", url: `https://alphafold.ebi.ac.uk/entry/${acc}`, retrieved });
  }

  const domains: Domain[] = interpro.status === "fulfilled" ? interpro.value : [];
  if (domains.length > 0) {
    sources.push({ name: "InterPro", url: `https://www.ebi.ac.uk/interpro/protein/UniProt/${acc}/`, retrieved });
  }

  const publications: Publication[] = pubmed.status === "fulfilled" ? pubmed.value : [];
  if (publications.length > 0) {
    const term = publications.map((p) => p.pmid).join(" OR ");
    sources.push({ name: "PubMed", url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(term)}`, retrieved });
  }

  const dossier: Dossier = {
    accession: acc,
    entryName: entry.uniProtkbId ?? acc,
    proteinName: proteinNameOf(entry.proteinDescription) ?? entry.uniProtkbId ?? acc,
    gene: geneNameOf(entry.genes),
    organism: {
      scientificName: entry.organism?.scientificName ?? "Unknown organism",
      ...(entry.organism?.commonName ? { commonName: entry.organism.commonName } : {}),
      taxId: entry.organism?.taxonId ?? 0,
    },
    length: entry.sequence.length,
    sequence: entry.sequence.value,
    function: trimFunction(entry),
    diseases: trimDiseases(entry),
    features: trimFeatures(entry),
    domains,
    structure,
    publications,
    sources,
    cached: false,
  };

  const complete = [alphafold, interpro, pubmed].every((r) => r.status === "fulfilled");
  return { dossier, complete };
}

/**
 * Cache-first dossier load shared by the protein and narrate routes.
 * The KV write is best-effort and happens after the response via waitUntil.
 */
export async function loadDossier(
  accession: string,
  env: Env,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Dossier> {
  const key = dossierKey(accession);
  const hit = await cacheGet<Dossier>(env.PROTEIN_CACHE, key);
  if (hit) return { ...hit, cached: true };

  const { dossier, complete } = await assembleDossier(accession, env);
  // A degraded dossier (an optional source timed out) is not worth 30 days in the
  // cache or one of the 1,000 daily writes; the next visitor gets a fresh attempt.
  if (complete) waitUntil(cachePut(env.PROTEIN_CACHE, key, dossier, CACHE_TTL_SECONDS));
  return dossier;
}
