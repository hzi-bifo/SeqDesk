import { describe, it, expect, vi } from "vitest";
import {
  generateStudyXml,
  generateSampleXml,
  generateSubmissionXml,
  parseReceiptXml,
} from "./xml-generator";

describe("generateStudyXml", () => {
  it("generates valid PROJECT_SET XML", () => {
    const xml = generateStudyXml({
      alias: "test-study",
      title: "Test Study",
      description: "A test study description",
    });
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<PROJECT_SET>");
    expect(xml).toContain('alias="test-study"');
    expect(xml).toContain("<TITLE>Test Study</TITLE>");
    expect(xml).toContain("<SEQUENCING_PROJECT/>");
  });

  it("escapes XML special characters in alias", () => {
    const xml = generateStudyXml({
      alias: "study&1",
      title: "Study <with> special",
      description: "It's a \"test\"",
    });
    expect(xml).toContain('alias="study&amp;1"');
    expect(xml).toContain("Study &lt;with&gt; special");
    expect(xml).toContain("It&apos;s a &quot;test&quot;");
  });
});

describe("generateSampleXml", () => {
  it("generates SAMPLE_SET with single sample", () => {
    const xml = generateSampleXml([
      {
        alias: "sample-1",
        title: "Sample 1",
        taxId: "408170",
        scientificName: "human gut metagenome",
      },
    ]);
    expect(xml).toContain("<SAMPLE_SET>");
    expect(xml).toContain('alias="sample-1"');
    expect(xml).toContain("<TAXON_ID>408170</TAXON_ID>");
    expect(xml).toContain(
      "<SCIENTIFIC_NAME>human gut metagenome</SCIENTIFIC_NAME>"
    );
  });

  it("generates multiple samples", () => {
    const xml = generateSampleXml([
      { alias: "s1", title: "S1", taxId: "9606" },
      { alias: "s2", title: "S2", taxId: "9606" },
    ]);
    expect(xml).toContain('alias="s1"');
    expect(xml).toContain('alias="s2"');
  });

  it("includes checklist type as sample attribute", () => {
    const xml = generateSampleXml([
      {
        alias: "s1",
        title: "S1",
        taxId: "9606",
        checklistType: "ERC000011",
      },
    ]);
    expect(xml).toContain("<TAG>ENA-CHECKLIST</TAG>");
    expect(xml).toContain("<VALUE>ERC000011</VALUE>");
  });

  it("maps internal field names to ENA names", () => {
    const xml = generateSampleXml([
      {
        alias: "s1",
        title: "S1",
        taxId: "9606",
        attributes: { collection_date: "2024-01-15" },
      },
    ]);
    expect(xml).toContain("<TAG>collection date</TAG>");
    expect(xml).toContain("<VALUE>2024-01-15</VALUE>");
  });

  it("maps geo_loc_name to full ENA field name", () => {
    const xml = generateSampleXml([
      {
        alias: "s1",
        title: "S1",
        taxId: "9606",
        attributes: { geo_loc_name: "Germany" },
      },
    ]);
    expect(xml).toContain(
      "<TAG>geographic location (country and/or sea)</TAG>"
    );
  });

  it("skips empty attribute values", () => {
    const xml = generateSampleXml([
      {
        alias: "s1",
        title: "S1",
        taxId: "9606",
        attributes: { field1: "value", field2: "", field3: "   " },
      },
    ]);
    expect(xml).toContain("field1");
    expect(xml).not.toContain("field2");
    expect(xml).not.toContain("field3");
  });

  it("omits scientific name when not provided", () => {
    const xml = generateSampleXml([
      { alias: "s1", title: "S1", taxId: "9606" },
    ]);
    expect(xml).not.toContain("<SCIENTIFIC_NAME>");
  });

  it("omits SAMPLE_ATTRIBUTES when no attributes", () => {
    const xml = generateSampleXml([
      { alias: "s1", title: "S1", taxId: "9606" },
    ]);
    expect(xml).not.toContain("<SAMPLE_ATTRIBUTES>");
  });
});

