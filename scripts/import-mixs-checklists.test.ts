import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildChecklistIndex,
  checkChecklistIndex,
  importLegacyXmlChecklists,
  renderChecklistIndex,
  writeChecklistIndex,
} from "./import-mixs-checklists";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "seqdesk-mixs-index-"));
  temporaryDirectories.push(directory);
  return directory;
}

function checklist(name: string, accession: string, required: boolean[]) {
  return {
    name,
    description: `${name} description`,
    version: "1.0.0",
    source: `https://www.ebi.ac.uk/ena/browser/view/${accession}`,
    category: "mixs",
    accession,
    fields: required.map((isRequired, index) => ({
      type: "text",
      label: `Field ${index}`,
      name: `field_${index}`,
      required: isRequired,
      visible: true,
    })),
  };
}

function legacyChecklistXml(accession: string, label: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CHECKLIST accession="${accession}">
  <DESCRIPTOR>
    <LABEL>${label}</LABEL>
    <NAME>${label}</NAME>
    <DESCRIPTION>Imported checklist description</DESCRIPTION>
  </DESCRIPTOR>
  <FIELD_GROUP>
    <NAME>Core fields</NAME>
    <FIELD>
      <LABEL>Sample name</LABEL>
      <NAME>sample name</NAME>
      <DESCRIPTION>Stable sample identifier</DESCRIPTION>
      <MANDATORY>mandatory</MANDATORY>
    </FIELD>
  </FIELD_GROUP>
</CHECKLIST>
`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("MIxS checklist baseline index", () => {
  it("uses actual filenames and produces deterministic counts and ordering", () => {
    const directory = makeTemporaryDirectory();
    writeFileSync(
      path.join(directory, "mixs-zeta.json"),
      JSON.stringify(checklist("Zeta", "ERC-Z", [true, false])),
    );
    writeFileSync(
      path.join(directory, "mixs-alpha.json"),
      JSON.stringify(checklist("Alpha", "ERC-A", [true, true, false])),
    );

    expect(buildChecklistIndex(directory)).toEqual({
      version: 1,
      source: "ENA MIxS Checklists (each JSON definition records its ENA accession URL)",
      checklists: [
        {
          name: "Alpha",
          file: "mixs-alpha.json",
          fieldCount: 3,
          mandatoryCount: 2,
        },
        {
          name: "Zeta",
          file: "mixs-zeta.json",
          fieldCount: 2,
          mandatoryCount: 1,
        },
      ],
    });
    expect(renderChecklistIndex(directory)).not.toContain('"generated"');
  });

  it("detects a stale index and accepts the generated index byte for byte", () => {
    const directory = makeTemporaryDirectory();
    writeFileSync(
      path.join(directory, "mixs-air.json"),
      JSON.stringify(checklist("Air", "ERC-AIR", [true, false])),
    );
    writeFileSync(path.join(directory, "_index.json"), "{}\n");
    expect(checkChecklistIndex(directory)).toBe(false);

    const indexPath = writeChecklistIndex(directory);
    expect(checkChecklistIndex(directory)).toBe(true);
    expect(readFileSync(indexPath, "utf-8")).toBe(renderChecklistIndex(directory));
  });

  it("matches the committed repository baseline", () => {
    const directory = path.join(
      process.cwd(),
      "data",
      "field-templates",
      "mixs-full",
    );
    expect(readFileSync(path.join(directory, "_index.json"), "utf-8")).toBe(
      renderChecklistIndex(directory),
    );
  });

  it("requires an explicit existing directory for legacy XML import", () => {
    const directory = makeTemporaryDirectory();
    expect(() =>
      importLegacyXmlChecklists(path.join(directory, "missing"), directory),
    ).toThrow("MIxS XML source directory does not exist");
  });

  it("refreshes an existing checklist by accession and preserves its canonical filename", () => {
    const directory = makeTemporaryDirectory();
    const sourceDirectory = path.join(directory, "xml");
    const outputDirectory = path.join(directory, "baseline");
    mkdirSync(sourceDirectory);
    mkdirSync(outputDirectory);
    writeFileSync(
      path.join(outputDirectory, "mixs-default.json"),
      `${JSON.stringify(checklist("Old default", "ERC-DEFAULT", [false]), null, 2)}\n`,
    );
    writeChecklistIndex(outputDirectory);
    writeFileSync(
      path.join(sourceDirectory, "ENADefaultSampleChecklist.xml"),
      legacyChecklistXml("ERC-DEFAULT", "Updated default"),
    );

    expect(importLegacyXmlChecklists(sourceDirectory, outputDirectory)).toBe(1);

    expect(
      existsSync(
        path.join(outputDirectory, "mixs-ena-default-sample-checklist.json"),
      ),
    ).toBe(false);
    expect(
      JSON.parse(
        readFileSync(path.join(outputDirectory, "mixs-default.json"), "utf-8"),
      ),
    ).toMatchObject({
      name: "Updated default",
      accession: "ERC-DEFAULT",
      fields: [
        expect.objectContaining({
          name: "sample_name",
          required: true,
        }),
      ],
    });
    expect(buildChecklistIndex(outputDirectory).checklists).toEqual([
      {
        name: "Updated default",
        file: "mixs-default.json",
        fieldCount: 1,
        mandatoryCount: 1,
      },
    ]);
    expect(checkChecklistIndex(outputDirectory)).toBe(true);
  });

  it("leaves the baseline unchanged when imported accessions are duplicated", () => {
    const directory = makeTemporaryDirectory();
    const sourceDirectory = path.join(directory, "xml");
    const outputDirectory = path.join(directory, "baseline");
    mkdirSync(sourceDirectory);
    mkdirSync(outputDirectory);
    writeFileSync(
      path.join(outputDirectory, "mixs-default.json"),
      `${JSON.stringify(checklist("Committed default", "ERC-DEFAULT", [false]), null, 2)}\n`,
    );
    writeChecklistIndex(outputDirectory);
    const committedTemplate = readFileSync(
      path.join(outputDirectory, "mixs-default.json"),
      "utf-8",
    );
    const committedIndex = readFileSync(
      path.join(outputDirectory, "_index.json"),
      "utf-8",
    );
    writeFileSync(
      path.join(sourceDirectory, "First.xml"),
      legacyChecklistXml("ERC-DEFAULT", "First import"),
    );
    writeFileSync(
      path.join(sourceDirectory, "Second.xml"),
      legacyChecklistXml("ERC-DEFAULT", "Second import"),
    );

    expect(() =>
      importLegacyXmlChecklists(sourceDirectory, outputDirectory),
    ).toThrow("Duplicate imported MIxS checklist accession ERC-DEFAULT");
    expect(
      readFileSync(path.join(outputDirectory, "mixs-default.json"), "utf-8"),
    ).toBe(committedTemplate);
    expect(readFileSync(path.join(outputDirectory, "_index.json"), "utf-8")).toBe(
      committedIndex,
    );
    expect(existsSync(path.join(outputDirectory, "mixs-first.json"))).toBe(false);
    expect(existsSync(path.join(outputDirectory, "mixs-second.json"))).toBe(false);
  });
});
