import { z } from "zod";
import type { Env } from "../env";
import { fetchJson } from "../lib/fetchJson";
import type { Structure } from "../dossier/schema";

const PredictionSchema = z.array(
  z.object({
    providerId: z.string().optional(),
    uniprotAccession: z.string().optional(),
    globalMetricValue: z.number().optional(),
    latestVersion: z.number().int().optional(),
    cifUrl: z.string().url().optional(),
    paeImageUrl: z.string().url().optional(),
  }),
);

/**
 * AlphaFold metadata only. The Worker never downloads the structure file or the PAE
 * matrix (an N×N matrix can be tens of MB); the browser fetches the .cif directly and
 * we hand it the pre-rendered PAE PNG.
 *
 * File URLs come from the metadata rather than a hardcoded `model_v4` path, because
 * AlphaFold DB bumps model versions over time.
 */
export async function fetchAlphaFold(accession: string, env: Env): Promise<Structure> {
  const data = await fetchJson(
    `https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(accession)}`,
    PredictionSchema,
    { source: "AlphaFold", userAgent: env.USER_AGENT },
  );
  const models = (data ?? []).filter((m) => m.cifUrl);
  // Prefer the canonical Google DeepMind model over community-provided ones.
  const model = models.find((m) => m.providerId === "GDM") ?? models[0];
  if (!model?.cifUrl) return { available: false };

  const structure: Structure = {
    available: true,
    cifUrl: model.cifUrl,
    pageUrl: `https://alphafold.ebi.ac.uk/entry/${accession}`,
  };
  if (model.paeImageUrl) structure.paeImageUrl = model.paeImageUrl;
  if (model.globalMetricValue !== undefined) structure.meanPlddt = Math.round(model.globalMetricValue * 10) / 10;
  if (model.latestVersion !== undefined) structure.modelVersion = model.latestVersion;
  return structure;
}
