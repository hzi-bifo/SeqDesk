import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface CoverageEntry {
  tier: "required" | "extended";
  proofs?: string[];
  reason?: string;
}

interface CoveragePolicy {
  schemaVersion: number;
  kits: Record<string, CoverageEntry>;
}

const repoRoot = process.cwd();
const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "explore-kit-coverage.json"), "utf8")) as CoveragePolicy;
const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "explore-e2e.yml"), "utf8");
const shippedKits = fs
  .readdirSync(path.join(repoRoot, "explore", "kits"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();

/**
 * Every shipped kit must be listed in the coverage policy, and the required
 * ones must be exercised by the Explore workflow: validated, run through
 * pytest in the real environment, and (where declared) executed through the
 * app. A kit that is not covered fails CI here instead of silently shipping.
 */
describe("explore kit coverage contract", () => {
  it("lists every shipped kit", () => {
    expect(Object.keys(policy.kits).sort()).toEqual(shippedKits);
  });

  it("gives every required kit its proofs", () => {
    for (const [kitId, entry] of Object.entries(policy.kits)) {
      if (entry.tier === "required") {
        expect(entry.proofs, `${kitId} needs proofs`).toEqual(expect.arrayContaining(["validate", "pytest"]));
      } else {
        expect(entry.reason, `${kitId} needs a reason for the extended tier`).toBeTruthy();
      }
    }
  });

  it("is exercised by the Explore workflow", () => {
    expect(workflow).toContain("npm run explore:validate");
    expect(workflow).toMatch(/pytest explore/);
    expect(workflow).toContain("playwright/tests/explore.spec.ts");
    for (const [kitId, entry] of Object.entries(policy.kits)) {
      if (entry.proofs?.includes("app-run")) {
        expect(workflow, `${kitId} must be run through the app`).toMatch(new RegExp(`EXPLORE_E2E_KIT[:=]\\s*${kitId}`));
      }
    }
  });
});
