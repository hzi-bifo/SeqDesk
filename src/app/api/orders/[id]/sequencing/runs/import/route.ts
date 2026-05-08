import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "@/lib/sequencing/server";
import {
  createSequencingRunForOrder,
  findDuplicateRunPlanBarcodes,
  mapRunPlanHeader,
  normalizeRunPlanImportedValue,
  prefillSequencingRunSamplesFromOrderBarcodes,
  RUN_PLAN_IMPORT_MAX_BYTES,
  RUN_PLAN_IMPORT_MAX_COLUMNS,
  RUN_PLAN_IMPORT_MAX_ROWS,
  upsertSequencingRunSamples,
} from "@/lib/sequencing/run-plan";

type ImportedRow = {
  rowNumber: number;
  runId: string;
  sampleCode: string;
  barcode: string | null;
  customFields: Record<string, unknown>;
  unmapped: Record<string, unknown>;
};

type ImportRowError = {
  rowNumber: number | null;
  message: string;
};

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "result" in (value as Record<string, unknown>)) {
    return cellToString((value as { result: unknown }).result);
  }
  if (typeof value === "object" && "richText" in (value as Record<string, unknown>)) {
    return ((value as { richText: { text: string }[] }).richText || [])
      .map((part) => part.text)
      .join("");
  }
  return String(value).trim();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireFacilityAdminSequencingSession();
    const { id } = await params;
    const url = new URL(request.url);
    const apply = url.searchParams.get("apply") === "true";
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Excel file is required" }, { status: 400 });
    }
    if (file.size > RUN_PLAN_IMPORT_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `Run plan imports are limited to ${Math.round(RUN_PLAN_IMPORT_MAX_BYTES / 1024 / 1024)} MB`,
        },
        { status: 413 }
      );
    }

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());

    const sheet =
      workbook.getWorksheet("Run Samples") ||
      workbook.getWorksheet("Samples") ||
      workbook.getWorksheet("Tabelle2") ||
      workbook.worksheets.find((candidate) => candidate.actualRowCount > 1);
    if (!sheet) {
      return NextResponse.json({ error: "No worksheet with sample rows found" }, { status: 400 });
    }
    if (sheet.actualRowCount > RUN_PLAN_IMPORT_MAX_ROWS + 1) {
      return NextResponse.json(
        { error: `Run plan imports are limited to ${RUN_PLAN_IMPORT_MAX_ROWS} data rows` },
        { status: 400 }
      );
    }
    if (sheet.actualColumnCount > RUN_PLAN_IMPORT_MAX_COLUMNS) {
      return NextResponse.json(
        { error: `Run plan imports are limited to ${RUN_PLAN_IMPORT_MAX_COLUMNS} columns` },
        { status: 400 }
      );
    }

    const headerRow = sheet.getRow(1);
    const headers = new Map<number, { original: string; mapped: string | null }>();
    headerRow.eachCell((cell, colNumber) => {
      const original = cellToString(cell.value);
      if (!original) return;
      headers.set(colNumber, { original, mapped: mapRunPlanHeader(original) });
    });

    const importedRows: ImportedRow[] = [];
    const rowErrors: ImportRowError[] = [];
    const unmappedColumns = Array.from(headers.values())
      .filter((header) => !header.mapped)
      .map((header) => header.original);

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      let hasValue = false;
      const values: Record<string, unknown> = {};
      const unmapped: Record<string, unknown> = {};
      headers.forEach((header, colNumber) => {
        const value = cellToString(row.getCell(colNumber).value);
        if (value) hasValue = true;
        if (!value) return;
        if (header.mapped) {
          values[header.mapped] = normalizeRunPlanImportedValue(header.mapped, value);
        } else {
          unmapped[header.original] = value;
        }
      });
      if (!hasValue) return;
      const runId = cellToString(values.runId);
      const sampleCode = cellToString(values.sampleCode);
      if (!runId || !sampleCode) {
        rowErrors.push({
          rowNumber,
          message: "Rows must include both Run and Sample/Patient columns",
        });
        return;
      }
      const barcode = cellToString(values.barcode) || null;
      const customFields = { ...values };
      delete customFields.runId;
      delete customFields.sampleCode;
      delete customFields.barcode;
      importedRows.push({ rowNumber, runId, sampleCode, barcode, customFields, unmapped });
    });

    const orderSamples = await db.sample.findMany({
      where: { orderId: id },
      select: { id: true, sampleId: true },
    });
    const knownSampleCodes = new Set(orderSamples.map((sample) => sample.sampleId));
    const missingSamples = importedRows
      .map((row) => row.sampleCode)
      .filter((sampleCode, index, all) => !knownSampleCodes.has(sampleCode) && all.indexOf(sampleCode) === index);
    rowErrors.push(
      ...missingSamples.map((sampleCode) => ({
        rowNumber: null,
        message: `Sample not found on this order: ${sampleCode}`,
      }))
    );

    const duplicateBarcodes = findDuplicateRunPlanBarcodes(importedRows);
    rowErrors.push(
      ...duplicateBarcodes.map((duplicate) => ({
        rowNumber: null,
        message: `Barcode ${duplicate.barcode} appears ${duplicate.count} times in run ${duplicate.runId}`,
      }))
    );

    const preview = {
      sheet: sheet.name,
      rows: importedRows,
      rowCount: importedRows.length,
      unmappedColumns,
      missingSamples,
      duplicateBarcodes,
      rowErrors,
      applyReady: importedRows.length > 0 && rowErrors.length === 0,
    };

    if (!apply) {
      return NextResponse.json(preview);
    }
    if (rowErrors.length > 0) {
      return NextResponse.json(
        { error: "Import contains rows that need review before saving", ...preview },
        { status: 400 }
      );
    }

    const rowsByRun = new Map<string, ImportedRow[]>();
    for (const row of importedRows) {
      rowsByRun.set(row.runId, [...(rowsByRun.get(row.runId) ?? []), row]);
    }

    const createdOrUpdated: Array<{ runId: string; assignments: number }> = [];
    for (const [runId, rows] of rowsByRun) {
      let run = await db.sequencingRun.findFirst({
        where: { orderId: id, runId },
        select: { id: true },
      });
      if (!run) {
        run = await createSequencingRunForOrder({ orderId: id, runId, runName: runId });
        await prefillSequencingRunSamplesFromOrderBarcodes({
          orderId: id,
          runDbId: run.id,
        });
      }
      await upsertSequencingRunSamples({
        orderId: id,
        runDbId: run.id,
        assignments: rows.map((row) => ({
          sampleId: row.sampleCode,
          barcode: row.barcode,
          customFields: row.customFields,
        })),
      });
      createdOrUpdated.push({ runId, assignments: rows.length });
    }

    return NextResponse.json({ success: true, ...preview, createdOrUpdated });
  } catch (error) {
    if (error instanceof SequencingApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Sequencing Run Import] error:", error);
    const message = error instanceof Error ? error.message : "Failed to import run plan";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
