import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../public/markdown";

const sources = [
  { name: "UniProt", url: "https://www.uniprot.org/uniprotkb/P42212/entry" },
  { name: "AlphaFold DB", url: "https://alphafold.ebi.ac.uk/entry/P42212" },
];

describe("narration markdown renderer", () => {
  it("escapes HTML from model output", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> **bold** <script>x</script>');
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders headings, lists and paragraphs", () => {
    const html = renderMarkdown("## What it does\nIt glows.\n\n- one\n- two\n\n1. a\n2. b");
    expect(html).toContain("<h3>What it does</h3>");
    expect(html).toContain("<p>It glows.</p>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>a</li><li>b</li></ol>");
  });

  it("turns citations into links to the dossier's sources", () => {
    const html = renderMarkdown("Fluoresces [UniProt]. Folded [AlphaFold]. See [PubMed 1347277].", sources);
    expect(html).toContain('href="https://www.uniprot.org/uniprotkb/P42212/entry"');
    expect(html).toContain('href="https://alphafold.ebi.ac.uk/entry/P42212"');
    expect(html).toContain('href="https://pubmed.ncbi.nlm.nih.gov/1347277/"');
  });

  it("leaves unknown bracketed text alone", () => {
    expect(renderMarkdown("[citation needed]", sources)).toBe("<p>[citation needed]</p>");
  });

  it("cannot be tricked into a javascript: link", () => {
    expect(renderMarkdown("[x](javascript:alert(1))", sources)).not.toMatch(/href="javascript/);
  });
});
