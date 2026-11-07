import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { MOLSTAR_VERSION } from "../public/molstar-version";

describe("Mol* pin", () => {
  it("the CDN version the page loads matches the devDependency e2e serves locally", () => {
    expect((pkg.devDependencies as Record<string, string>).molstar).toBe(MOLSTAR_VERSION);
  });
});
