import { DISCLAIMER, expect, test } from "./fixtures";

const TURNSTILE = /challenges\.cloudflare\.com/;

test.describe("narration", () => {
  test("cached narration streams in under the structure, with linked citations", async ({ page }) => {
    await page.goto("/?p=P42212");
    const narration = page.locator("#narration");
    await expect(narration).toHaveAttribute("data-state", "done");
    await expect(narration).toHaveAttribute("aria-busy", "false");
    await expect(narration.getByRole("heading", { name: "What it does" })).toBeVisible();
    await expect(narration.getByRole("heading", { name: "What goes wrong when it breaks" })).toBeVisible();
    await expect(narration).toContainText("energy-transfer acceptor");
    await expect(narration.getByRole("link", { name: "UniProt" }).first()).toHaveAttribute(
      "href",
      "https://www.uniprot.org/uniprotkb/P42212/entry",
    );
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
  });

  test("text arrives progressively through the streaming reader", async ({ page }) => {
    // Count the body chunks the page's reader actually receives for the narration.
    await page.addInitScript(() => {
      const w = window as unknown as { __chunks: number[] };
      w.__chunks = [];
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const res = await realFetch(input, init);
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith("/api/narrate") || !res.body) return res;
        const counted = res.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctrl) {
              w.__chunks.push(chunk.byteLength);
              ctrl.enqueue(chunk);
            },
          }),
        );
        return new Response(counted, { status: res.status, headers: res.headers });
      };
    });
    await page.goto("/?p=P42212");
    const narration = page.locator("#narration");
    await expect(narration).toHaveAttribute("data-state", "done");
    await expect(narration).toContainText("affect fluorescence");
    const chunks = await page.evaluate(() => (window as unknown as { __chunks: number[] }).__chunks);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("switching depth loads that depth's explanation", async ({ page }) => {
    await page.goto("/?p=P42212");
    const narration = page.locator("#narration");
    await expect(narration).toContainText("energy-transfer acceptor");
    await page.getByRole("radio", { name: "Curious" }).click();
    await expect(page.getByRole("radio", { name: "Curious" })).toHaveAttribute("aria-checked", "true");
    await expect(narration).toContainText("jellyfish protein that glows green");
    await page.getByRole("radio", { name: "Expert" }).click();
    await expect(narration).toContainText("Ca(2+)-triggered");
  });

  test("browsing cached proteins never loads Turnstile", async ({ page }) => {
    const turnstile: string[] = [];
    page.on("request", (r) => {
      if (TURNSTILE.test(r.url())) turnstile.push(r.url());
    });
    await page.goto("/?p=P42212");
    await expect(page.locator("#narration")).toHaveAttribute("data-state", "done");
    await page.getByRole("radio", { name: "Expert" }).click();
    await expect(page.locator("#narration")).toContainText("Ca(2+)-triggered");
    await page.goto("/?p=Q8WZ42");
    await expect(page.locator("#narration")).toContainText("giant muscle protein");
    expect(turnstile).toEqual([]);
    await expect(page.locator("#turnstile-box")).toBeHidden();
  });
});

test.describe("Turnstile and the AI budget (server runs with NEURON_DAILY_BUDGET=0)", () => {
  test("a narration cache miss shows Turnstile, then the budget banner", async ({ page }) => {
    const turnstileLoaded = page.waitForRequest(TURNSTILE);
    const verified = page.waitForRequest(
      (r) => r.url().endsWith("/api/narrate") && JSON.parse(r.postData() ?? "{}").turnstileToken !== undefined,
    );
    await page.goto("/?p=P04637");
    await expect(page.getByRole("heading", { level: 2, name: "Cellular tumor antigen p53" })).toBeVisible();
    await turnstileLoaded;
    await expect(page.getByText("One quick check before we write a fresh explanation")).toBeVisible();
    // The test site key passes automatically; the page retries with a fresh token.
    await verified;
    const banner = page.getByRole("alert").filter({ hasText: "Today's AI budget is used up" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("fresh ones resume at midnight UTC");
    await expect(page.locator("#narration")).toContainText("no cached explanation at this depth yet");
  });

  test("with the breaker tripped, cached narrations still work", async ({ page }) => {
    await page.goto("/?p=P04637");
    await expect(page.getByRole("alert").filter({ hasText: "Today's AI budget is used up" })).toBeVisible();
    await page.getByRole("link", { name: "foldspeak" }).click();
    await page.getByRole("list", { name: "Showcase proteins" }).getByRole("link", { name: "GFP" }).click();
    await expect(page.locator("#narration")).toContainText("energy-transfer acceptor");
    await expect(page.locator("#narration")).toHaveAttribute("data-state", "done");
  });
});
