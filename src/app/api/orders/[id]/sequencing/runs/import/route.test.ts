import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// SequencingApiError must be a real class so `instanceof` checks pass. It is
// defined inside vi.hoisted() so it is initialized before the hoisted vi.mock
// factories below reference it (a top-level `class` declaration would sit in
// the temporal dead zone when the hoisted factory runs).
const mocks = vi.hoisted(() => {
  class SequencingApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    SequencingApiError,
    requireFacilityAdminSequencingSession: vi.fn(),
    db: {
      sample: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      sequencingRun: {
        findFirst: vi.fn(),
      },
    },
    createSequencingRunForOrder: vi.fn(),
    findDuplicateRunPlanBarcodes: vi.fn(),
    mapRunPlanHeader: vi.fn(),
    normalizeRunPlanImportedValue: vi.fn(),
    prefillSequencingRunSamplesFromOrderBarcodes: vi.fn(),
    upsertSequencingRunSamples: vi.fn(),
    workbookLoad: vi.fn(),
    getWorksheet: vi.fn(),
    worksheets: [] as unknown[],
  };
});

const SequencingApiError = mocks.SequencingApiError;

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingSession:
    mocks.requireFacilityAdminSequencingSession,
  SequencingApiError: mocks.SequencingApiError,
}));

// Real ONT_SAMPLE_FIELDS drive splitSampleAndRunAssignmentFields; keep them
// stable for the test so we control which fields land on the sample.
vi.mock("@/lib/sequencing/run-plan", () => ({
  createSequencingRunForOrder: mocks.createSequencingRunForOrder,
  findDuplicateRunPlanBarcodes: mocks.findDuplicateRunPlanBarcodes,
  mapRunPlanHeader: mocks.mapRunPlanHeader,
  normalizeRunPlanImportedValue: mocks.normalizeRunPlanImportedValue,
  prefillSequencingRunSamplesFromOrderBarcodes:
    mocks.prefillSequencingRunSamplesFromOrderBarcodes,
  upsertSequencingRunSamples: mocks.upsertSequencingRunSamples,
  ONT_SAMPLE_FIELDS: [
    { name: "sampling_date" },
    { name: "concentration_ng_ul" },
  ],
  RUN_PLAN_IMPORT_MAX_BYTES: 5 * 1024 * 1024,
  RUN_PLAN_IMPORT_MAX_ROWS: 1000,
  RUN_PLAN_IMPORT_MAX_COLUMNS: 80,
}));

// Mock the dynamically-imported exceljs module.
vi.mock("exceljs", () => {
  class Workbook {
    xlsx = { load: (...args: unknown[]) => mocks.workbookLoad(...args) };
    getWorksheet(name: string) {
      return mocks.getWorksheet(name);
    }
    get worksheets() {
      return mocks.worksheets;
    }
  }
  return { Workbook, default: { Workbook } };
});

import { POST } from "./route";

const baseParams = Promise.resolve({ id: "order-1" });

/**
 * Build a fake exceljs worksheet from a 2D grid of cell values. Row 1 is the
 * header row. The shape mirrors the small slice of the exceljs API the route
 * consumes: actualRowCount / actualColumnCount / getRow / eachRow / eachCell.
 */
function makeSheet(
  name: string,
  grid: Array<Array<string | null>>,
  overrides: { actualRowCount?: number; actualColumnCount?: number } = {}
) {
  const colCount = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const makeRow = (cells: Array<string | null>, rowNumber: number) => ({
    rowNumber,
    eachCell(cb: (cell: { value: unknown }, colNumber: number) => void) {
      cells.forEach((value, idx) => {
        if (value === null || value === undefined) return;
        cb({ value }, idx + 1);
      });
    },
    getCell(colNumber: number) {
      return { value: cells[colNumber - 1] ?? null };
    },
  });

  return {
    name,
    actualRowCount: overrides.actualRowCount ?? grid.length,
    actualColumnCount: overrides.actualColumnCount ?? colCount,
    getRow(rowNumber: number) {
      return makeRow(grid[rowNumber - 1] ?? [], rowNumber);
    },
    eachRow(cb: (row: ReturnType<typeof makeRow>, rowNumber: number) => void) {
      grid.forEach((cells, idx) => cb(makeRow(cells, idx + 1), idx + 1));
    },
  };
}

