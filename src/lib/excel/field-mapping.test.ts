import { describe, it, expect } from "vitest";
import {
  mapFieldsToColumns,
  convertCellValue,
  convertToExcelValue,
} from "./field-mapping";
import type { ExcelColumnConfig } from "./field-mapping";
import type { FormFieldDefinition } from "@/types/form-config";

function makeField(
  overrides: Partial<FormFieldDefinition>
): FormFieldDefinition {
  return {
    id: "test",
    type: "text",
    label: "Test Field",
    name: "test_field",
    required: false,
    visible: true,
    order: 0,
    ...overrides,
  } as FormFieldDefinition;
}

describe("mapFieldsToColumns", () => {
  it("maps text field to single column", () => {
    const cols = mapFieldsToColumns([makeField({ type: "text", label: "Name" })]);
    expect(cols).toHaveLength(1);
    expect(cols[0].header).toBe("Name");
    expect(cols[0].fieldType).toBe("text");
  });

  it("appends * for required fields", () => {
    const cols = mapFieldsToColumns([
      makeField({ required: true, label: "Name" }),
    ]);
    expect(cols[0].header).toBe("Name *");
  });

  it("maps organism field to two columns", () => {
    const cols = mapFieldsToColumns([
      makeField({ type: "organism", label: "Organism" }),
    ]);
    expect(cols).toHaveLength(2);
    expect(cols[0].fieldName).toBe("_organism_scientificName");
    expect(cols[0].fieldType).toBe("organism_name");
    expect(cols[1].fieldName).toBe("_organism_taxId");
    expect(cols[1].fieldType).toBe("organism_taxid");
  });

  it("maps checkbox field with boolean transform", () => {
    const cols = mapFieldsToColumns([makeField({ type: "checkbox" })]);
    expect(cols[0].transform).toBe("boolean");
    expect(cols[0].validation?.type).toBe("list");
  });

  it("maps select field with list validation", () => {
    const cols = mapFieldsToColumns([
      makeField({
        type: "select",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ]);
    expect(cols[0].validation?.type).toBe("list");
    expect(cols[0].options).toHaveLength(2);
  });

  it("maps multiselect field with multiselect transform", () => {
    const cols = mapFieldsToColumns([
      makeField({
        type: "multiselect",
        options: [{ value: "x", label: "X" }],
      }),
    ]);
    expect(cols[0].transform).toBe("multiselect");
    expect(cols[0].helpText).toContain("semicolons");
  });

  it("maps number field with range validation", () => {
    const cols = mapFieldsToColumns([
      makeField({
        type: "number",
        simpleValidation: { minValue: 0, maxValue: 100 },
      }),
    ]);
    expect(cols[0].transform).toBe("number");
    expect(cols[0].validation?.type).toBe("whole");
    expect(cols[0].validation?.min).toBe(0);
    expect(cols[0].validation?.max).toBe(100);
  });

  it("maps date field with date transform", () => {
    const cols = mapFieldsToColumns([makeField({ type: "date" })]);
    expect(cols[0].transform).toBe("date");
  });

  it("maps textarea with wider width", () => {
    const cols = mapFieldsToColumns([makeField({ type: "textarea" })]);
    expect(cols[0].width).toBe(30);
  });

  it("maps text field with maxLength validation", () => {
    const cols = mapFieldsToColumns([
      makeField({
        type: "text",
        simpleValidation: { maxLength: 50 },
      }),
    ]);
    expect(cols[0].validation?.type).toBe("textLength");
    expect(cols[0].validation?.max).toBe(50);
  });
});

describe("convertCellValue", () => {
  const boolCol: ExcelColumnConfig = {
    header: "Test",
    fieldName: "test",
    fieldType: "checkbox",
    width: 12,
    required: false,
    transform: "boolean",
  };

  it('converts "Yes" to true for boolean', () => {
    expect(convertCellValue("Yes", boolCol)).toBe(true);
  });

  it('converts "no" to false for boolean (case-insensitive)', () => {
    expect(convertCellValue("no", boolCol)).toBe(false);
  });

  it("converts truthy strings to true", () => {
    expect(convertCellValue("true", boolCol)).toBe(true);
    expect(convertCellValue("1", boolCol)).toBe(true);
  });

  it("returns false for null/empty boolean", () => {
    expect(convertCellValue(null, boolCol)).toBe(false);
    expect(convertCellValue("", boolCol)).toBe(false);
    expect(convertCellValue(undefined, boolCol)).toBe(false);
  });

  it("splits semicolons for multiselect", () => {
    const msCol: ExcelColumnConfig = {
      header: "Test",
      fieldName: "test",
      fieldType: "multiselect",
      width: 24,
      required: false,
      transform: "multiselect",
    };
    expect(convertCellValue("a; b ; c", msCol)).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for null multiselect", () => {
    const msCol: ExcelColumnConfig = {
      header: "Test",
      fieldName: "test",
      fieldType: "multiselect",
      width: 24,
      required: false,
      transform: "multiselect",
    };
    expect(convertCellValue(null, msCol)).toEqual([]);
  });

  it("converts numbers", () => {
    const numCol: ExcelColumnConfig = {
      header: "Test",
      fieldName: "test",
      fieldType: "number",
      width: 14,
      required: false,
      transform: "number",
    };
    expect(convertCellValue("42", numCol)).toBe(42);
    expect(convertCellValue("3.14", numCol)).toBe(3.14);
  });

  it('returns "" for NaN number', () => {
    const numCol: ExcelColumnConfig = {
      header: "Test",
      fieldName: "test",
      fieldType: "number",
      width: 14,
      required: false,
      transform: "number",
    };
    expect(convertCellValue("not-a-number", numCol)).toBe("");
  });

  it("converts Date objects for date transform", () => {
    const dateCol: ExcelColumnConfig = {
      header: "Test",
      fieldName: "test",
      fieldType: "date",
      width: 14,
      required: false,
      transform: "date",
    };
    const d = new Date("2024-06-15T00:00:00Z");
    expect(convertCellValue(d, dateCol)).toBe("2024-06-15");
  });

  it("returns trimmed string for default transform", () => {
    const textCol: ExcelColumnConfig = {
      header: "Test",
      fieldName: "test",
      fieldType: "text",
      width: 20,
      required: false,
    };
    expect(convertCellValue("  hello  ", textCol)).toBe("hello");
  });

  it('returns "" for null with no transform', () => {
    const textCol: ExcelColumnConfig = {
      header: "Test",
      fieldName: "test",
      fieldType: "text",
      width: 20,
      required: false,
    };
    expect(convertCellValue(null, textCol)).toBe("");
  });
});

describe("convertToExcelValue", () => {
  it('converts boolean true to "Yes"', () => {
    const col: ExcelColumnConfig = {
      header: "T",
      fieldName: "t",
      fieldType: "checkbox",
      width: 12,
      required: false,
      transform: "boolean",
    };
    expect(convertToExcelValue(true, col)).toBe("Yes");
    expect(convertToExcelValue(false, col)).toBe("No");
  });

  it("joins array for multiselect", () => {
    const col: ExcelColumnConfig = {
      header: "T",
      fieldName: "t",
      fieldType: "multiselect",
      width: 24,
      required: false,
      transform: "multiselect",
    };
    expect(convertToExcelValue(["a", "b", "c"], col)).toBe("a; b; c");
  });

  it("passes through numbers", () => {
    const col: ExcelColumnConfig = {
      header: "T",
      fieldName: "t",
      fieldType: "number",
      width: 14,
      required: false,
      transform: "number",
    };
    expect(convertToExcelValue(42, col)).toBe(42);
  });

  it('preserves numeric zero from string input', () => {
    const col: ExcelColumnConfig = {
      header: "T",
      fieldName: "t",
      fieldType: "number",
      width: 14,
      required: false,
      transform: "number",
    };
    expect(convertToExcelValue("0", col)).toBe(0);
  });

  it('returns "" for null/undefined', () => {
    const col: ExcelColumnConfig = {
      header: "T",
      fieldName: "t",
      fieldType: "text",
      width: 20,
      required: false,
    };
    expect(convertToExcelValue(null, col)).toBe("");
    expect(convertToExcelValue(undefined, col)).toBe("");
  });

  it("converts string to string for default", () => {
    const col: ExcelColumnConfig = {
      header: "T",
      fieldName: "t",
      fieldType: "text",
      width: 20,
      required: false,
    };
    expect(convertToExcelValue("hello", col)).toBe("hello");
  });
});
