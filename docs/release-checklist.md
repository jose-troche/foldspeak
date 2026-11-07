# Release checklist

Assertions can't catch hallucination, so before each release read the narrations for
five proteins you know well. Do it on the live site after `npm run deploy`.

| Protein | Accession | What to check |
|---|---|---|
| GFP | [P42212](https://foldspeak.troche.workers.dev/?p=P42212) | Chromophore at 65–67 and Tyr66 named correctly; no invented disease. |
| p53 | [P04637](https://foldspeak.troche.workers.dev/?p=P04637) | DNA-binding domain ~100–290, tetramerisation ~320–360; disease section framed as UniProt annotations, no risk statements. |
| Hemoglobin beta | [P68871](https://foldspeak.troche.workers.dev/?p=P68871) | Heme binding, oxygen transport; sickle-cell framed as an annotation, not advice. |
| Insulin | [P01308](https://foldspeak.troche.workers.dev/?p=P01308) | Chains and propeptide come from the dossier, not recall. |
| Titin | [Q8WZ42](https://foldspeak.troche.workers.dev/?p=Q8WZ42) | Says there is no AlphaFold model; does not describe a structure. |

For each, at every depth you have generated:

- [ ] Every residue number appears in the dossier's features or domains.
- [ ] Every claim carries a citation, and the cited source actually contains it.
- [ ] Nothing that reads as medical advice, diagnosis, risk, or treatment.
- [ ] The "What goes wrong" section matches the dossier: annotations if present, "none in the records" if not.

If a seeded narration fails, delete its key and re-seed it:

```
npx wrangler kv key delete "v1:narration:P04637:student" --binding NARRATION_CACHE --remote
npm run seed -- --only P04637
```
