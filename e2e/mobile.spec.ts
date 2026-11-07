import { expect, test } from "./fixtures";

test.describe("mobile fallback", () => {
  test("small screens show the static image instead of Mol*", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    const molstarRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("molstar")) molstarRequests.push(r.url());
    });
    await page.goto("/?p=P42212");
    const viewer = page.locator("#viewer");
    await expect(viewer).toHaveAttribute("data-state", "fallback");
    const img = page.getByRole("img", { name: /AlphaFold predicted aligned error plot for Green fluorescent protein/ });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await expect(viewer.locator("canvas")).toHaveCount(0);
    expect(molstarRequests).toEqual([]);
    await expect(page.getByRole("button", { name: "Load interactive 3D model" })).toBeVisible();
    // The pLDDT legend describes the 3D model, so it is hidden in the static view.
    await expect(page.getByRole("list", { name: "Model confidence (pLDDT)" })).toBeHidden();
  });

  test("page has no horizontal scroll at phone width", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.goto("/?p=P04637");
    await expect(page.getByRole("heading", { level: 2, name: "Cellular tumor antigen p53" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
