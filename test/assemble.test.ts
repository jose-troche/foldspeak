import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleDossier } from "../src/dossier/assemble";
import { DossierSchema } from "../src/dossier/schema";
import { AppError } from "../src/lib/errors";
import { mockUpstreams, testEnv } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("dossier assembly against recorded fixtures", () => {
  it("assembles GFP from all four sources", async () => {
    mockUpstreams();
    const { dossier, complete } = await assembleDossier("P42212", testEnv());
    expect(complete).toBe(true);
    expect(() => DossierSchema.parse(dossier)).not.toThrow();
    expect(dossier).toMatchObject({
      accession: "P42212",
      entryName: "GFP_AEQVI",
      proteinName: "Green fluorescent protein",
      gene: "GFP",
      organism: { scientificName: "Aequorea victoria", taxId: 6100 },
      length: 238,
    });
    expect(dossier.sequence).toHaveLength(238);
    expect(dossier.function).toMatch(/aequorin/);
    expect(dossier.structure.available).toBe(true);
    expect(dossier.structure.cifUrl).toMatch(/^https:\/\/alphafold\.ebi\.ac\.uk\/files\/AF-P42212-F1-model_v\d+\.cif$/);
    expect(dossier.structure.paeImageUrl).toMatch(/predicted_aligned_error/);
    expect(dossier.structure.meanPlddt).toBeGreaterThan(90);
    // The chromophore: a Ser-Gly cross-link and the modified Tyr66.
    expect(dossier.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "cross-link", start: 65, end: 67 }),
        expect.objectContaining({ type: "modified residue", start: 66, end: 66 }),
      ]),
    );
    expect(dossier.domains.length).toBeGreaterThan(0);
    expect(dossier.domains.every((d) => d.source === "InterPro" && d.start <= d.end)).toBe(true);
    expect(dossier.sources.map((s) => s.name)).toEqual(["UniProt", "AlphaFold DB", "InterPro", "PubMed"]);
  });

  it("keeps p53's functional landmarks and disease annotations", async () => {
    mockUpstreams();
    const { dossier } = await assembleDossier("P04637", testEnv());
    expect(dossier.gene).toBe("TP53");
    expect(dossier.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "DNA binding", start: 102, end: 292 }),
        expect.objectContaining({ type: "binding site", start: 176, description: "Zn(2+)" }),
      ]),
    );
    expect(dossier.diseases.map((d) => d.name)).toContain("Li-Fraumeni syndrome (LFS)");
    expect(dossier.publications.length).toBeGreaterThan(0);
    expect(dossier.publications.length).toBeLessThanOrEqual(5);
    expect(dossier.publications[0]).toMatchObject({ pmid: expect.stringMatching(/^\d+$/), title: expect.any(String) });
    // Evidence markers are stripped from prose.
    expect(dossier.function).not.toMatch(/PubMed:/);
  });

  it("makes exactly one E-utilities call per protein", async () => {
    const m = mockUpstreams();
    await assembleDossier("P04637", testEnv());
    expect(m.count("pubmed")).toBe(1);
    expect(m.count("uniprot")).toBe(1);
  });

  it("asks UniProt for a narrow field set, never the whole entry", async () => {
    const m = mockUpstreams();
    await assembleDossier("P42212", testEnv());
    const url = new URL(m.calls.find((c) => c.source === "uniprot")!.url);
    expect(url.searchParams.get("fields")).toContain("cc_function");
    expect(url.searchParams.get("fields")).not.toContain("lit_pubmed_id");
  });

  it("sends a descriptive User-Agent on every upstream request", async () => {
    const m = mockUpstreams();
    await assembleDossier("P42212", testEnv());
    for (const [, init] of m.spy.mock.calls) {
      expect(new Headers(init?.headers).get("User-Agent")).toMatch(/^foldspeak\/1\.0 \(https:\/\/github\.com\//);
    }
  });

  it("merges an InterPro family's motif hits into one span, but keeps repeated domains separate", async () => {
    mockUpstreams();
    const gfp = (await assembleDossier("P42212", testEnv())).dossier;
    const families = gfp.domains.filter((d) => d.type === "family");
    expect(new Set(families.map((d) => d.id)).size).toBe(families.length);
    expect(families.find((d) => d.name === "Green fluorescent protein, GFP")).toMatchObject({ start: 3, end: 237 });

    const titin = (await assembleDossier("Q8WZ42", testEnv())).dossier;
    const ig = titin.domains.filter((d) => d.type === "domain" && d.name === "Immunoglobulin I-set");
    expect(ig.length).toBeGreaterThan(1);
  });

  it("titin has no AlphaFold model: NO_STRUCTURE is a normal outcome, not an error", async () => {
    mockUpstreams();
    const { dossier, complete } = await assembleDossier("Q8WZ42", testEnv());
    expect(complete).toBe(true);
    expect(dossier.structure).toEqual({ available: false });
    expect(dossier.sources.map((s) => s.name)).not.toContain("AlphaFold DB");
    expect(dossier.length).toBe(34350);
    expect(dossier.features.length).toBeLessThanOrEqual(80);
  });
});

describe("partial failure degrades, never 500s", () => {
  it.each(["down", "timeout", "500"] as const)("AlphaFold %s → dossier still returns without structure", async (b) => {
    mockUpstreams({ alphafold: b });
    const { dossier, complete } = await assembleDossier("P42212", testEnv());
    expect(dossier.structure.available).toBe(false);
    expect(dossier.proteinName).toBe("Green fluorescent protein");
    expect(complete).toBe(false);
  });

  it("InterPro and PubMed down → dossier still returns, sources still non-empty", async () => {
    mockUpstreams({ interpro: "down", pubmed: "500" });
    const { dossier, complete } = await assembleDossier("P04637", testEnv());
    expect(dossier.domains).toEqual([]);
    expect(dossier.publications).toEqual([]);
    expect(dossier.sources.map((s) => s.name)).toEqual(["UniProt", "AlphaFold DB"]);
    expect(complete).toBe(false);
  });

  it("InterPro 204 (no entries) is an empty list, and the dossier is complete", async () => {
    mockUpstreams({ interpro: () => new Response(null, { status: 204 }) });
    const { dossier, complete } = await assembleDossier("P42212", testEnv());
    expect(dossier.domains).toEqual([]);
    expect(complete).toBe(true);
  });

  it("UniProt down is fatal: UPSTREAM_UNAVAILABLE", async () => {
    mockUpstreams({ uniprot: "down" });
    await expect(assembleDossier("P42212", testEnv())).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("unknown accession: NOT_FOUND", async () => {
    mockUpstreams({ uniprot: "404" });
    const err = await assembleDossier("A0A000", testEnv()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("NOT_FOUND");
  });

  it("an upstream shape change is caught by the schema, not passed through", async () => {
    mockUpstreams({ alphafold: () => new Response(JSON.stringify({ unexpected: true })) });
    const { dossier } = await assembleDossier("P42212", testEnv());
    expect(dossier.structure.available).toBe(false);
  });
});
