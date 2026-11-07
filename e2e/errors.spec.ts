import { expect, test } from "./fixtures";

const error = (code: string, message: string, status: number, retryAfter?: number) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify({ error: { code, message, ...(retryAfter ? { retryAfter } : {}) } }),
});

test.describe("error states", () => {
  test("RATE_LIMITED shows a readable message with the wait time", async ({ page }) => {
    await page.route("**/api/protein/P42212", (route) => route.fulfill(error("RATE_LIMITED", "Too many requests.", 429, 42)));
    await page.goto("/?p=P42212");
    await expect(page.getByRole("alert")).toHaveText("You're going a little fast. Please wait 42 seconds and try again.");
    await expect(page.getByRole("heading", { level: 2 })).toBeHidden();
  });

  test("NOT_FOUND shows a readable message", async ({ page }) => {
    await page.route("**/api/protein/A0A000", (route) =>
      route.fulfill(error("NOT_FOUND", "No UniProt entry found for A0A000.", 404)),
    );
    await page.goto("/?p=A0A000");
    await expect(page.getByRole("alert")).toHaveText("No UniProt entry found for A0A000.");
  });

  test("an invalid accession in the URL is rejected by the real Worker", async ({ page }) => {
    await page.goto("/?p=hello-world");
    await expect(page.getByRole("alert")).toHaveText("That is not a valid UniProt accession.");
  });

  test("UPSTREAM_UNAVAILABLE during search is explained", async ({ page }) => {
    await page.route("**/api/search?**", (route) => route.fulfill(error("UPSTREAM_UNAVAILABLE", "UniProt down", 502)));
    await page.goto("/?q=insulin");
    await expect(page.getByRole("alert")).toContainText("isn't answering right now");
  });

  test("narration RATE_LIMITED is shown in the narration panel, dossier stays", async ({ page }) => {
    await page.route("**/api/narrate", (route) => route.fulfill(error("RATE_LIMITED", "Too many requests.", 429, 60)));
    await page.goto("/?p=P42212");
    await expect(page.getByRole("heading", { level: 2, name: "Green fluorescent protein" })).toBeVisible();
    await expect(page.locator("#narration")).toContainText("Please wait 60 seconds");
  });

  test("too-short search is caught before any request", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search proteins" }).first().fill("a");
    await page.getByRole("button", { name: "Search", exact: true }).first().click();
    await expect(page.getByRole("alert")).toContainText("at least two characters");
  });
});
