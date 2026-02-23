import type { FormFieldDefinition } from "@/types/form-config";
import {
  mapFieldsToColumns,
  convertCellValue,
  type BarcodeOptionsArg,
  type ExcelColumnConfig,
} from "./field-mapping";
import {
  searchTaxonomy,
  getTaxonomyByTaxId,
} from "@/lib/field-types/organism/taxonomy-data";

export interface ValidationError {
  row: number;
  field: string;
  value: string;
  message: string;
  severity: "error" | "warning";
}

export interface ParseResult {
  samples: ParsedSample[];
  errors: ValidationError[];
  warnings: ValidationError[];
  unmappedColumns: string[];
  totalRows: number;
}

export interface ParsedSample {
  id: string;
  sampleId: string;
  [key: string]: unknown;
}

/**
 * Parse an uploaded Excel file and validate it against the per-sample field definitions.
 */
export async function parseSampleExcel(
  file: File,
  perSampleFields: FormFieldDefinition[],
  barcodeOptions?: BarcodeOptionsArg | null
): Promise<ParseResult> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer);

  // Find the data sheet (prefer "Samples", fallback to first sheet)
  let sheet = workbook.getWorksheet("Samples");
  if (!sheet) {
    sheet = workbook.worksheets[0];
  }
  if (!sheet) {
    return {
      samples: [],
      errors: [
        {
          row: 0,
          field: "",
          value: "",
          message: "No worksheet found in the Excel file",
          severity: "error",
        },
      ],
      warnings: [],
      unmappedColumns: [],
      totalRows: 0,
    };
  }

  const columns = mapFieldsToColumns(perSampleFields, barcodeOptions);

  // Read header row
  const headerRow = sheet.getRow(1);
  const headerMap = new Map<number, ExcelColumnConfig>();
  let sampleIdColumnNumber: number | null = null;
  const unmappedColumns: string[] = [];
  const mappedFieldNames = new Set<string>();

  headerRow.eachCell((cell, colNumber) => {
    const headerText = String(cell.value || "").trim();
    if (!headerText) return;

    // Try to match by header text (with or without * suffix)
    const cleanHeader = headerText.replace(/\s*\*\s*$/, "").trim();
    const normalizedHeader = cleanHeader.toLowerCase();

    if (normalizedHeader === "sample id" || normalizedHeader === "sampleid") {
      sampleIdColumnNumber = colNumber;
      return;
    }

    const match = columns.find((col) => {
      const colClean = col.header.replace(/\s*\*\s*$/, "").trim();
      return (
        colClean.toLowerCase() === cleanHeader.toLowerCase() ||
        col.fieldName.toLowerCase() === cleanHeader.toLowerCase()
      );
    });

    if (match && !mappedFieldNames.has(match.fieldName)) {
      headerMap.set(colNumber, match);
      mappedFieldNames.add(match.fieldName);
    } else if (!match) {
      // Skip known non-field columns like "#" and "row"
      const skip = ["#", "row"];
      if (!skip.includes(cleanHeader.toLowerCase())) {
        unmappedColumns.push(headerText);
      }
    }
  });

  // Parse data rows
  const samples: ParsedSample[] = [];
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  let totalRows = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    // Check if row is completely empty
    let hasValue = false;
    row.eachCell((cell) => {
      if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== "") {
        hasValue = true;
      }
    });
    if (!hasValue) return;

    totalRows++;
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 7).toUpperCase();
    const sample: ParsedSample = {
      id: `temp_${timestamp}_${random}_${rowNumber}`,
      sampleId: `S-${timestamp}-${random}`,
    };

    if (sampleIdColumnNumber) {
      const sampleIdCell = row.getCell(sampleIdColumnNumber);
      const rawSampleId = normalizeExcelCellValue(sampleIdCell.value);
      const parsedSampleId = String(rawSampleId ?? "").trim();
      if (parsedSampleId) {
        sample.sampleId = parsedSampleId;
      }
    }

    // Read each mapped column
    let hasNonSampleIdData = false;
    headerMap.forEach((col, colNumber) => {
      const cell = row.getCell(colNumber);
      const rawValue = normalizeExcelCellValue(cell.value);
      if (hasMeaningfulCellValue(rawValue)) {
        hasNonSampleIdData = true;
      }

      const converted = convertCellValue(rawValue, col);
      sample[col.fieldName] = converted;
    });

    // Ignore untouched starter rows that only contain a pre-filled Sample ID.
    if (!hasNonSampleIdData) {
      return;
    }

    // Resolve organism fields
    resolveOrganism(sample, rowNumber, errors, warnings);

    // Initialize missing fields with defaults
    for (const col of columns) {
      if (sample[col.fieldName] === undefined) {
        sample[col.fieldName] = convertCellValue(null, col);
      }
    }

    samples.push(sample);
  });

  // Validate all samples
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const rowNum = i + 1; // 1-based for user display

    for (const field of perSampleFields) {
      if (field.type === "organism") {
        // Organism validation: check if we have taxId or scientificName
        if (field.required) {
          const taxId = sample.taxId || sample.tax_id;
          const sciName = sample.scientificName;
          if (!taxId && !sciName) {
            errors.push({
              row: rowNum,
              field: field.label,
              value: "",
              message: "Required - provide scientific name or Tax ID",
              severity: "error",
            });
          }
        }
        continue;
      }

      const value = sample[field.name];

      // Required check
      if (field.required) {
        const isEmpty =
          value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0);
        if (isEmpty && field.type !== "checkbox") {
          errors.push({
            row: rowNum,
            field: field.label,
            value: "",
            message: "Required",
            severity: "error",
          });
          continue;
        }
        if (field.type === "checkbox" && value !== true) {
          errors.push({
            row: rowNum,
            field: field.label,
            value: String(value),
            message: "Required (must be Yes)",
            severity: "error",
          });
          continue;
        }
      }

      if (value === "" || value === undefined || value === null) continue;

      // Type-specific validation
      if (field.type === "select" && field.options?.length) {
        const strVal = String(value);
        const valid = field.options.some(
          (o) =>
            o.value === strVal ||
            o.label.toLowerCase() === strVal.toLowerCase()
        );
        if (!valid) {
          errors.push({
            row: rowNum,
            field: field.label,
            value: strVal,
            message: `Invalid option. Valid: ${field.options.map((o) => o.value).join(", ")}`,
            severity: "error",
          });
        }
      }

      if (field.type === "multiselect" && field.options?.length && Array.isArray(value)) {
        for (const v of value as string[]) {
          const valid = field.options.some(
            (o) =>
              o.value === v ||
              o.label.toLowerCase() === v.toLowerCase()
          );
          if (!valid) {
            errors.push({
              row: rowNum,
              field: field.label,
              value: v,
              message: `Invalid option "${v}". Valid: ${field.options.map((o) => o.value).join(", ")}`,
              severity: "error",
            });
          }
        }
      }

      if (field.type === "barcode" && barcodeOptions?.options?.length) {
        const strVal = String(value);
        if (strVal && !barcodeOptions.options.some((o) => o.value === strVal)) {
          errors.push({
            row: rowNum,
            field: field.label,
            value: strVal,
            message: `Invalid barcode. Valid: ${barcodeOptions.options.slice(0, 5).map((o) => o.value).join(", ")}...`,
            severity: "error",
          });
        }
      }

      // Simple validation (patterns, min/max)
      const sv = field.simpleValidation;
      if (sv) {
        const strVal = String(value);
        if (sv.minLength && strVal.length < sv.minLength) {
          errors.push({
            row: rowNum,
            field: field.label,
            value: strVal,
            message: `Minimum ${sv.minLength} characters`,
            severity: "error",
          });
        }
        if (sv.maxLength && strVal.length > sv.maxLength) {
          errors.push({
            row: rowNum,
            field: field.label,
            value: strVal,
            message: `Maximum ${sv.maxLength} characters`,
            severity: "error",
          });
        }
        if (sv.minValue !== undefined && Number(value) < sv.minValue) {
          errors.push({
            row: rowNum,
            field: field.label,
            value: String(value),
            message: `Minimum value: ${sv.minValue}`,
            severity: "error",
          });
        }
        if (sv.maxValue !== undefined && Number(value) > sv.maxValue) {
          errors.push({
            row: rowNum,
            field: field.label,
            value: String(value),
            message: `Maximum value: ${sv.maxValue}`,
            severity: "error",
          });
        }
        if (sv.pattern && strVal) {
          try {
            const regex = new RegExp(sv.pattern);
            if (!regex.test(strVal)) {
              errors.push({
                row: rowNum,
                field: field.label,
                value: strVal,
                message: sv.patternMessage || "Invalid format",
                severity: "error",
              });
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }
    }
  }

  // Barcode warning if no options available
  if (
    perSampleFields.some((f) => f.type === "barcode") &&
    !barcodeOptions?.options?.length
  ) {
    const hasBarcodeData = samples.some(
      (s) =>
        s[perSampleFields.find((f) => f.type === "barcode")?.name || ""] !== ""
    );
    if (hasBarcodeData) {
      warnings.push({
        row: 0,
        field: "Barcode",
        value: "",
        message:
          "Barcode values found but no sequencing kit is selected. Barcodes could not be validated.",
        severity: "warning",
      });
    }
  }

  return { samples, errors, warnings, unmappedColumns, totalRows };
}