function makeFile(size = 1000): File {
  const file = new File(["x"], "plan.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  Object.defineProperty(file, "size", { value: size });
  // arrayBuffer is called by the route; provide a deterministic buffer.
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new ArrayBuffer(8),
  });
  return file;
}

function makeRequest(
  file: File | string | null,
  { apply = false }: { apply?: boolean } = {}
) {
  const formData = new FormData();
  if (file !== null) {
    formData.set("file", file as File);
  }
  const url = `http://localhost:3000/api/orders/order-1/sequencing/runs/import${
    apply ? "?apply=true" : ""
  }`;
  const request = new NextRequest(url, { method: "POST" });
  // NextRequest.formData() reads the underlying body; override to return our
  // constructed FormData directly so we control the parsed file.
  request.formData = async () => formData;
  return request;
}

describe("POST /api/orders/[id]/sequencing/runs/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    // Default: header -> mapped name is the lowercased header.
    mocks.mapRunPlanHeader.mockImplementation((header: string) => {
      const map: Record<string, string | null> = {
        Run: "runId",
        Sample: "sampleCode",
        Barcode: "barcode",
        SamplingDate: "sampling_date",
        Notes: null,
      };
      return header in map ? map[header] : null;
    });
    // Default: identity normalization (trimmed string).
    mocks.normalizeRunPlanImportedValue.mockImplementation(
      (_field: string, value: unknown) => String(value).trim()
    );
    mocks.findDuplicateRunPlanBarcodes.mockReturnValue([]);
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "db-s1", sampleId: "S1", customFields: null },
      { id: "db-s2", sampleId: "S2", customFields: null },
    ]);
    mocks.db.sample.update.mockResolvedValue({});
    mocks.db.sequencingRun.findFirst.mockResolvedValue({ id: "run-db-1" });
    mocks.createSequencingRunForOrder.mockResolvedValue({ id: "run-db-new" });
    mocks.prefillSequencingRunSamplesFromOrderBarcodes.mockResolvedValue(
      undefined
    );
    mocks.upsertSequencingRunSamples.mockResolvedValue(undefined);
    mocks.workbookLoad.mockResolvedValue(undefined);

    // Default worksheet: one run, two valid samples.
    const sheet = makeSheet("Run Samples", [
      ["Run", "Sample", "Barcode"],
      ["R1", "S1", "BC01"],
      ["R1", "S2", "BC02"],
    ]);
    mocks.getWorksheet.mockImplementation((name: string) =>
      name === "Run Samples" ? sheet : undefined
    );
    mocks.worksheets = [sheet];
  });

  it("returns 401 when not authenticated", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new SequencingApiError(401, "Unauthorized")
    );

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 for demo sessions", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new SequencingApiError(
        403,
        "Sequencing data management is disabled in the public demo."
      )
    );

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("demo");
  });

  it("returns 400 when no file is supplied", async () => {
    const response = await POST(makeRequest(null), { params: baseParams });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Excel file is required" });
  });

  it("returns 400 when the supplied field is not a File", async () => {
    const response = await POST(makeRequest("not-a-file"), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Excel file is required" });
  });

  it("returns 413 when the file exceeds the size limit", async () => {
    const response = await POST(
      makeRequest(makeFile(6 * 1024 * 1024)),
      { params: baseParams }
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("limited to 5 MB");
  });

  it("returns 400 when no worksheet with sample rows is found", async () => {
    mocks.getWorksheet.mockReturnValue(undefined);
    mocks.worksheets = [];

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "No worksheet with sample rows found",
    });
  });

  it("falls back to the first worksheet with more than one row", async () => {
    const sheet = makeSheet("Tabelle9", [
      ["Run", "Sample"],
      ["R1", "S1"],
    ]);
    mocks.getWorksheet.mockReturnValue(undefined);
    mocks.worksheets = [sheet];

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sheet).toBe("Tabelle9");
    expect(body.rowCount).toBe(1);
  });

  it("returns 400 when too many data rows are present", async () => {
    const sheet = makeSheet(
      "Run Samples",
      [["Run", "Sample"]],
      { actualRowCount: 1002 }
    );
    mocks.getWorksheet.mockImplementation((name: string) =>
      name === "Run Samples" ? sheet : undefined
    );

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("1000 data rows");
  });

  it("returns 400 when too many columns are present", async () => {
    const sheet = makeSheet(
      "Run Samples",
      [["Run", "Sample"], ["R1", "S1"]],
      { actualColumnCount: 81 }
    );
    mocks.getWorksheet.mockImplementation((name: string) =>
      name === "Run Samples" ? sheet : undefined
    );

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("80 columns");
  });

  it("builds a preview with unmapped columns and parsed rows", async () => {
    const sheet = makeSheet("Run Samples", [
      ["Run", "Sample", "Barcode", "Notes"],
      ["R1", "S1", "BC01", "ignored note"],
      ["R1", "S2", "BC02", ""],
    ]);
    mocks.getWorksheet.mockImplementation((name: string) =>
      name === "Run Samples" ? sheet : undefined
    );

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rowCount).toBe(2);
    expect(body.unmappedColumns).toEqual(["Notes"]);
    expect(body.rows[0]).toMatchObject({
      rowNumber: 2,
      runId: "R1",
      sampleCode: "S1",
      barcode: "BC01",
      unmapped: { Notes: "ignored note" },
    });
    expect(body.applyReady).toBe(true);
    // Preview must not write anything.
    expect(mocks.upsertSequencingRunSamples).not.toHaveBeenCalled();
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });

  it("skips blank rows and flags rows missing run or sample", async () => {
    const sheet = makeSheet("Run Samples", [
      ["Run", "Sample", "Barcode"],
      ["R1", "S1", "BC01"],
      ["", "", ""], // fully blank -> skipped
      ["R1", "", "BC03"], // missing sample -> row error
    ]);
    mocks.getWorksheet.mockImplementation((name: string) =>
      name === "Run Samples" ? sheet : undefined
    );

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rowCount).toBe(1);
    expect(body.rowErrors).toContainEqual({
      rowNumber: 4,
      message: "Rows must include both Run and Sample/Patient columns",
    });
    expect(body.applyReady).toBe(false);
  });

  it("flags samples that do not exist on the order", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "db-s1", sampleId: "S1", customFields: null },
    ]);
    const sheet = makeSheet("Run Samples", [
      ["Run", "Sample", "Barcode"],
      ["R1", "S1", "BC01"],
      ["R1", "S2", "BC02"], // S2 not on order
    ]);
    mocks.getWorksheet.mockImplementation((name: string) =>
      name === "Run Samples" ? sheet : undefined
    );

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.missingSamples).toEqual(["S2"]);
    expect(body.rowErrors).toContainEqual({
      rowNumber: null,
      message: "Sample not found on this order: S2",
    });
    expect(body.applyReady).toBe(false);
  });

  it("flags duplicate barcodes from findDuplicateRunPlanBarcodes", async () => {
    mocks.findDuplicateRunPlanBarcodes.mockReturnValue([
      { runId: "R1", barcode: "BC01", count: 2 },
    ]);

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.duplicateBarcodes).toEqual([
      { runId: "R1", barcode: "BC01", count: 2 },
    ]);
    expect(body.rowErrors).toContainEqual({
      rowNumber: null,
      message: "Barcode BC01 appears 2 times in run R1",
    });
    expect(body.applyReady).toBe(false);
  });

  it("returns 400 on apply when rows still need review", async () => {
    mocks.findDuplicateRunPlanBarcodes.mockReturnValue([
      { runId: "R1", barcode: "BC01", count: 2 },
    ]);

    const response = await POST(makeRequest(makeFile(), { apply: true }), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("need review before saving");
    // The preview payload is spread into the error body.
    expect(body.duplicateBarcodes).toHaveLength(1);
    expect(mocks.upsertSequencingRunSamples).not.toHaveBeenCalled();
  });

  it("applies the import: reuses existing run and upserts assignments", async () => {
    const response = await POST(makeRequest(makeFile(), { apply: true }), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.createdOrUpdated).toEqual([{ runId: "R1", assignments: 2 }]);

    expect(mocks.db.sequencingRun.findFirst).toHaveBeenCalledWith({
      where: { orderId: "order-1", runId: "R1" },
      select: { id: true },
    });
    // Existing run reused -> no creation/prefill.
    expect(mocks.createSequencingRunForOrder).not.toHaveBeenCalled();
    expect(
      mocks.prefillSequencingRunSamplesFromOrderBarcodes
    ).not.toHaveBeenCalled();

    expect(mocks.upsertSequencingRunSamples).toHaveBeenCalledWith({
      orderId: "order-1",
      runDbId: "run-db-1",
      assignments: [
        { sampleId: "S1", barcode: "BC01", customFields: {} },
        { sampleId: "S2", barcode: "BC02", customFields: {} },
      ],
    });
  });

  it("creates a missing run and prefills it before upserting", async () => {
    mocks.db.sequencingRun.findFirst.mockResolvedValue(null);

    const response = await POST(makeRequest(makeFile(), { apply: true }), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    expect(mocks.createSequencingRunForOrder).toHaveBeenCalledWith({
      orderId: "order-1",
      runId: "R1",
      runName: "R1",
    });
    expect(
      mocks.prefillSequencingRunSamplesFromOrderBarcodes
    ).toHaveBeenCalledWith({ orderId: "order-1", runDbId: "run-db-new" });
    expect(mocks.upsertSequencingRunSamples).toHaveBeenCalledWith(
      expect.objectContaining({ runDbId: "run-db-new" })
    );
  });

  it("writes sample-scoped custom fields to the matching sample", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "db-s1",
        sampleId: "S1",
        customFields: JSON.stringify({ existing: "keep" }),
      },
    ]);
    const sheet = makeSheet("Run Samples", [
      ["Run", "Sample", "Barcode", "SamplingDate"],
      ["R1", "S1", "BC01", "2024-01-02"],
    ]);
    mocks.getWorksheet.mockImplementation((name: string) =>
      name === "Run Samples" ? sheet : undefined
    );

    const response = await POST(makeRequest(makeFile(), { apply: true }), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    // sampling_date is a sample-scoped field -> persisted onto the sample,
    // merged with existing custom fields.
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "db-s1" },
      data: {
        customFields: JSON.stringify({
          existing: "keep",
          sampling_date: "2024-01-02",
        }),
      },
    });
    // sampling_date must NOT leak into the run-assignment custom fields.
    expect(mocks.upsertSequencingRunSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        assignments: [{ sampleId: "S1", barcode: "BC01", customFields: {} }],
      })
    );
  });

  it("groups assignments across multiple runs", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "db-s1", sampleId: "S1", customFields: null },
      { id: "db-s2", sampleId: "S2", customFields: null },
    ]);
    mocks.db.sequencingRun.findFirst.mockImplementation(
      async ({ where }: { where: { runId: string } }) =>
        where.runId === "R1" ? { id: "run-db-1" } : { id: "run-db-2" }
    );
    const sheet = makeSheet("Run Samples", [
      ["Run", "Sample", "Barcode"],
      ["R1", "S1", "BC01"],
      ["R2", "S2", "BC02"],
    ]);
    mocks.getWorksheet.mockImplementation((name: string) =>
      name === "Run Samples" ? sheet : undefined
    );

    const response = await POST(makeRequest(makeFile(), { apply: true }), {
      params: baseParams,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.createdOrUpdated).toEqual([
      { runId: "R1", assignments: 1 },
      { runId: "R2", assignments: 1 },
    ]);
    expect(mocks.upsertSequencingRunSamples).toHaveBeenCalledTimes(2);
  });

  it("returns 400 with the error message on unexpected failures", async () => {
    mocks.workbookLoad.mockRejectedValue(new Error("corrupt workbook"));

    const response = await POST(makeRequest(makeFile()), {
      params: baseParams,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("corrupt workbook");
  });
});
