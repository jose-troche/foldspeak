import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd with the bindings from wrangler.toml, simulated locally.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      remoteBindings: false,
      miniflare: {
        bindings: {
          TURNSTILE_SECRET_KEY: "test-secret",
          NCBI_API_KEY: "",
        },
      },
    }),
  ],
  test: {
    // Only Worker tests; Playwright specs in e2e/ run separately.
    include: ["test/**/*.test.ts"],
  },
});
