import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

interface CitationMetadata {
  "cff-version"?: string;
  title?: string;
  version?: string;
  "date-released"?: string;
  "repository-code"?: string;
  authors?: Array<{
    "family-names"?: string;
    "given-names"?: string;
  }>;
}

describe("software citation metadata", () => {
  it("is complete enough to cite and matches the application release", () => {
    const repositoryRoot = process.cwd();
    const licenseText = fs.readFileSync(
      path.join(repositoryRoot, "LICENSE"),
      "utf8"
    );
    const packageManifest = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
    ) as { version: string };
    const citation = load(
      fs.readFileSync(path.join(repositoryRoot, "CITATION.cff"), "utf8")
    ) as CitationMetadata;
    const releaseBuilder = fs.readFileSync(
      path.join(repositoryRoot, "scripts", "build-release.sh"),
      "utf8"
    );

    expect(citation["cff-version"]).toBe("1.2.0");
    expect(citation.title).toBe("SeqDesk");
    expect(citation.version).toBe(packageManifest.version);
    expect(citation["date-released"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(citation["repository-code"]).toBe(
      "https://github.com/hzi-bifo/SeqDesk"
    );
    expect(citation.authors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "family-names": "Münch",
          "given-names": "Philipp",
        }),
      ])
    );
    for (const documentationAsset of [
      "CITATION.cff",
      "LICENSE",
      "README.md",
      "AWS_EC2_INSTALLATION.md",
      "CONTRIBUTING.md",
      "EXAMPLE_DATASETS.md",
      "INSTALLATION_COMPATIBILITY.md",
    ]) {
      expect(releaseBuilder).toMatch(
        new RegExp(`for item in [^\\n]*\\b${documentationAsset.replace(".", "\\.")}\\b`)
      );
    }
    expect(
      fs.readFileSync(
        path.join(repositoryRoot, "npm", "seqdesk", "LICENSE"),
        "utf8"
      )
    ).toBe(licenseText);
  });
});
