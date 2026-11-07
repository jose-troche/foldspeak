import { z } from "zod";

/**
 * The dossier is the contract between the Worker, the cache, the prompt, and the
 * frontend. Changing its shape means bumping KEY_VERSION in lib/cache.ts.
 */

/** UniProt accession format, from https://www.uniprot.org/help/accession_numbers */
export const ACCESSION_RE = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

export const AccessionSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(ACCESSION_RE, "Not a UniProt accession"));

export const FeatureSchema = z.object({
  type: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  description: z.string(),
});

export const DomainSchema = z.object({
  source: z.literal("InterPro"),
  id: z.string(),
  name: z.string(),
  type: z.string(),
  start: z.number().int(),
  end: z.number().int(),
});

export const DiseaseSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const StructureSchema = z.object({
  available: z.boolean(),
  cifUrl: z.string().url().optional(),
  paeImageUrl: z.string().url().optional(),
  meanPlddt: z.number().optional(),
  modelVersion: z.number().int().optional(),
  pageUrl: z.string().url().optional(),
});

export const PublicationSchema = z.object({
  pmid: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  journal: z.string().optional(),
});

export const SourceSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  retrieved: z.string(),
});

export const DossierSchema = z.object({
  accession: z.string(),
  entryName: z.string(),
  proteinName: z.string(),
  gene: z.string().nullable(),
  organism: z.object({
    scientificName: z.string(),
    commonName: z.string().optional(),
    taxId: z.number().int(),
  }),
  length: z.number().int(),
  sequence: z.string(),
  function: z.string().nullable(),
  diseases: z.array(DiseaseSchema),
  features: z.array(FeatureSchema),
  domains: z.array(DomainSchema),
  structure: StructureSchema,
  publications: z.array(PublicationSchema),
  /** Mandatory and never empty: this is what makes the narration auditable. */
  sources: z.array(SourceSchema).min(1),
  cached: z.boolean(),
});

export type Feature = z.infer<typeof FeatureSchema>;
export type Domain = z.infer<typeof DomainSchema>;
export type Disease = z.infer<typeof DiseaseSchema>;
export type Structure = z.infer<typeof StructureSchema>;
export type Publication = z.infer<typeof PublicationSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Dossier = z.infer<typeof DossierSchema>;

export const DEPTHS = ["curious", "student", "expert"] as const;
export type Depth = (typeof DEPTHS)[number];

export interface SearchResult {
  accession: string;
  name: string;
  gene: string | null;
  organism: string;
  reviewed: boolean;
  length: number;
}
