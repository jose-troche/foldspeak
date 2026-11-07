/**
 * Mol* wiring. Mol* is loaded from a pinned CDN build on demand (never bundled), and
 * fetches the .cif straight from EBI, so neither the Worker nor its bandwidth sits in
 * the structure path. pLDDT confidence lives in the B-factor column, so coloring by
 * confidence costs no extra request.
 *
 * The container carries state hooks for tests and styling:
 *   data-state     idle | loading | ready | error | fallback | none
 *   data-highlight "start-end" of the highlighted region, or ""
 */

import { MOLSTAR_VERSION } from "./molstar-version";

export { MOLSTAR_VERSION };
export const MOLSTAR_BASE = `https://cdn.jsdelivr.net/npm/molstar@${MOLSTAR_VERSION}/build/viewer`;

/** Below this width the page shows a static image instead of the WebGL viewer. */
export const MOBILE_MAX_WIDTH = 700;

interface MolstarViewer {
  loadStructureFromUrl(
    url: string,
    format: string,
    isBinary: boolean,
    options?: { representationParams?: { theme?: { globalName?: string } } },
  ): Promise<void>;
  structureInteractivity(options: {
    elements?: { beg_label_seq_id: number; end_label_seq_id: number };
    action: string | string[];
    focusOptions?: { minRadius?: number; extraRadius?: number; durationMs?: number };
  }): void;
  plugin: { clear(): Promise<void>; canvas3d?: unknown };
  handleResize(): void;
  dispose(): void;
}

interface MolstarGlobal {
  Viewer: { create(el: HTMLElement, options: Record<string, unknown>): Promise<MolstarViewer> };
}

declare global {
  interface Window {
    molstar?: MolstarGlobal;
  }
}

let molstarLoading: Promise<MolstarGlobal> | null = null;

