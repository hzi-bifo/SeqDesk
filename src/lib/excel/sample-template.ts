import type { FormFieldDefinition } from "@/types/form-config";
import {
  mapFieldsToColumns,
  convertToExcelValue,
  type BarcodeOptionsArg,
  type ExcelColumnConfig,
} from "./field-mapping";

interface SampleRow {
  id: string;
  sampleId: string;
  [key: string]: unknown;
}

const DEFAULT_TEMPLATE_SAMPLE_ROWS = 10;

/**
 * Generate an Excel template for per-sample fields.
 * Includes a Samples data sheet and an Instructions sheet.
 * Uses dynamic import of exceljs to keep the bundle small.
 */
export async function generateSampleTemplate(
  perSampleFields: FormFieldDefinition[],
  existingSamples: SampleRow[],
  barcodeOptions?: BarcodeOptionsArg | null,
  entityName?: string
): Promise<Blob> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  const columns: ExcelColumnConfig[] = [
    {
      header: "Sample ID *",
      fieldName: "sampleId",
      fieldType: "sample_id",
      width: 24,
      required: true,
      helpText:
        "Unique identifier for each sample. Pre-filled from current samples.",
    },
    ...mapFieldsToColumns(perSampleFields, barcodeOptions),
  ];

  // --- Samples sheet ---
  const sheet = workbook.addWorksheet("Samples");

  // Header row
  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };

  // Set column widths and add header comments
  columns.forEach((col, idx) => {
    const excelCol = sheet.getColumn(idx + 1);
    excelCol.width = col.width;

    if (col.helpText) {
      const cell = headerRow.getCell(idx + 1);
      cell.note = col.helpText;
    }
  });

  // Add data validations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheetAny = sheet as any;
  const validationListRanges = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let validationSheet: any = null;
  let validationSheetColumn = 1;

  const getListValidationFormulae = (col: ExcelColumnConfig): string[] => {
    if (Array.isArray(col.options) && col.options.length > 0) {
      const values = col.options.map((option) => String(option.value));
      const cacheKey = `${col.fieldName}::${values.join("\u001f")}`;
      const cachedRange = validationListRanges.get(cacheKey);
      if (cachedRange) {
        return [cachedRange];
      }

      if (!validationSheet) {
        validationSheet = workbook.addWorksheet("_ValidationLists");
        validationSheet.state = "veryHidden";
      }

      const targetColumn = validationSheetColumn;
      validationSheetColumn += 1;

      values.forEach((value, idx) => {
        validationSheet.getCell(idx + 1, targetColumn).value = value;
      });

      const columnLetter = getColumnLetter(targetColumn);
      const rangeRef = `'${validationSheet.name}'!$${columnLetter}$1:$${columnLetter}$${values.length}`;
      validationListRanges.set(cacheKey, rangeRef);
      return [rangeRef];
    }

    return col.validation?.formulae || [];
  };

  columns.forEach((col, idx) => {
    if (!col.validation) return;
    const colLetter = getColumnLetter(idx + 1);
    // Apply to rows 2..200 (generous range for data)
    const range = `${colLetter}2:${colLetter}200`;

    if (col.validation.type === "list") {
      const formulae = getListValidationFormulae(col);
      if (formulae.length === 0) {
        return;
      }
      sheetAny.dataValidations.add(range, {
        type: "list",
        allowBlank: !col.required,
        formulae,
        showErrorMessage: true,
        errorTitle: "Invalid value",
        error: `Please select a valid option for "${col.header.replace(" *", "")}"`,
      });
    } else if (
      col.validation.type === "whole" ||
      col.validation.type === "decimal"
    ) {
      const dv: Record<string, unknown> = {
        type: col.validation.type,
        allowBlank: !col.required,
        showErrorMessage: true,
        errorTitle: "Invalid number",
        error: buildNumberError(col),
      };
      if (
        col.validation.min !== undefined &&
        col.validation.max !== undefined
      ) {
        dv.operator = "between" as const;
        dv.formulae = [col.validation.min, col.validation.max];
      } else if (col.validation.min !== undefined) {
        dv.operator = "greaterThanOrEqual" as const;
        dv.formulae = [col.validation.min];
      } else if (col.validation.max !== undefined) {
        dv.operator = "lessThanOrEqual" as const;
        dv.formulae = [col.validation.max];
      }
      sheetAny.dataValidations.add(range, dv as never);
    } else if (col.validation.type === "textLength") {
      if (col.validation.max !== undefined) {
        sheetAny.dataValidations.add(range, {
          type: "textLength",
          operator: "lessThanOrEqual" as never,
          allowBlank: !col.required,
          formulae: [col.validation.max],
          showErrorMessage: true,
          errorTitle: "Text too long",
          error: `Maximum ${col.validation.max} characters`,
        } as never);
      }
    }
  });

  // Populate with existing samples if any
  for (const sample of existingSamples) {
    const rowValues = columns.map((col) => {
      // Handle organism special columns
      if (col.fieldType === "organism_name") {
        return String(sample.scientificName || sample._organism_scientificName || "");
      }
      if (col.fieldType === "organism_taxid") {
        return String(sample.taxId || sample.tax_id || sample._organism_taxId || "");
      }
      const value = sample[col.fieldName];
      return convertToExcelValue(value, col);
    });
    sheet.addRow(rowValues);
  }

  // Add starter rows with pre-generated Sample IDs when there are no existing samples.
  if (existingSamples.length === 0) {
    for (let i = 0; i < DEFAULT_TEMPLATE_SAMPLE_ROWS; i += 1) {
      const generatedSampleId = generateSampleId();
      const rowValues = columns.map((col) => {
        if (col.fieldName === "sampleId") {
          return generatedSampleId;
        }
        return "";
      });
      sheet.addRow(rowValues);
    }
  }

  // Freeze header row
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  // --- Instructions sheet ---
  const instrSheet = workbook.addWorksheet("Instructions");
  instrSheet.getColumn(1).width = 30;
  instrSheet.getColumn(2).width = 60;

  const title = entityName
    ? `Sample Data Template (${entityName})`
    : "Sample Data Template";
  const titleRow = instrSheet.addRow([title]);
  titleRow.font = { bold: true, size: 14 };
  instrSheet.addRow([]);

  instrSheet.addRow(["How to use this template:"]);
  instrSheet.addRow([
    "1.",
    'Fill in sample data on the "Samples" sheet, one row per sample.',
  ]);
  instrSheet.addRow([
    "2.",
    "Columns marked with * are required.",
  ]);
  instrSheet.addRow([
    "3.",
    "Columns with dropdowns will show valid options when you click the cell.",
  ]);
  instrSheet.addRow([
    "4.",
    'Save this file as .xlsx and use "Upload Excel" to import.',
  ]);
  instrSheet.addRow([]);

  // Special field notes
  const hasOrganism = columns.some((c) => c.fieldType === "organism_name");
  const hasMultiselect = columns.some((c) => c.fieldType === "multiselect");
  const hasBarcode = columns.some((c) => c.fieldType === "barcode");

  if (hasOrganism || hasMultiselect || hasBarcode) {
    const notesRow = instrSheet.addRow(["Special field notes:"]);
    notesRow.font = { bold: true };

    if (hasOrganism) {
      instrSheet.addRow([
        "Organism",
        "Enter the scientific name (e.g., 'human gut metagenome') and/or the NCBI Tax ID. If both are provided, Tax ID takes precedence. Common organisms will be auto-matched.",
      ]);
    }
    if (hasMultiselect) {
      instrSheet.addRow([
        "Multi-select fields",
        'Separate multiple values with semicolons. Example: "value1; value2; value3"',
      ]);
    }
    if (hasBarcode) {
      instrSheet.addRow([
        "Barcode",
        barcodeOptions?.options?.length
          ? "Select from the dropdown. Options depend on the sequencing kit."
          : "Barcode options depend on the sequencing kit selection. Select a kit first, then download a fresh template.",
      ]);
    }
    instrSheet.addRow([]);
  }

  // Field reference table
  const refRow = instrSheet.addRow(["Field Reference"]);
  refRow.font = { bold: true };

  const refHeaderRow = instrSheet.addRow(["Column", "Description"]);
  refHeaderRow.font = { bold: true };
  refHeaderRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };

  for (const col of columns) {
    const parts: string[] = [];
    if (col.helpText) parts.push(col.helpText);
    if (col.required) parts.push("Required.");
    if (col.options?.length) {
      parts.push(
        `Valid options: ${col.options.map((o) => o.value).join(", ")}`
      );
    }
    instrSheet.addRow([col.header.replace(" *", ""), parts.join(" ")]);
  }

  // Generate blob
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function getColumnLetter(colNum: number): string {
  let letter = "";
  let n = colNum;
  while (n > 0) {
    n--;
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26);
  }
  return letter;
}

function buildNumberError(col: ExcelColumnConfig): string {
  const v = col.validation;
  if (!v) return "Please enter a valid number";
  if (v.min !== undefined && v.max !== undefined) {
    return `Please enter a number between ${v.min} and ${v.max}`;
  }
  if (v.min !== undefined) return `Please enter a number >= ${v.min}`;
  if (v.max !== undefined) return `Please enter a number <= ${v.max}`;
  return "Please enter a valid number";
}

function generateSampleId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `S-${timestamp}-${random}`;
}
