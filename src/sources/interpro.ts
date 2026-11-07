import { z } from "zod";
import type { Env } from "../env";
import { fetchJson } from "../lib/fetchJson";
import type { Domain } from "../dossier/schema";

const InterProSchema = z.object({
  results: z.array(
    z.object({
      metadata: z.object({
        accession: z.string(),
        name: z.string().nullable(),
        type: z.string(),
      }),
      proteins: z.array(
        z.object({
          entry_protein_locations: z
            .array(z.object({ fragments: z.array(z.object({ start: z.number(), end: z.number() })) }))
            .nullable(),
        }),
      ),
    }),
  ),
});

/** Entry types worth showing on a protein map. Superfamilies duplicate domains. */
const KEEP_TYPES = new Set(["domain", "family", "repeat", "active_site", "binding_site", "conserved_site", "ptm"]);

const MAX_DOMAINS = 30;

/**
 * InterPro-integrated entries only (`entry/interpro/...`), which already merge the
 * Pfam/SMART/PROSITE member signatures. Fewer, cleaner rows and a smaller payload.
 */
export async function fetchInterPro(accession: string, env: Env): Promise<Domain[]> {
  const data = await fetchJson(
    `https://www.ebi.ac.uk/interpro/api/entry/interpro/protein/uniprot/${encodeURIComponent(accession)}?page_size=100`,
    InterProSchema,
    { source: "InterPro", userAgent: env.USER_AGENT },
  );
  const domains: Domain[] = [];
  for (const r of data?.results ?? []) {
    if (!KEEP_TYPES.has(r.metadata.type)) continue;
    for (const p of r.proteins) {
      for (const loc of p.entry_protein_locations ?? []) {
        if (loc.fragments.length === 0) continue;
        domains.push({
          source: "InterPro",
          id: r.metadata.accession,
          name: r.metadata.name ?? r.metadata.accession,
          type: r.metadata.type.replace(/_/g, " "),
          start: Math.min(...loc.fragments.map((f) => f.start)),
          end: Math.max(...loc.fragments.map((f) => f.end)),
        });
      }
    }
  }
  return domains.sort((a, b) => a.start - b.start || b.end - a.end).slice(0, MAX_DOMAINS);
}