function loadMolstar(): Promise<MolstarGlobal> {
  if (window.molstar) return Promise.resolve(window.molstar);
  if (molstarLoading) return molstarLoading;
  molstarLoading = new Promise<MolstarGlobal>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${MOLSTAR_BASE}/molstar.css`;
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = `${MOLSTAR_BASE}/molstar.js`;
    script.async = true;
    script.onload = () => (window.molstar ? resolve(window.molstar) : reject(new Error("Mol* did not initialise")));
    script.onerror = () => reject(new Error("Could not load the Mol* viewer"));
    document.head.appendChild(script);
  });
  molstarLoading.catch(() => {
    molstarLoading = null;
  });
  return molstarLoading;
}

export function isSmallScreen(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

export interface StructureInfo {
  available: boolean;
  cifUrl?: string;
  paeImageUrl?: string;
  meanPlddt?: number;
  pageUrl?: string;
}

export class StructureViewer {
  private viewer: MolstarViewer | null = null;
  private loadToken = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly host: HTMLElement,
    private readonly overlay: HTMLElement,
  ) {}

  private setState(state: string, overlay: Node | string | null = null): void {
    this.container.dataset.state = state;
    this.overlay.replaceChildren();
    if (overlay instanceof Node) this.overlay.appendChild(overlay);
    else if (typeof overlay === "string") this.overlay.textContent = overlay;
  }

  /** Show a protein's structure, or the right message when there is none. */
  async show(structure: StructureInfo, label: string): Promise<void> {
    const token = ++this.loadToken;
    this.clearHighlight();

    if (!structure.available || !structure.cifUrl) {
      this.disposeViewer();
      const msg = document.createElement("div");
      const strong = document.createElement("p");
      strong.innerHTML = "<strong>No AlphaFold model for this protein.</strong>";
      const p = document.createElement("p");
      p.textContent =
        "AlphaFold DB covers most of UniProt but not all of it (very long proteins are one common gap). The rest of the dossier is still here.";
      msg.append(strong, p);
      this.setState("none", msg);
      return;
    }

    if (isSmallScreen()) {
      this.disposeViewer();
      this.showFallback(structure, label);
      return;
    }
    await this.load3d(structure, label, token);
  }

  private showFallback(structure: StructureInfo, label: string): void {
    const wrap = document.createElement("div");
    if (structure.paeImageUrl) {
      const img = document.createElement("img");
      img.className = "viewer-fallback-img";
      img.src = structure.paeImageUrl;
      img.alt = `AlphaFold predicted aligned error plot for ${label}`;
      img.loading = "lazy";
      img.width = 200;
      img.height = 200;
      const cap = document.createElement("p");
      cap.className = "hint";
      cap.textContent =
        "Static view: AlphaFold's predicted aligned error. Dark blocks along the diagonal are confidently-placed domains.";
      wrap.append(img, cap);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "button";
    btn.textContent = "Load interactive 3D model";
    btn.addEventListener("click", () => void this.load3d(structure, label, ++this.loadToken));
    wrap.appendChild(btn);
    this.setState("fallback", wrap);
  }

  private async load3d(structure: StructureInfo, label: string, token: number): Promise<void> {
    this.setState("loading", `Loading the AlphaFold model of ${label}…`);
    try {
      const molstar = await loadMolstar();
      if (token !== this.loadToken) return;
      if (!this.viewer) {
        this.viewer = await molstar.Viewer.create(this.host, {
          layoutIsExpanded: false,
          layoutShowControls: false,
          layoutShowRemoteState: false,
          layoutShowSequence: false,
          layoutShowLog: false,
          layoutShowLeftPanel: false,
          collapseLeftPanel: true,
          viewportShowExpand: true,
          viewportShowSelectionMode: false,
          viewportShowAnimation: false,
          viewportShowTrajectoryControls: false,
          pdbProvider: "pdbe",
        });
        this.resizeObserver = new ResizeObserver(() => this.viewer?.handleResize());
        this.resizeObserver.observe(this.host);
      } else {
        await this.viewer.plugin.clear();
      }
      if (token !== this.loadToken) return;
      await this.viewer.loadStructureFromUrl(structure.cifUrl!, "mmcif", false, {
        representationParams: { theme: { globalName: "plddt-confidence" } },
      });
      if (token !== this.loadToken) return;
      this.setState("ready");
      // Re-apply a highlight chosen while the model was still loading.
      const pending = this.container.dataset.highlight;
      if (pending) {
        const [s, e] = pending.split("-").map(Number);
        if (s && e) this.applyHighlight(s, e);
      }
    } catch (err) {
      if (token !== this.loadToken) return;
      const p = document.createElement("p");
      p.textContent = `The 3D viewer could not load (${err instanceof Error ? err.message : "unknown error"}). `;
      if (structure.pageUrl) {
        const a = document.createElement("a");
        a.href = structure.pageUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "View it on AlphaFold DB";
        p.appendChild(a);
      }
      this.setState("error", p);
    }
  }

  private applyHighlight(start: number, end: number): void {
    if (!this.viewer || this.container.dataset.state !== "ready") return;
    try {
      this.viewer.structureInteractivity({ action: "select" });
      this.viewer.structureInteractivity({
        elements: { beg_label_seq_id: start, end_label_seq_id: end },
        action: ["select", "focus"],
        focusOptions: { extraRadius: 4, durationMs: 400 },
      });
    } catch {
      // Highlighting is a nicety; never let it break the page.
    }
  }

  /** Highlight residues start..end (1-based, inclusive). */
  highlight(start: number, end: number): void {
    this.container.dataset.highlight = `${start}-${end}`;
    this.applyHighlight(start, end);
  }

  clearHighlight(): void {
    this.container.dataset.highlight = "";
    if (this.viewer && this.container.dataset.state === "ready") {
      try {
        this.viewer.structureInteractivity({ action: "select" });
      } catch {
        /* ignore */
      }
    }
  }

  private disposeViewer(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.viewer?.dispose();
    this.viewer = null;
    this.host.replaceChildren();
  }
}
