import type { Depth, Dossier, SearchResult } from "../src/dossier/schema";
import { renderMarkdown } from "./markdown";
import { StructureViewer } from "./viewer";

/* ---------------------------------------------------------------- types */

interface ApiErrorBody {
  error: { code: string; message: string; retryAfter?: number };
}

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/* ---------------------------------------------------------------- dom */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const els = {
  home: $("home"),
  status: $("status"),
  results: $("results"),
  resultsTitle: $("results-title"),
  resultsList: $("results-list"),
  protein: $("protein"),
  eyebrow: $("protein-eyebrow"),
  name: $("protein-name"),
  meta: $("protein-meta"),
  structureHint: $("structure-hint"),
  viewer: $("viewer"),
  track: $("track"),
  regions: $("regions"),
  clearHighlight: $<HTMLButtonElement>("clear-highlight"),
  banner: $("budget-banner"),
  turnstileBox: $("turnstile-box"),
  turnstileWidget: $("turnstile-widget"),
  narration: $("narration"),
  functionText: $("function-text"),
  diseaseCard: $("disease-card"),
  diseaseList: $("disease-list"),
  pubsCard: $("pubs-card"),
  pubsList: $("pubs-list"),
  sourcesList: $("sources-list"),
  showcase: $("showcase"),
  surprise: $<HTMLButtonElement>("surprise"),
};

const viewer = new StructureViewer(els.viewer, $("viewer-host"), $("viewer-overlay"));

/* ---------------------------------------------------------------- helpers */

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("NETWORK", "Could not reach foldspeak. Check your connection and try again.", 0);
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(body.error.code, body.error.message, res.status, body.error.retryAfter);
  } catch {
    return new ApiError("HTTP_" + res.status, `Request failed (${res.status}).`, res.status);
  }
}

function friendlyError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Please try again.";
  switch (err.code) {
    case "RATE_LIMITED":
      return `You're going a little fast. Please wait ${err.retryAfter ?? 60} seconds and try again.`;
    case "NOT_FOUND":
      return err.message || "We couldn't find that protein in UniProt.";
    case "UPSTREAM_UNAVAILABLE":
      return "A source database isn't answering right now. Please try again in a moment.";
    default:
      return err.message;
  }
}

function showStatus(kind: "loading" | "error" | "info", text: string): void {
  els.status.hidden = false;
  els.status.dataset.kind = kind;
  els.status.setAttribute("role", kind === "error" ? "alert" : "status");
  els.status.textContent = text;
}

function hideStatus(): void {
  els.status.hidden = true;
  els.status.textContent = "";
}

function setView(view: "home" | "results" | "protein"): void {
  els.home.hidden = view !== "home";
  els.results.hidden = view !== "results";
  els.protein.hidden = view !== "protein";
  document.querySelectorAll<HTMLFormElement>(".search-compact").forEach((f) => (f.hidden = view === "home"));
}

/* ---------------------------------------------------------------- routing */

type Route = { view: "home" } | { view: "search"; q: string } | { view: "protein"; acc: string };

function currentRoute(): Route {
  const params = new URLSearchParams(location.search);
  const acc = params.get("p");
  if (acc) return { view: "protein", acc: acc.toUpperCase() };
  const q = params.get("q");
  if (q) return { view: "search", q };
  return { view: "home" };
}

function navigate(url: string): void {
  history.pushState(null, "", url);
  void render();
}

async function render(): Promise<void> {
  const route = currentRoute();
  hideStatus();
  if (route.view === "home") {
    setView("home");
    document.title = "foldspeak";
    return;
  }
  if (route.view === "search") {
    await runSearch(route.q);
    return;
  }
  await showProtein(route.acc);
}

document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-nav]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute("href") ?? "/");
});

window.addEventListener("popstate", () => void render());

/* ---------------------------------------------------------------- search */

document.querySelectorAll<HTMLFormElement>("form[data-search]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = String(new FormData(form).get("q") ?? "").trim();
    if (q.length < 2) {
      showStatus("error", "Type at least two characters: a protein name, gene symbol, or UniProt accession.");
      return;
    }
    navigate(`/?q=${encodeURIComponent(q)}`);
  });
});

