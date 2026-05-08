import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
    sequencingRun: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
    },
    sequencingRunSample: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import {
  createSequencingRunForOrder,
  findDuplicateRunPlanBarcodes,
  filterRunAssignmentFieldsForRole,
  getRunPlanSampleBarcodeAssignments,
  mapRunPlanHeader,
  normalizeBarcode,
  normalizeRunPlanImportedValue,
  normalizeRunAssignmentFormSchema,
  ONT_RUN_ASSIGNMENT_FIELDS,
  prefillSequencingRunSamplesFromOrderBarcodes,
  upsertSequencingRunSamples,
} from "./run-plan";

describe("sequencing run plan helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.order.findUnique.mockResolvedValue({ id: "order-1", status: "COMPLETED" });
    mocks.db.sequencingRun.findFirst.mockResolvedValue({
      id: "run-db-1",
      order: { status: "COMPLETED" },
    });
    mocks.db.sequencingRun.create.mockResolvedValue({ id: "run-db-1" });
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-db-1", sampleId: "sample-1" },
    ]);
    mocks.db.sequencingRunSample.findMany.mockResolvedValue([]);
    mocks.db.sequencingRunSample.upsert.mockResolvedValue({ id: "assignment-1" });
  });

  it("normalizes and deduplicates run-assignment fields", () => {
    const schema = normalizeRunAssignmentFormSchema({
      fields: [
        {
          id: "",
          type: "text",
          label: "Extraction Date",
          name: "Extraction Date",
          required: false,
          visible: true,
          order: 2,
        },
        {
          id: "duplicate",
          type: "text",
          label: "Extraction Date Duplicate",
          name: "extraction_date",
          required: false,
          visible: true,
          order: 3,
        },
      ],
    });

    expect(schema.fields).toHaveLength(1);
    expect(schema.fields[0]).toMatchObject({
      name: "extraction_date",
      perSample: false,
      visible: true,
    });
  });

  it("filters internal run-assignment fields for non-admin users", () => {
    const visible = filterRunAssignmentFieldsForRole(ONT_RUN_ASSIGNMENT_FIELDS, false);

    expect(visible.every((field) => !field.adminOnly)).toBe(true);
    expect(
      filterRunAssignmentFieldsForRole(ONT_RUN_ASSIGNMENT_FIELDS, true).length
    ).toBeGreaterThan(visible.length);
  });

  it("normalizes customer barcode formats", () => {
    expect(normalizeBarcode("9")).toBe("barcode09");
    expect(normalizeBarcode("BC1")).toBe("barcode01");
    expect(normalizeBarcode("barcode12")).toBe("barcode12");
    expect(normalizeBarcode("")).toBeNull();
  });

  it("maps customer Excel headers to run plan fields", () => {
    expect(mapRunPlanHeader("Run")).toBe("runId");
    expect(mapRunPlanHeader("Barcode")).toBe("barcode");
    expect(mapRunPlanHeader("Patient")).toBe("sampleCode");
    expect(mapRunPlanHeader("Material")).toBe("material_body_site");
    expect(mapRunPlanHeader("DNA(ng/µl)")).toBe("concentration_ng_ul");
    expect(mapRunPlanHeader("Unknown Column")).toBeNull();
  });

  it("normalizes German date and decimal Excel values", () => {
    expect(normalizeRunPlanImportedValue("sampling_date", "13.12.2022")).toBe(
      "2022-12-13"
    );
    expect(normalizeRunPlanImportedValue("extraction_date", "13_12_2022")).toBe(
      "2022-12-13"
    );
    expect(normalizeRunPlanImportedValue("concentration_ng_ul", "4,8")).toBe(4.8);
    expect(normalizeRunPlanImportedValue("total_volume_ul", "20")).toBe(20);
  });

  it("detects duplicate barcodes within the same run only", () => {
    expect(
      findDuplicateRunPlanBarcodes([
        { runId: "run-1", barcode: "BC01" },
        { runId: "run-1", barcode: "barcode01" },
        { runId: "run-2", barcode: "barcode01" },
        { runId: "run-1", barcode: "" },
      ])
    ).toEqual([{ runId: "run-1", barcode: "barcode01", count: 2 }]);
  });

  it("builds run-plan prefill assignments from order sample barcodes", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-db-1",
        sampleId: "sample-1",
        customFields: JSON.stringify({ _barcode: "BC1" }),
      },
      {
        id: "sample-db-2",
        sampleId: "sample-2",
        customFields: JSON.stringify({ _barcode: "barcode02" }),
      },
      {
        id: "sample-db-3",
        sampleId: "sample-3",
        customFields: JSON.stringify({ _barcode: "" }),
      },
    ]);

    await expect(getRunPlanSampleBarcodeAssignments("order-1")).resolves.toEqual({
      assignments: [
        { sampleId: "sample-db-1", barcode: "barcode01" },
        { sampleId: "sample-db-2", barcode: "barcode02" },
      ],
      duplicateBarcodes: [],
    });
  });

  it("skips duplicate order barcodes during run-plan prefill", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-db-1",
        sampleId: "sample-1",
        customFields: JSON.stringify({ _barcode: "BC1" }),
      },
      {
        id: "sample-db-2",
        sampleId: "sample-2",
        customFields: JSON.stringify({ _barcode: "barcode01" }),
      },
      {
        id: "sample-db-3",
        sampleId: "sample-3",
        customFields: JSON.stringify({ _barcode: "BC2" }),
      },
    ]);

    await expect(getRunPlanSampleBarcodeAssignments("order-1")).resolves.toEqual({
      assignments: [{ sampleId: "sample-db-3", barcode: "barcode02" }],
      duplicateBarcodes: ["barcode01"],
    });
  });

  it("prefills sequencing run samples from order barcodes", async () => {
    mocks.db.sample.findMany
      .mockResolvedValueOnce([
        {
          id: "sample-db-1",
          sampleId: "sample-1",
          customFields: JSON.stringify({ _barcode: "BC1" }),
        },
      ])
      .mockResolvedValueOnce([
        { id: "sample-db-1", sampleId: "sample-1" },
      ]);

    const result = await prefillSequencingRunSamplesFromOrderBarcodes({
      orderId: "order-1",
      runDbId: "run-db-1",
    });

    expect(result).toEqual({ assigned: 1, duplicateBarcodes: [] });
    expect(mocks.db.sequencingRunSample.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sequencingRunId_sampleId: {
            sequencingRunId: "run-db-1",
            sampleId: "sample-db-1",
          },
        },
        create: expect.objectContaining({
          sequencingRunId: "run-db-1",
          sampleId: "sample-db-1",
          barcode: "barcode01",
        }),
      })
    );
  });

  it("preserves existing run assignment metadata when fields are omitted", async () => {
    await upsertSequencingRunSamples({
      orderId: "order-1",
      runDbId: "run-db-1",
      assignments: [{ sampleId: "sample-1", barcode: "BC1" }],
    });

    expect(mocks.db.sequencingRunSample.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = mocks.db.sequencingRunSample.upsert.mock.calls[0][0];
    expect(upsertArg.update).toEqual({ barcode: "barcode01" });
    expect(upsertArg.create).toEqual({
      sequencingRunId: "run-db-1",
      sampleId: "sample-db-1",
      barcode: "barcode01",
      customFields: null,
      notes: null,
    });
  });

  it("clears run assignment metadata when empty values are provided", async () => {
    await upsertSequencingRunSamples({
      orderId: "order-1",
      runDbId: "run-db-1",
      assignments: [
        { sampleId: "sample-1", barcode: null, customFields: {}, notes: "" },
      ],
    });

    expect(mocks.db.sequencingRunSample.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = mocks.db.sequencingRunSample.upsert.mock.calls[0][0];
    expect(upsertArg.update).toEqual({
      barcode: null,
      customFields: null,
      notes: null,
    });
  });

  it("rejects run creation for non-manageable orders", async () => {
    mocks.db.order.findUnique.mockResolvedValue({ id: "order-1", status: "DRAFT" });

    await expect(
      createSequencingRunForOrder({
        orderId: "order-1",
        runId: "RUN-1",
      })
    ).rejects.toThrow(
      "Sequencing run plans can only be managed on submitted or completed orders"
    );
    expect(mocks.db.sequencingRun.create).not.toHaveBeenCalled();
  });

  it("rejects run assignment changes for non-manageable orders", async () => {
    mocks.db.sequencingRun.findFirst.mockResolvedValue({
      id: "run-db-1",
      order: { status: "DRAFT" },
    });

    await expect(
      upsertSequencingRunSamples({
        orderId: "order-1",
        runDbId: "run-db-1",
        assignments: [{ sampleId: "sample-1", barcode: "BC1" }],
      })
    ).rejects.toThrow(
      "Sequencing run plans can only be managed on submitted or completed orders"
    );
    expect(mocks.db.sequencingRunSample.upsert).not.toHaveBeenCalled();
  });
});
