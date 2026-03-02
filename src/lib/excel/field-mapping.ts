import type { FormFieldDefinition, SelectOption } from "@/types/form-config";

// Configuration for a single Excel column derived from a form field
export interface ExcelColumnConfig {
  header: string;
  fieldName: string; // key in SampleRow
  fieldType: string;
  width: number;
  required: boolean;
  helpText?: string;
  // For data validation in Excel
  validation?: {
    type: "list" | "whole" | "decimal" | "textLength" | "date";
    formulae?: string[];
    operator?: "between" | "greaterThan" | "lessThan";
    min?: number;
    max?: number;
  };
  // How to map cell value to/from SampleRow
  transform?: "boolean" | "multiselect" | "number" | "date";
  options?: SelectOption[];
}

// A row parsed from Excel, ready to become a SampleRow
export interface ParsedSampleRow {
  [key: string]: unknown;
}

export interface BarcodeOptionsArg {
  options: { value: string; label: string }[];
}

/**
 * Map an array of FormFieldDefinitions to Excel column configs.
 * Special handling for organism (2 cols), barcode, checkbox, multiselect.
 */
export function mapFieldsToColumns(
  fields: FormFieldDefinition[],
  barcodeOptions?: BarcodeOptionsArg | null
): ExcelColumnConfig[] {
  const columns: ExcelColumnConfig[] = [];

  for (const field of fields) {
    if (field.type === "organism") {
      // Organism produces two columns
      columns.push({
        header: `${field.label} (Scientific Name)${field.required ? " *" : ""}`,
        fieldName: "_organism_scientificName",
        fieldType: "organism_name",
        width: 30,
        required: field.required,
        helpText: field.helpText,
      });
      columns.push({
        header: `Tax ID${field.required ? " *" : ""}`,
        fieldName: "_organism_taxId",
        fieldType: "organism_taxid",
        width: 12,
        required: false, // Not required if scientific name is provided
        helpText:
          "NCBI Taxonomy ID. If provided, takes precedence over scientific name.",
      });
    } else if (field.type === "barcode") {
      const opts = barcodeOptions?.options;
      columns.push({
        header: `${field.label}${field.required ? " *" : ""}`,
        fieldName: field.name,
        fieldType: "barcode",
        width: 16,
        required: field.required,
        helpText: field.helpText,
        options: opts,
        validation: opts?.length
          ? {
              type: "list",
            }
          : undefined,
      });
    } else if (field.type === "select") {
      columns.push({
        header: `${field.label}${field.required ? " *" : ""}`,
        fieldName: field.name,
        fieldType: "select",
        width: 20,
        required: field.required,
        helpText: field.helpText,
        options: field.options,
        validation: field.options?.length
          ? {
              type: "list",
            }
          : undefined,
      });
    } else if (field.type === "multiselect") {
      columns.push({
        header: `${field.label}${field.required ? " *" : ""}`,
        fieldName: field.name,
        fieldType: "multiselect",
        width: 24,
        required: field.required,
        helpText: `${field.helpText || ""} (Separate multiple values with semicolons)`.trim(),
        options: field.options,
        transform: "multiselect",
      });
    } else if (field.type === "checkbox") {
      columns.push({
        header: `${field.label}${field.required ? " *" : ""}`,
        fieldName: field.name,
        fieldType: "checkbox",
        width: 12,
        required: field.required,
        helpText: field.helpText,
        transform: "boolean",
        validation: {
          type: "list",
          formulae: ['"Yes,No"'],
        },
      });
    } else if (field.type === "number") {
      const sv = field.simpleValidation;
      columns.push({
        header: `${field.label}${field.required ? " *" : ""}`,
        fieldName: field.name,
        fieldType: "number",
        width: 14,
        required: field.required,
        helpText: field.helpText,
        transform: "number",
        validation:
          sv?.minValue !== undefined || sv?.maxValue !== undefined
            ? {
                type: sv?.minValue !== undefined && sv.minValue % 1 === 0 && (sv?.maxValue === undefined || sv.maxValue % 1 === 0) ? "whole" : "decimal",
                operator: "between",
                min: sv?.minValue,
                max: sv?.maxValue,
              }
            : undefined,
      });
    } else if (field.type === "date") {
      columns.push({
        header: `${field.label}${field.required ? " *" : ""}`,
        fieldName: field.name,
        fieldType: "date",
        width: 14,
        required: field.required,
        helpText: field.helpText,
        transform: "date",
      });
    } else {
      // text, textarea
      const sv = field.simpleValidation;
      columns.push({
        header: `${field.label}${field.required ? " *" : ""}`,
        fieldName: field.name,
        fieldType: field.type,
        width: field.type === "textarea" ? 30 : 20,
        required: field.required,
        helpText: field.helpText,
        validation:
          sv?.maxLength !== undefined
            ? {
                type: "textLength",
                operator: "between",
                min: 0,
                max: sv.maxLength,
              }
            : undefined,
      });
    }
  }

  return columns;
}

/**
 * Convert a cell value from Excel to the format expected by SampleRow.
 */
export function convertCellValue(
  value: unknown,
  column: ExcelColumnConfig
): unknown {
  if (value === null || value === undefined || value === "") {
    if (column.transform === "boolean") return false;
    if (column.transform === "multiselect") return [];
    return "";
  }

  switch (column.transform) {
    case "boolean": {
      const str = String(value).toLowerCase().trim();
      return str === "yes" || str === "true" || str === "1";
    }
    case "multiselect": {
      const str = String(value);
      return str
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    case "number": {
      const num = Number(value);
      return isNaN(num) ? "" : num;
    }
    case "date": {
      if (value instanceof Date) {
        return value.toISOString().split("T")[0];
      }
      return String(value);
    }
    default:
      return String(value).trim();
  }
}

/**
 * Convert a SampleRow value to Excel cell value for export.
 */
export function convertToExcelValue(
  value: unknown,
  column: ExcelColumnConfig
): string | number | boolean | Date {
  if (value === null || value === undefined) return "";

  switch (column.transform) {
    case "boolean":
      return value === true ? "Yes" : "No";
    case "multiselect":
      return Array.isArray(value) ? value.join("; ") : String(value);
    case "number":
      if (typeof value === "number") {
        return Number.isNaN(value) ? "" : value;
      }
      const parsed = Number(value);
      return Number.isNaN(parsed) ? "" : parsed;
    case "date": {
      if (value instanceof Date) return value;
      const str = String(value);
      if (str) {
        const d = new Date(str);
        if (!isNaN(d.getTime())) return d;
      }
      return str;
    }
    default:
      return String(value);
  }
}
