import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page, type Route } from "@playwright/test";
import { MOLSTAR_VERSION } from "../public/molstar-version";

const MOLSTAR_DIR = "node_modules/molstar/build/viewer";
const STRUCTURES = "test/fixtures/structures";

const CONTENT_TYPES: Record<string, string> = {
  js: "application/javascript",
  css: "text/css",
  map: "application/json",
  png: "image/png",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};

function serveFile(route: Route, path: string): Promise<void> {
  const ext = path.split(".").pop() ?? "";
  return route.fulfill({
    status: 200,
    body: readFileSync(path),
    headers: { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream", "Access-Control-Allow-Origin": "*" },
  });
}

/**
 * Browser-side traffic that would leave the machine is served locally:
 * the pinned Mol* bundle from node_modules, and AlphaFold files from fixtures.
 * Turnstile is intentionally left alone: it runs for real with Cloudflare's test keys.
 */
export async function routeExternal(page: Page): Promise<void> {
  await page.route(`https://cdn.jsdelivr.net/npm/molstar@${MOLSTAR_VERSION}/build/viewer/**`, (route) => {
    const file = new URL(route.request().url()).pathname.split("/build/viewer/")[1] ?? "";
    return serveFile(route, join(MOLSTAR_DIR, file));
  });
  await page.route("https://alphafold.ebi.ac.uk/files/**", (route) => {
    const url = route.request().url();
    if (url.endsWith(".cif")) return serveFile(route, join(STRUCTURES, "P42212.cif"));
    if (url.endsWith(".png")) return serveFile(route, join(STRUCTURES, "P42212-pae.png"));
    return route.fulfill({ status: 404, body: "" });
  });
}

/**
 * Give each test its own client IP on API calls. The local Rate Limiting simulation
 * is real (6 narrations/min per IP), and every spec otherwise shares 127.0.0.1.
 * In production Cloudflare sets CF-Connecting-IP itself, so this cannot be spoofed.
 */
async function isolateClientIp(page: Page): Promise<void> {
  const ip = `10.${rand()}.${rand()}.${rand()}`;
  await page.route(/\/api\//, (route) =>
    route.fallback({ headers: { ...route.request().headers(), "cf-connecting-ip": ip } }),
  );
}

const rand = () => Math.floor(Math.random() * 254) + 1;

export const test = base.extend<{ external: void }>({
  external: [
    async ({ page }, use) => {
      await isolateClientIp(page);
      await routeExternal(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

export const DISCLAIMER =
  "Explanations are AI-generated from the linked database records. For research and education — not medical advice.";
