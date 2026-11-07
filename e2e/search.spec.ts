import { readFileSync } from "node:fs";
import { DISCLAIMER, expect, test } from "./fixtures";

const searchGfp = readFileSync("e2e/fixtures/search-gfp.json", "utf8");

test.describe("search → dossier", () => {
  test.beforeEach(async ({ page }) => {
    // Search is a live UniProt passthrough (never cached), so serve it from a fixture.
    await page.route("**/api/search?q=GFP", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: searchGfp }),
    );
  });

  test("type GFP, pick the result, and see the dossier with sources", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "An AI guide to any protein on Earth" })).toBeVisible();

    await page.getByRole("searchbox", { name: "Search proteins" }).first().fill("GFP");
    await page.getByRole("button", { name: "Search", exact: true }).first().click();

    await expect(page).toHaveURL(/\?q=GFP/);
    const results = page.getByRole("list").filter({ has: page.getByRole("link", { name: /Green fluorescent protein/ }) });
    await expect(results.getByRole("link")).toHaveCount(3);
    await expect(page.getByText("Reviewed", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: /Green fluorescent protein.*Aequorea victoria ·/ }).click();
    await expect(page).toHaveURL(/\?p=P42212/);

    await expect(page.getByRole("heading", { level: 2, name: "Green fluorescent protein" })).toBeVisible();
    const meta = page.getByRole("article").getByText(/amino acids/);
    await expect(meta).toContainText("Aequorea victoria");
    await expect(meta).toContainText("238 amino acids");

    const fn = page.getByRole("region", { name: "Function UniProt" });
    await expect(fn).toContainText("aequorin");

    const regions = page.getByRole("region", { name: "Functional regions" });
    await expect(regions.getByRole("button", { name: /5-imidazolinone \(Ser-Gly\), cross-link, residues 65–67/ })).toBeVisible();

    const sources = page.getByRole("region", { name: "Sources" });
    for (const name of ["UniProt", "AlphaFold DB", "InterPro", "PubMed"]) {
      await expect(sources.getByRole("link", { name, exact: true })).toHaveAttribute("href", /^https:\/\//);
    }
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
  });

  test("browser back returns to the results", async ({ page }) => {
    await page.goto("/?q=GFP");
    await page.getByRole("link", { name: /Green fluorescent protein.*Aequorea victoria ·/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Green fluorescent protein" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: /Results for “GFP”/ })).toBeVisible();
  });

  test("showcase chips open curated proteins", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("list", { name: "Showcase proteins" }).getByRole("link", { name: "GFP" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Green fluorescent protein" })).toBeVisible();
  });
});