async function runSearch(q: string): Promise<void> {
  document.title = `${q} · foldspeak`;
  document.querySelectorAll<HTMLInputElement>("form[data-search] input").forEach((i) => (i.value = q));
  setView("results");
  els.resultsTitle.textContent = `Results for “${q}”`;
  els.resultsList.replaceChildren();
  showStatus("loading", "Searching UniProt…");
  try {
    const { results } = await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`);
    hideStatus();
    if (results.length === 0) {
      showStatus("info", `No UniProt entries matched “${q}”. Try a gene symbol (e.g. TP53) or an accession (e.g. P04637).`);
      return;
    }
    els.resultsList.replaceChildren(
      ...results.map((r) =>
        h(
          "li",
          {},
          h(
            "a",
            { href: `/?p=${r.accession}`, "data-nav": "" },
            h("span", { class: "r-name" }, r.name),
            h(
              "span",
              { class: "r-meta" },
              [r.gene, r.organism, `${r.length} aa`, r.accession].filter(Boolean).join(" · "),
            ),
            h("span", { class: `r-badge${r.reviewed ? "" : " unreviewed"}` }, r.reviewed ? "Reviewed" : "Unreviewed"),
          ),
        ),
      ),
    );
  } catch (err) {
    showStatus("error", friendlyError(err));
  }
}

/* ---------------------------------------------------------------- protein */

let current: Dossier | null = null;
let currentDepth: Depth = "student";

async function showProtein(acc: string): Promise<void> {
  setView("protein");
  els.protein.hidden = true;
  showStatus("loading", `Gathering records for ${acc} from UniProt, AlphaFold DB, InterPro, and PubMed…`);
  let dossier: Dossier;
  try {
    dossier = await api<Dossier>(`/api/protein/${encodeURIComponent(acc)}`);
  } catch (err) {
    showStatus("error", friendlyError(err));
    return;
  }
  hideStatus();
  current = dossier;
  els.protein.hidden = false;
  document.title = `${dossier.proteinName} · foldspeak`;
  renderHeader(dossier);
  renderRegions(dossier);
  renderFacts(dossier);
  void viewer.show(dossier.structure, dossier.proteinName);
  void loadNarration(dossier, currentDepth);
  window.scrollTo({ top: 0 });
}

function renderHeader(d: Dossier): void {
  els.eyebrow.textContent = [d.gene, d.accession].filter(Boolean).join(" · ");
  els.name.textContent = d.proteinName;
  const organism = h("em", {}, d.organism.scientificName);
  els.meta.replaceChildren(
    organism,
    d.organism.commonName ? ` (${d.organism.commonName})` : "",
    ` · ${d.length.toLocaleString()} amino acids`,
  );
  els.structureHint.textContent =
    d.structure.available && d.structure.meanPlddt !== undefined
      ? `AlphaFold model · mean pLDDT ${d.structure.meanPlddt}`
      : d.structure.available
        ? "AlphaFold model"
        : "";
}

interface Region {
  label: string;
  type: string;
  start: number;
  end: number;
  source: "InterPro" | "UniProt";
}

let activeRegion: HTMLButtonElement | null = null;

function renderRegions(d: Dossier): void {
  activeRegion = null;
  els.clearHighlight.hidden = true;
  const domains: Region[] = d.domains.map((x) => ({ label: x.name, type: x.type, start: x.start, end: x.end, source: "InterPro" }));
  const features: Region[] = d.features.map((f) => ({
    label: f.description,
    type: f.type,
    start: f.start,
    end: f.end,
    source: "UniProt",
  }));

  // Linear map of the protein: InterPro domains, else UniProt domains, else InterPro families.
  const pick = (items: Region[], types: string[]) => items.filter((x) => types.includes(x.type));
  const onTrack = [pick(domains, ["domain", "repeat"]), pick(features, ["domain"]), pick(domains, ["family"])].find(
    (list) => list.length > 0,
  ) ?? [];
  els.track.replaceChildren(
    ...onTrack.map((r) => {
      const seg = h("span", { class: "track-seg", "data-range": `${r.start}-${r.end}` });
      seg.style.left = `${((r.start - 1) / d.length) * 100}%`;
      seg.style.width = `${Math.max(0.6, ((r.end - r.start + 1) / d.length) * 100)}%`;
      return seg;
    }),
  );

  const group = (title: string, items: Region[]) => {
    if (items.length === 0) return null;
    return h(
      "div",
      { class: "region-group" },
      h("h4", {}, title),
      h(
        "ul",
        { class: "region-list" },
        ...items.map((r) => {
          const range = r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`;
          const btn = h(
            "button",
            {
              type: "button",
              class: "region",
              "aria-pressed": "false",
              "data-start": String(r.start),
              "data-end": String(r.end),
              "aria-label": `${r.label}, ${r.type}, residues ${range}`,
            },
            h("span", { class: "region-label" }, r.label),
            h("span", { class: "region-type" }, r.type),
            h("span", { class: "region-range" }, range),
          );
          btn.addEventListener("click", () => toggleRegion(btn, r));
          return h("li", {}, btn);
        }),
      ),
    );
  };

  const children = [
    group("Domains & families · InterPro", domains),
    group("Annotated sites & regions · UniProt", features),
  ].filter((x): x is HTMLDivElement => x !== null);
  els.regions.replaceChildren(
    ...(children.length ? children : [h("p", { class: "hint" }, "No functional regions are annotated for this entry.")]),
  );
}

