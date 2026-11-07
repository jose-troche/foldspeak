import { expect, test } from "./fixtures";

test.describe("structure", () => {
  test("Mol* mounts and the loading state clears", async ({ page, isMobile }) => {
    test.skip(isMobile, "small screens get the static fallback (mobile.spec.ts)");
    await page.goto("/?p=P42212");
    const viewer = page.locator("#viewer");
    await expect(viewer).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
    await expect(viewer.locator("canvas")).toBeVisible();
    await expect(page.getByText(/Loading the AlphaFold model/)).toBeHidden();
    await expect(page.getByText("AlphaFold model · mean pLDDT 96.6")).toBeVisible();
    await expect(page.getByRole("list", { name: "Model confidence (pLDDT)" })).toContainText("Very high >90");
  });

  test("clicking a region highlights that span, clicking again clears it", async ({ page }) => {
    await page.goto("/?p=P42212");
    const viewer = page.locator("#viewer");
    const chromophore = page.getByRole("button", { name: /5-imidazolinone \(Ser-Gly\), cross-link, residues 65–67/ });

    await chromophore.click();
    await expect(chromophore).toHaveAttribute("aria-pressed", "true");
    await expect(viewer).toHaveAttribute("data-highlight", "65-67");
    await expect(page.getByRole("button", { name: "Clear highlight" })).toBeVisible();

    // GFP's InterPro entries are families; any InterPro region exercises the same path.
    const domain = page.getByRole("button", { name: /, (domain|family), residues \d+–\d+/ }).first();
    await domain.click();
    const range = /residues (\d+)–(\d+)/.exec((await domain.getAttribute("aria-label")) ?? "");
    await expect(viewer).toHaveAttribute("data-highlight", `${range?.[1]}-${range?.[2]}`);
    await expect(chromophore).toHaveAttribute("aria-pressed", "false");

    await domain.click();
    await expect(viewer).toHaveAttribute("data-highlight", "");
    await expect(page.getByRole("button", { name: "Clear highlight" })).toBeHidden();
  });

  test("a protein with no AlphaFold model shows the dossier and a clear message, not an error", async ({ page }) => {
    await page.goto("/?p=Q8WZ42");
    await expect(page.getByRole("heading", { level: 2, name: "Titin" })).toBeVisible();
    await expect(page.locator("#viewer")).toHaveAttribute("data-state", "none");
    await expect(page.getByText("No AlphaFold model for this protein.")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Sources" }).getByRole("link", { name: "AlphaFold DB" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: /Disease annotations/ })).toContainText("Database annotations, not medical information.");
  });
});
