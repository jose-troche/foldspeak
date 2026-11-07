import type { Disease, Feature } from "./schema";
import type { UniProtEntry } from "../sources/uniprot";

/**
 * Drop everything the frontend never renders, so cache hits parse a small object
 * and the prompt stays inside its token budget.
 */

const MAX_FUNCTION_CHARS = 2000;
const MAX_DISEASES = 8;
const MAX_DISEASE_CHARS = 280;
const MAX_FEATURE_DESC_CHARS = 160;
const MAX_FEATURES = 80;

/** UniProt feature type → our label, and how many of each to keep at most. */
const FEATURE_TYPES: Record<string, { label: string; cap: number }> = {
  Domain: { label: "domain", cap: 40 },
  "DNA binding": { label: "DNA binding", cap: 10 },
  "Zinc finger": { label: "zinc finger", cap: 20 },
  "Active site": { label: "active site", cap: 20 },
  "Binding site": { label: "binding site", cap: 30 },
  Site: { label: "site", cap: 15 },
  Motif: { label: "motif", cap: 15 },
  Region: { label: "region", cap: 25 },
  "Cross-link": { label: "cross-link", cap: 10 },
  "Modified residue": { label: "modified residue", cap: 12 },
};

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Strip UniProt's inline evidence markers like "(PubMed:12345, PubMed:67890)". */
export function stripEvidenceRefs(text: string): string {
  return text
    .replace(/\s*\((?:PubMed|By similarity|Ref\.\d+)[^()]*\)/g, "")
    .replace(/\s+([.,;])/g, "$1");
}

export function trimFunction(entry: UniProtEntry): string | null {
  const texts = (entry.comments ?? [])
    .filter((c) => c.commentType === "FUNCTION")
    .flatMap((c) => c.texts ?? [])
    .map((t) => stripEvidenceRefs(t.value).trim())
    .filter(Boolean)
    .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`));
  if (texts.length === 0) return null;
  return clip(texts.join(" "), MAX_FUNCTION_CHARS);
}

export function trimDiseases(entry: UniProtEntry): Disease[] {
  const out: Disease[] = [];
  for (const c of entry.comments ?? []) {
    if (c.commentType !== "DISEASE" || !c.disease) continue;
    const name = c.disease.acronym ? `${c.disease.diseaseId} (${c.disease.acronym})` : c.disease.diseaseId;
    out.push({ name, description: clip(stripEvidenceRefs(c.disease.description ?? ""), MAX_DISEASE_CHARS) });
    if (out.length >= MAX_DISEASES) break;
  }
  return out;
}

export function trimFeatures(entry: UniProtEntry): Feature[] {
  const counts = new Map<string, number>();
  const out: Feature[] = [];
  for (const f of entry.features ?? []) {
    const spec = FEATURE_TYPES[f.type];
    const start = f.location.start.value;
    const end = f.location.end.value;
    if (!spec || start == null || end == null) continue;
    const n = counts.get(f.type) ?? 0;
    if (n >= spec.cap) continue;
    counts.set(f.type, n + 1);
    const desc = f.description?.trim();
    const ligand = f.ligand?.name;
    // Binding sites carry the ligand separately; "covalent" alone says nothing.
    const description = ligand ? (desc ? `${ligand} (${desc})` : ligand) : desc || spec.label;
    out.push({ type: spec.label, start, end, description: clip(description, MAX_FEATURE_DESC_CHARS) });
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end).slice(0, MAX_FEATURES);
}
