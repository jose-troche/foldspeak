/**
 * A deliberately tiny Markdown renderer for model output. Everything is HTML-escaped
 * first; only a fixed set of constructs is turned back into markup, so model output
 * can never inject HTML or script.
 */

export interface CitationTarget {
  name: string;
  url: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Turn bracketed citations like [UniProt] or [PubMed 12345] into source links. */
function linkCitations(html: string, sources: CitationTarget[]): string {
  return html.replace(/\[([^\]]{2,60})\]/g, (whole, inner: string) => {
    const parts = inner.split(/\s*[,;]\s*/);
    const rendered = parts.map((part) => {
      const pmid = part.match(/^PubMed(?:\s*ID)?[:\s]*(\d{4,9})$/i)?.[1] ?? part.match(/^PMID[:\s]*(\d{4,9})$/i)?.[1];
      if (pmid) {
        return `<a class="cite" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/" target="_blank" rel="noopener">PubMed ${pmid}</a>`;
      }
      const key = normalize(part);
      const src = sources.find((s) => {
        const n = normalize(s.name);
        return n === key || n.startsWith(key) || key.startsWith(n);
      });
      return src ? `<a class="cite" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${part}</a>` : null;
    });
    // Only rewrite when every part is a known citation; otherwise leave the text alone.
    return rendered.every((r) => r !== null) ? rendered.join(" ") : whole;
  });
}

function inline(text: string, sources: CitationTarget[]): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  return linkCitations(html, sources);
}

export function renderMarkdown(md: string, sources: CitationTarget[] = []): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), sources)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, sources)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = Math.min(4, Math.max(3, heading[1]!.length + 1));
      out.push(`<h${level}>${inline(heading[2]!.replace(/#+$/, "").trim(), sources)}</h${level}>`);
    } else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}
