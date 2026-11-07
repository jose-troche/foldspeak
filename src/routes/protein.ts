import { Hono } from "hono";
import type { AppBindings } from "../env";
import { AppError } from "../lib/errors";
import { loadDossier } from "../dossier/assemble";
import { AccessionSchema } from "../dossier/schema";

export const protein = new Hono<AppBindings>();

protein.get("/:accession", async (c) => {
  const parsed = AccessionSchema.safeParse(c.req.param("accession"));
  if (!parsed.success) throw new AppError("BAD_REQUEST", "That is not a valid UniProt accession.");
  const dossier = await loadDossier(parsed.data, c.env, (p) => c.executionCtx.waitUntil(p));
  c.header("Cache-Control", "public, max-age=300");
  return c.json(dossier);
});
