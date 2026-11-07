import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

/**
 * Playwright drives Chromium against `wrangler dev`, seeded from fixtures.
 *
 * The server runs with its own persistence dir (seeded KV) and its own port, so a
 * `wrangler dev` you have open for development is never mistaken for it, and with
 * NEURON_DAILY_BUDGET=0 so no spec can ever spend real Workers AI neurons: a
 * narration cache miss goes through Turnstile (test keys) and then hits the
 * circuit breaker.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: [
      "npm run e2e:seed &&",
      `wrangler dev --port ${PORT} --persist-to .wrangler/e2e --show-interactive-dev-session=false`,
      "--var NEURON_DAILY_BUDGET:0",
      "--var TURNSTILE_SITE_KEY:1x00000000000000000000AA",
      "--var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA",
    ].join(" "),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        // Headless Chromium needs SwiftShader for Mol*'s WebGL.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
