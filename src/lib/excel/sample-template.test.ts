import { describe, expect, it } from "vitest";
import type { FormFieldDefinition } from "@/types/form-config";

import { generateSampleTemplate } from "./sample-template";

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

async function loadWorkbookFromBlob(blob: Blob) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await blob.arrayBuffer());
  await workbook.xlsx.load(buffer);
  return workbook;
}

function sheetText(sheet: { eachRow: (cb: (row: { values: unknown[] }) => void) => void }): string {
  const lines: string[] = [];
  sheet.eachRow((row) => {
    lines.push(
      row.values
        .slice(1)
        .map((v) => (v == null ? "" : String(v)))
        .join(" | ")
    );
  });
  return lines.join("\n");
}

describe("generateSampleTemplate", () => {
  it("creates starter rows with generated sample IDs when no existing samples", async () => {
    const fields = [
      makeField({ type: "text", label: "Sample Title", name: "sample_title", required: true }),
    ];

    const blob = await generateSampleTemplate(fields, []);
    const workbook = await loadWorkbookFromBlob(blob);
    const samples = workbook.getWorksheet("Samples");

    expect(samples).toBeDefined();
    expect(samples?.getRow(1).getCell(1).value).toBe("Sample ID *");
    expect(samples?.rowCount).toBe(11);

    for (let row = 2; row <= 11; row++) {
      const id = String(samples?.getRow(row).getCell(1).value || "");
      expect(id).toMatch(/^S-\d+-[A-Z0-9]{5}$/);
      expect(samples?.getRow(row).getCell(2).value).toBe("");
    }
  });

  it("populates rows from existing samples including organism columns", async () => {
    const fields = [
      makeField({ type: "organism", label: "Organism", name: "_organism", required: true }),
      makeField({
        type: "multiselect",
        label: "Tags",
        name: "tags",
        options: [
          { value: "t1", label: "Tag 1" },
          { value: "t2", label: "Tag 2" },
        ],
      }),
      makeField({ type: "number", label: "Depth", name: "depth" }),
    ];

    const blob = await generateSampleTemplate(fields, [
      {
        id: "1",
        sampleId: "S-001",
        scientificName: "Homo sapiens",
        taxId: "9606",
        tags: ["t1", "t2"],
        depth: 42,
      },
    ]);

    const workbook = await loadWorkbookFromBlob(blob);
    const samples = workbook.getWorksheet("Samples");

    expect(samples?.rowCount).toBe(2);
    expect(samples?.getRow(2).getCell(1).value).toBe("S-001");
    expect(samples?.getRow(2).getCell(2).value).toBe("Homo sapiens");
    expect(samples?.getRow(2).getCell(3).value).toBe("9606");
    expect(samples?.getRow(2).getCell(4).value).toBe("t1; t2");
    expect(samples?.getRow(2).getCell(5).value).toBe(42);
  });

  it("writes instructions with special notes and entity name", async () => {
    const fields = [
      makeField({ type: "organism", label: "Organism", name: "_organism" }),
      makeField({ type: "multiselect", label: "Tags", name: "tags" }),
      makeField({ type: "barcode", label: "Barcode", name: "barcode" }),
    ];

    const withoutBarcodeOptions = await generateSampleTemplate(
      fields,
      [],
      null,
      "Study A"
    );
    const withoutWorkbook = await loadWorkbookFromBlob(withoutBarcodeOptions);
    const withoutInstructions = withoutWorkbook.getWorksheet("Instructions");
    const withoutText = sheetText(withoutInstructions as never);

    expect(withoutText).toContain("Sample Data Template (Study A)");
    expect(withoutText).toContain("Multi-select fields");
    expect(withoutText).toContain("Select a kit first, then download a fresh template");

    const withBarcodeOptions = await generateSampleTemplate(
      fields,
      [],
      { options: [{ value: "BC01", label: "BC01" }] },
      "Study B"
    );
    const withWorkbook = await loadWorkbookFromBlob(withBarcodeOptions);
    const withInstructions = withWorkbook.getWorksheet("Instructions");
    const withText = sheetText(withInstructions as never);

    expect(withText).toContain("Sample Data Template (Study B)");
    expect(withText).toContain("Select from the dropdown. Options depend on the sequencing kit");
  });

  it("adds validation sheets and validation rules", async () => {
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
      makeField({
        type: "number",
        label: "Depth",
        name: "depth",
        simpleValidation: { minValue: 1, maxValue: 10 },
      }),
      makeField({
        type: "text",
        label: "Code",
        name: "code",
        simpleValidation: { maxLength: 5 },
      }),
    ];

    const blob = await generateSampleTemplate(fields, []);
    const workbook = await loadWorkbookFromBlob(blob);

    const validationSheet = workbook.getWorksheet("_ValidationLists");
    expect(validationSheet).toBeDefined();
    expect(validationSheet?.state).toBe("veryHidden");

    const samples = workbook.getWorksheet("Samples");
    const siteDv = samples?.getCell("B2").dataValidation;
    const depthDv = samples?.getCell("C2").dataValidation;
    const codeDv = samples?.getCell("D2").dataValidation;

    expect(siteDv.type).toBe("list");
    expect(Array.isArray(siteDv.formulae)).toBe(true);
    expect(String(siteDv.formulae?.[0] || "")).toContain("_ValidationLists");

    expect(depthDv.type).toBe("whole");
    expect(depthDv.error).toContain("between 1 and 10");

    expect(codeDv.type).toBe("textLength");
    expect(codeDv.error).toContain("Maximum 5 characters");
  });

  it("supports decimal number validation", async () => {
    const fields = [
      makeField({
        type: "number",
        label: "Ratio",
        name: "ratio",
        simpleValidation: {
          minValue: 0.5,
          maxValue: 2.5,
        },
      }),
    ];

    const blob = await generateSampleTemplate(fields, []);
    const workbook = await loadWorkbookFromBlob(blob);
    const samples = workbook.getWorksheet("Samples");

    const ratioDv = samples?.getCell("B2").dataValidation;
    expect(ratioDv.type).toBe("decimal");
    expect(ratioDv.operator).toBe("between");
    expect(String(ratioDv.formulae?.[0] || "")).toBe("0.5");
    expect(String(ratioDv.formulae?.[1] || "")).toBe("2.5");
    expect(ratioDv.error).toContain("between 0.5 and 2.5");
  });

  it("supports number validation with only a minimum bound", async () => {
    const fields = [
      makeField({
        type: "number",
        label: "Count",
        name: "count",
        simpleValidation: {
          minValue: 1,
        },
      }),
    ];

    const blob = await generateSampleTemplate(fields, []);
    const workbook = await loadWorkbookFromBlob(blob);
    const samples = workbook.getWorksheet("Samples");

    const countDv = samples?.getCell("B2").dataValidation;
    expect(countDv.type).toBe("whole");
    expect(countDv.operator).toBe("greaterThanOrEqual");
    expect(String(countDv.formulae?.[0] || "")).toBe("1");
    expect(countDv.error).toContain(">= 1");
  });

  it("supports optional select fields without options", async () => {
    const fields = [
      makeField({
        type: "select",
        label: "Optional",
        name: "optional",
        options: [],
      }),
    ];

    const blob = await generateSampleTemplate(fields, []);
    const workbook = await loadWorkbookFromBlob(blob);
    const samples = workbook.getWorksheet("Samples");

    expect(samples?.getCell("B2").dataValidation).toBeUndefined();
  });

  it("supports validation columns beyond Z", async () => {
    const fields: FormFieldDefinition[] = Array.from({ length: 27 }, (_, i) =>
      makeField({
        id: `f-${i}`,
        type: "select",
        label: `Field ${i + 1}`,
        name: `field_${i + 1}`,
        options: [{ value: "X", label: "X" }],
        order: i,
      })
    );

    const blob = await generateSampleTemplate(fields, []);
    const workbook = await loadWorkbookFromBlob(blob);
    const samples = workbook.getWorksheet("Samples");

    expect(samples?.getCell("AA2").dataValidation.type).toBe("list");
    expect(samples?.getCell("AB2").dataValidation.type).toBe("list");
  });
});
