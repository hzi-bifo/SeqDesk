import { describe, it, expect } from "vitest";
import type { FormFieldDefinition } from "@/types/form-config";

import { parseSampleExcel } from "./sample-parser";

function makeField(
  overrides: Partial<FormFieldDefinition>
): FormFieldDefinition {
  return {
    id: "field",
    type: "text",
    label: "Field",
    name: "field",
    required: false,
    visible: true,
    order: 0,
    ...overrides,
  } as FormFieldDefinition;
}

async function createExcelFile(
  headers: string[],
  rows: Array<Record<string, unknown>>
): Promise<File> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Samples");

  sheet.addRow(headers);

  for (const row of rows) {
    const rowValues = headers.map((header) => row[header] ?? null);
    sheet.addRow(rowValues);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], "samples.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseSampleExcel", () => {
  it("parses valid workbook with mapped headers", async () => {
    const fields = [
      makeField({ type: "text", label: "Sample Title", name: "sample_title", required: true }),
      makeField({
        type: "organism",
        label: "Organism",
        name: "_organism",
        required: true,
      }),
      makeField({
        type: "select",
        label: "Site",
        name: "site",
        options: [
          { value: "A", label: "A" },
          { value: "B", label: "B" },
        ],
      }),
      makeField({
        type: "multiselect",
        label: "Tags",
        name: "tags",
        options: [
          { value: "t1", label: "Tag1" },
          { value: "t2", label: "Tag2" },
        ],
      }),
      makeField({
        type: "number",
        label: "Depth",
        name: "depth",
      }),
      makeField({ type: "checkbox", label: "Consent", name: "consent", required: true }),
    ];

    const file = await createExcelFile(
      [
        "Sample ID",
        "sample_title",
        "_organism_taxId",
        "site",
        "tags",
        "depth",
        "consent",
      ],
      [
        {
          "Sample ID": "S1",
          sample_title: "A sample",
          _organism_taxId: "9606",
          site: "A",
          tags: "t1; t2",
          depth: "15",
          consent: "Yes",
        },
      ]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.unmappedColumns).toEqual([]);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]).toMatchObject({
      sampleId: "S1",
      sample_title: "A sample",
      taxId: "9606",
      tax_id: "9606",
      scientificName: "Homo sapiens",
      site: "A",
      tags: ["t1", "t2"],
      depth: 15,
      consent: true,
    });
  });

  it("matches headers with and without required asterisk", async () => {
    const fields = [makeField({ label: "Sample Title", name: "sample_title", required: true })];

    const withAsterisk = await createExcelFile(
      ["Sample ID", "Sample Title *"],
      [{ "Sample ID": "S1", "Sample Title *": "with-star" }]
    );
    const withoutAsterisk = await createExcelFile(
      ["Sample ID", "Sample Title"],
      [{ "Sample ID": "S2", "Sample Title": "without-star" }]
    );

    const parsedAsterisk = await parseSampleExcel(withAsterisk, fields);
    const parsedNoAsterisk = await parseSampleExcel(withoutAsterisk, fields);

    expect(parsedAsterisk.samples[0].sample_title).toBe("with-star");
    expect(parsedNoAsterisk.samples[0].sample_title).toBe("without-star");
  });

  it("ignores rows that only contain prefilled sample ID", async () => {
    const fields = [makeField({ label: "Sample Title", name: "sample_title" })];

    const file = await createExcelFile(
      ["Sample ID", "sample_title"],
      [
        { "Sample ID": "S-only" },
        { "Sample ID": "S-data", sample_title: "real data" },
      ]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.totalRows).toBe(2);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].sampleId).toBe("S-data");
  });

  it("reports unmapped columns", async () => {
    const fields = [makeField({ label: "Sample Title", name: "sample_title" })];
    const file = await createExcelFile(
      ["Sample ID", "sample_title", "Unknown Column"],
      [{ "Sample ID": "S1", sample_title: "ok", "Unknown Column": "x" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.unmappedColumns).toEqual(["Unknown Column"]);
  });

  it("returns required error for missing required text", async () => {
    const fields = [
      makeField({ label: "Sample Title", name: "sample_title", required: true }),
      makeField({
        type: "select",
        label: "Site",
        name: "site",
        options: [{ value: "A", label: "A" }],
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "sample_title", "site"],
      [{ "Sample ID": "S1", sample_title: "", site: "A" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors.some((e) => e.field === "Sample Title" && e.message === "Required")).toBe(true);
  });

  it("requires required checkbox to be Yes/true", async () => {
    const fields = [
      makeField({ type: "checkbox", label: "Consent", name: "consent", required: true }),
      makeField({ label: "Sample Title", name: "sample_title" }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "consent", "sample_title"],
      [{ "Sample ID": "S1", consent: "No", sample_title: "data" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors.some((e) => e.field === "Consent" && e.message.includes("must be Yes"))).toBe(true);
  });

  it("validates select options", async () => {
    const fields = [
      makeField({
        type: "select",
        label: "Site",
        name: "site",
        options: [
          { value: "A", label: "A" },
          { value: "B", label: "B" },
        ],
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "site"],
      [{ "Sample ID": "S1", site: "INVALID" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors.some((e) => e.field === "Site" && e.message.startsWith("Invalid option"))).toBe(true);
  });

  it("validates multiselect options per value", async () => {
    const fields = [
      makeField({
        type: "multiselect",
        label: "Tags",
        name: "tags",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "tags"],
      [{ "Sample ID": "S1", tags: "a; bad" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors.some((e) => e.field === "Tags" && e.value === "bad")).toBe(true);
  });

  it("validates number min/max", async () => {
    const fields = [
      makeField({
        type: "number",
        label: "Depth",
        name: "depth",
        simpleValidation: { minValue: 10, maxValue: 20 },
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "depth"],
      [
        { "Sample ID": "S1", depth: 5 },
        { "Sample ID": "S2", depth: 25 },
      ]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors.some((e) => e.message === "Minimum value: 10")).toBe(true);
    expect(result.errors.some((e) => e.message === "Maximum value: 20")).toBe(true);
  });

  it("validates regex pattern and ignores invalid regex config", async () => {
    const fields = [
      makeField({
        label: "Code",
        name: "code",
        simpleValidation: {
          pattern: "^ABC\\d+$",
          patternMessage: "Bad code",
        },
      }),
      makeField({
        label: "Broken Pattern",
        name: "broken_pattern",
        simpleValidation: { pattern: "[" },
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "code", "broken_pattern"],
      [{ "Sample ID": "S1", code: "XYZ", broken_pattern: "anything" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors.some((e) => e.field === "Code" && e.message === "Bad code")).toBe(true);
    expect(result.errors.some((e) => e.field === "Broken Pattern")).toBe(false);
  });

  it("resolves organism by known tax ID", async () => {
    const fields = [
      makeField({
        type: "organism",
        label: "Organism",
        name: "_organism",
        required: true,
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "_organism_taxId"],
      [{ "Sample ID": "S1", _organism_taxId: "9606" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.samples[0]).toMatchObject({
      taxId: "9606",
      tax_id: "9606",
      scientificName: "Homo sapiens",
    });
  });

  it("warns for unknown tax ID without scientific name", async () => {
    const fields = [
      makeField({
        type: "organism",
        label: "Organism",
        name: "_organism",
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "_organism_taxId"],
      [{ "Sample ID": "S1", _organism_taxId: "999999999" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.warnings.some((w) => w.field === "Tax ID" && w.message.includes("not found"))).toBe(true);
    expect(result.samples[0].scientificName).toBe("");
  });

  it("resolves organism from exact scientific name", async () => {
    const fields = [
      makeField({
        type: "organism",
        label: "Organism",
        name: "_organism",
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "_organism_scientificName"],
      [{ "Sample ID": "S1", _organism_scientificName: "Homo sapiens" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.warnings).toEqual([]);
    expect(result.samples[0]).toMatchObject({
      taxId: "9606",
      tax_id: "9606",
      scientificName: "Homo sapiens",
    });
  });

  it("warns for non-exact scientific name and keeps provided value", async () => {
    const fields = [
      makeField({
        type: "organism",
        label: "Organism",
        name: "_organism",
      }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "_organism_scientificName"],
      [{ "Sample ID": "S1", _organism_scientificName: "Homo sapi" }]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.warnings.some((w) => w.field === "Organism" && w.message.includes("Did you mean"))).toBe(true);
    expect(result.samples[0]).toMatchObject({
      taxId: "",
      tax_id: "",
      scientificName: "Homo sapi",
    });
  });

  it("validates barcodes when options are provided", async () => {
    const fields = [makeField({ type: "barcode", label: "Barcode", name: "barcode" })];

    const file = await createExcelFile(
      ["Sample ID", "barcode"],
      [{ "Sample ID": "S1", barcode: "BAD" }]
    );

    const result = await parseSampleExcel(file, fields, {
      options: [{ value: "BC01", label: "BC01" }],
    });

    expect(result.errors.some((e) => e.field === "Barcode" && e.message.startsWith("Invalid barcode"))).toBe(true);
  });

  it("warns when barcode values are present but no options exist", async () => {
    const fields = [makeField({ type: "barcode", label: "Barcode", name: "barcode" })];

    const file = await createExcelFile(
      ["Sample ID", "barcode"],
      [{ "Sample ID": "S1", barcode: "BC01" }]
    );

    const result = await parseSampleExcel(file, fields, null);

    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.field === "Barcode" && w.message.includes("no sequencing kit is selected"))).toBe(true);
  });

  it("normalizes richText and formula result cell values", async () => {
    const fields = [
      makeField({ label: "Sample Title", name: "sample_title" }),
      makeField({ type: "number", label: "Depth", name: "depth" }),
    ];

    const file = await createExcelFile(
      ["Sample ID", "sample_title", "depth"],
      [
        {
          "Sample ID": "S1",
          sample_title: {
            richText: [{ text: "Rich" }, { text: " Text" }],
          },
          depth: {
            formula: "6+6",
            result: 12,
          },
        },
      ]
    );

    const result = await parseSampleExcel(file, fields);

    expect(result.errors).toEqual([]);
    expect(result.samples[0].sample_title).toBe("Rich Text");
    expect(result.samples[0].depth).toBe(12);
  });
});