function normalizeExcelCellValue(rawValue: unknown): unknown {
  if (
    rawValue &&
    typeof rawValue === "object" &&
    "richText" in (rawValue as Record<string, unknown>)
  ) {
    return (rawValue as { richText: { text: string }[] }).richText
      .map((r) => r.text)
      .join("");
  }
  if (
    rawValue &&
    typeof rawValue === "object" &&
    "result" in (rawValue as Record<string, unknown>)
  ) {
    return (rawValue as { result: unknown }).result;
  }
  return rawValue;
}

function hasMeaningfulCellValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/**
 * Resolve organism scientific name / taxId from the two-column mapping.
 * Sets `taxId`, `scientificName`, and `tax_id` on the sample row.
 */
function resolveOrganism(
  sample: ParsedSample,
  rowNumber: number,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  const sciName = String(sample._organism_scientificName || "").trim();
  const taxIdStr = String(sample._organism_taxId || "").trim();

  // Clean up the intermediate fields
  delete sample._organism_scientificName;
  delete sample._organism_taxId;

  if (!sciName && !taxIdStr) {
    // No organism data provided
    sample.taxId = "";
    sample.tax_id = "";
    sample.scientificName = "";
    return;
  }

  // If taxId is provided, look it up
  if (taxIdStr) {
    const entry = getTaxonomyByTaxId(taxIdStr);
    if (entry) {
      sample.taxId = entry.taxId;
      sample.tax_id = entry.taxId;
      sample.scientificName = entry.scientificName;
      return;
    }
    // taxId provided but not in local data - use as-is
    sample.taxId = taxIdStr;
    sample.tax_id = taxIdStr;
    sample.scientificName = sciName || "";
    if (!sciName) {
      warnings.push({
        row: rowNumber,
        field: "Tax ID",
        value: taxIdStr,
        message:
          "Tax ID not found in common organisms list. It will be used as-is.",
        severity: "warning",
      });
    }
    return;
  }

  // Only scientific name provided - try to look up
  if (sciName) {
    const results = searchTaxonomy(sciName, 1);
    if (
      results.length > 0 &&
      results[0].scientificName.toLowerCase() === sciName.toLowerCase()
    ) {
      sample.taxId = results[0].taxId;
      sample.tax_id = results[0].taxId;
      sample.scientificName = results[0].scientificName;
      return;
    }

    // Partial match or no match - warn
    sample.taxId = "";
    sample.tax_id = "";
    sample.scientificName = sciName;

    if (results.length > 0) {
      warnings.push({
        row: rowNumber,
        field: "Organism",
        value: sciName,
        message: `No exact match. Did you mean "${results[0].scientificName}" (Tax ID: ${results[0].taxId})? You can correct this in the table.`,
        severity: "warning",
      });
    } else {
      warnings.push({
        row: rowNumber,
        field: "Organism",
        value: sciName,
        message:
          "Organism not found in common list. You may need to enter the Tax ID manually.",
        severity: "warning",
      });
    }
  }
}