function toggleRegion(btn: HTMLButtonElement, r: Region): void {
  if (activeRegion === btn) {
    clearRegion();
    return;
  }
  activeRegion?.setAttribute("aria-pressed", "false");
  activeRegion = btn;
  btn.setAttribute("aria-pressed", "true");
  els.clearHighlight.hidden = false;
  els.track.querySelectorAll(".track-seg").forEach((s) => {
    s.classList.toggle("active", (s as HTMLElement).dataset.range === `${r.start}-${r.end}`);
  });
  viewer.highlight(r.start, r.end);
}

function clearRegion(): void {
  activeRegion?.setAttribute("aria-pressed", "false");
  activeRegion = null;
  els.clearHighlight.hidden = true;
  els.track.querySelectorAll(".track-seg.active").forEach((s) => s.classList.remove("active"));
  viewer.clearHighlight();
}

els.clearHighlight.addEventListener("click", clearRegion);

function renderFacts(d: Dossier): void {
  els.functionText.textContent = d.function ?? "UniProt has no function annotation for this entry.";

  els.diseaseCard.hidden = d.diseases.length === 0;
  els.diseaseList.replaceChildren(
    ...d.diseases.map((x) => h("li", {}, h("strong", {}, x.name), x.description ? h("div", { class: "muted" }, x.description) : null)),
  );

  els.pubsCard.hidden = d.publications.length === 0;
  els.pubsList.replaceChildren(
    ...d.publications.map((p) =>
      h(
        "li",
        {},
        h("a", { href: `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`, target: "_blank", rel: "noopener" }, p.title),
        h("div", { class: "muted" }, [p.journal, p.year, `PMID ${p.pmid}`].filter(Boolean).join(" · ")),
      ),
    ),
  );

  els.sourcesList.replaceChildren(
    ...d.sources.map((s) =>
      h(
        "li",
        {},
        h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.name),
        h("time", { datetime: s.retrieved }, `retrieved ${new Date(s.retrieved).toISOString().slice(0, 10)}`),
      ),
    ),
  );
}

/* ---------------------------------------------------------------- narration */

let narrationAbort: AbortController | null = null;
let turnstileWidgetId: string | null = null;

document.querySelectorAll<HTMLButtonElement>(".depth button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const depth = btn.dataset.depth as Depth;
    if (depth === currentDepth || !current) return;
    currentDepth = depth;
    document
      .querySelectorAll<HTMLButtonElement>(".depth button")
      .forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    void loadNarration(current, depth);
  });
});

function setNarrationState(state: "idle" | "loading" | "streaming" | "done" | "error"): void {
  els.narration.dataset.state = state;
  els.narration.setAttribute("aria-busy", String(state === "loading" || state === "streaming"));
}

function narrationNote(text: string): void {
  els.narration.replaceChildren(h("p", { class: "narration-note" }, text));
}

