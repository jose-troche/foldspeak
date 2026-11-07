import { Hono } from "hono";
import type { AppBindings } from "../env";
import { AppError } from "../lib/errors";
import { UpstreamError } from "../lib/fetchJson";
import { ACCESSION_RE } from "../dossier/schema";
import { searchUniProt } from "../sources/uniprot";

export const search = new Hono<AppBindings>();

/** Free text → candidate accessions. No LLM, no Turnstile. */
search.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2 || q.length > 100) {
    throw new AppError("BAD_REQUEST", "Search for at least 2 and at most 100 characters.");
  }
  // UniProt's query syntax is powerful (field:value, AND/OR); keep user input a plain term.
  const term = ACCESSION_RE.test(q.toUpperCase())
    ? `accession:${q.toUpperCase()}`
    : q.replace(/[^\p{L}\p{N}\s\-.']/gu, " ").replace(/\s+/g, " ").trim();
  if (!term) throw new AppError("BAD_REQUEST", "Try a protein name, gene symbol, or UniProt accession.");
  try {
    const results = await searchUniProt(term, c.env);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({ results });
  } catch (err) {
    if (err instanceof UpstreamError) throw new AppError("UPSTREAM_UNAVAILABLE", "UniProt search is unavailable right now.");
    throw err;
  }
});