describe("generateSubmissionXml", () => {
  it("generates ADD action by default", () => {
    const xml = generateSubmissionXml();
    expect(xml).toContain("<ADD/>");
    expect(xml).toContain("<SUBMISSION>");
  });

  it("generates VALIDATE action", () => {
    const xml = generateSubmissionXml("VALIDATE");
    expect(xml).toContain("<VALIDATE/>");
  });

  it("generates MODIFY action", () => {
    const xml = generateSubmissionXml("MODIFY");
    expect(xml).toContain("<MODIFY/>");
  });

  it("includes hold date when specified", () => {
    const xml = generateSubmissionXml("ADD", "2025-12-31");
    expect(xml).toContain('HoldUntilDate="2025-12-31"');
    expect(xml).toContain("<HOLD");
  });

  it("omits hold action when no date", () => {
    const xml = generateSubmissionXml("ADD");
    expect(xml).not.toContain("<HOLD");
  });
});

describe("parseReceiptXml", () => {
  it("parses successful receipt", () => {
    const xml = `<RECEIPT success="true" receiptDate="2024-01-15T12:00:00Z">
      <PROJECT alias="study-1" accession="PRJEB12345"/>
      <SAMPLE alias="sample-1" accession="ERS12345"/>
      <INFO>All objects submitted</INFO>
    </RECEIPT>`;
    const result = parseReceiptXml(xml);
    expect(result.success).toBe(true);
    expect(result.receiptDate).toBe("2024-01-15T12:00:00Z");
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].alias).toBe("study-1");
    expect(result.projects[0].accession).toBe("PRJEB12345");
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].accession).toBe("ERS12345");
    expect(result.messages).toContain("All objects submitted");
  });

  it("parses failed receipt with errors", () => {
    const xml = `<RECEIPT success="false">
      <ERROR>Invalid taxon ID</ERROR>
    </RECEIPT>`;
    const result = parseReceiptXml(xml);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("Invalid taxon ID");
  });

  it("parses multiple errors", () => {
    const xml = `<RECEIPT success="false">
      <ERROR>Error 1</ERROR>
      <ERROR>Error 2</ERROR>
    </RECEIPT>`;
    const result = parseReceiptXml(xml);
    expect(result.errors).toHaveLength(2);
  });

  it("parses project-specific EXT_ID values", () => {
    const xml = `<RECEIPT success="true">
      <PROJECT alias="project-1" accession="PRJ1">
        <EXT_ID accession="EXT1"/>
      </PROJECT>
      <PROJECT alias="project-2" accession="PRJ2">
        <EXT_ID accession="EXT2"/>
      </PROJECT>
    </RECEIPT>`;
    const result = parseReceiptXml(xml);
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].extId).toBe("EXT1");
    expect(result.projects[1].extId).toBe("EXT2");
  });

  it("keeps project accession when closing PROJECT tag is missing", () => {
    const xml = `<RECEIPT success="true">
      <PROJECT alias="project-1" accession="PRJ1">
        <EXT_ID accession="EXT1"/>
    </RECEIPT>`;
    const result = parseReceiptXml(xml);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toEqual({
      alias: "project-1",
      accession: "PRJ1",
      extId: undefined,
    });
  });

  it("handles sample aliases containing regex metacharacters", () => {
    const xml = `<RECEIPT success="true">
      <SAMPLE alias="sample(1" accession="ERS1">
        <EXT_ID accession="SAMEA1"/>
      </SAMPLE>
    </RECEIPT>`;
    const result = parseReceiptXml(xml);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].alias).toBe("sample(1");
    expect(result.samples[0].biosample).toBe("SAMEA1");
  });

  it("handles receipt with no projects or samples", () => {
    const xml = `<RECEIPT success="true">
      <INFO>Validation successful</INFO>
    </RECEIPT>`;
    const result = parseReceiptXml(xml);
    expect(result.success).toBe(true);
    expect(result.projects).toHaveLength(0);
    expect(result.samples).toHaveLength(0);
    expect(result.messages).toContain("Validation successful");
  });

  it("handles malformed XML gracefully", () => {
    const result = parseReceiptXml("not xml at all");
    expect(result.success).toBe(false);
    expect(result.projects).toHaveLength(0);
    expect(result.samples).toHaveLength(0);
  });

  it("returns a parser error for non-string receipt input", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = parseReceiptXml(null as unknown as string);
    expect(result.success).toBe(false);
    expect(result.errors).toContain("Failed to parse ENA receipt XML");
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});