async function loadNarration(d: Dossier, depth: Depth, turnstileToken?: string): Promise<void> {
  narrationAbort?.abort();
  const abort = new AbortController();
  narrationAbort = abort;
  hideTurnstile();
  setNarrationState("loading");
  if (!turnstileToken) narrationNote("Reading the records…");

  let res: Response;
  try {
    res = await fetch("/api/narrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accession: d.accession, depth, turnstileToken }),
      signal: abort.signal,
    });
  } catch {
    if (abort.signal.aborted) return;
    setNarrationState("error");
    narrationNote("Could not reach foldspeak to fetch the explanation.");
    return;
  }
  if (abort.signal.aborted) return;

  if (!res.ok) {
    const err = await toApiError(res);
    if (abort.signal.aborted) return;
    if (err.code === "TURNSTILE_FAILED") {
      setNarrationState("idle");
      narrationNote("No explanation has been written for this protein at this depth yet.");
      void showTurnstile((token) => void loadNarration(d, depth, token));
      return;
    }
    setNarrationState("error");
    if (err.code === "AI_BUDGET_EXHAUSTED") {
      els.banner.textContent = err.message;
      els.banner.hidden = false;
      narrationNote(
        "There's no cached explanation at this depth yet. Try another depth, or one of the showcase proteins — their explanations are always available.",
      );
      return;
    }
    narrationNote(friendlyError(err));
    return;
  }

  const sources = d.sources.map((s) => ({ name: s.name, url: s.url }));
  const reader = res.body?.getReader();
  if (!reader) {
    setNarrationState("error");
    narrationNote("The explanation could not be read.");
    return;
  }
  const decoder = new TextDecoder();
  let text = "";
  let frame = 0;
  setNarrationState("streaming");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (abort.signal.aborted) {
        void reader.cancel();
        return;
      }
      if (done) break;
      text += decoder.decode(value, { stream: true });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        els.narration.innerHTML = renderMarkdown(text, sources);
      });
    }
    text += decoder.decode();
  } catch {
    if (abort.signal.aborted) return;
    setNarrationState("error");
    els.narration.innerHTML = renderMarkdown(text, sources);
    els.narration.append(h("p", { class: "narration-note" }, "The explanation was cut off. Try again."));
    return;
  }
  cancelAnimationFrame(frame);
  els.narration.innerHTML = text.trim()
    ? renderMarkdown(text, sources)
    : '<p class="narration-note">The model returned an empty explanation.</p>';
  setNarrationState("done");
}

/* ---------------------------------------------------------------- turnstile */

let siteKeyPromise: Promise<string> | null = null;
let turnstileScript: Promise<Turnstile> | null = null;

function siteKey(): Promise<string> {
  siteKeyPromise ??= api<{ turnstileSiteKey: string }>("/api/config").then((c) => c.turnstileSiteKey);
  siteKeyPromise.catch(() => (siteKeyPromise = null));
  return siteKeyPromise;
}

/** Loaded only on a narration cache miss: most visitors never download it. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  turnstileScript ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile unavailable")));
    s.onerror = () => reject(new Error("Turnstile unavailable"));
    document.head.appendChild(s);
  });
  turnstileScript.catch(() => (turnstileScript = null));
  return turnstileScript;
}

async function showTurnstile(onToken: (token: string) => void): Promise<void> {
  els.turnstileBox.hidden = false;
  try {
    const [key, ts] = await Promise.all([siteKey(), loadTurnstile()]);
    if (turnstileWidgetId) ts.remove(turnstileWidgetId);
    els.turnstileWidget.replaceChildren();
    turnstileWidgetId = ts.render(els.turnstileWidget, {
      sitekey: key,
      action: "narrate",
      // A fresh token per narration: tokens are single-use.
      callback: (token: string) => onToken(token),
      "error-callback": () => narrationNote("Verification could not complete. Reload the page to try again."),
    });
  } catch {
    narrationNote("The verification widget could not load, so a fresh explanation can't be generated right now.");
  }
}

function hideTurnstile(): void {
  els.turnstileBox.hidden = true;
  if (turnstileWidgetId && window.turnstile) {
    window.turnstile.remove(turnstileWidgetId);
    turnstileWidgetId = null;
  }
}

/* ---------------------------------------------------------------- showcase */

interface Curated {
  accession: string;
  label: string;
}

const FEATURED = ["P42212", "P04637", "P69905", "P01308", "P0DTC2", "P13569", "P38398", "P0CG48", "P02144", "P08100"];

async function loadShowcase(): Promise<void> {
  try {
    const { proteins } = await api<{ proteins: Curated[] }>("/api/curated");
    const featured = FEATURED.map((a) => proteins.find((p) => p.accession === a)).filter((p): p is Curated => !!p);
    els.showcase.replaceChildren(
      ...featured.map((p) => h("li", {}, h("a", { href: `/?p=${p.accession}`, "data-nav": "" }, p.label))),
    );
    els.surprise.addEventListener("click", () => {
      const pick = proteins[Math.floor(Math.random() * proteins.length)];
      if (pick) navigate(`/?p=${pick.accession}`);
    });
  } catch {
    els.surprise.hidden = true;
  }
}

void loadShowcase();
void render();
