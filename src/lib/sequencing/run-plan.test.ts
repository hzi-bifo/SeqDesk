import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
    sequencingRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
    },
    sequencingRunSample: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    orderFormConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { Prisma } from "@prisma/client";
import {
  applyOntRunPlanPreset,
  createSequencingRunForOrder,
  deleteSequencingRunForOrder,
  findDuplicateRunPlanBarcodes,
  filterRunAssignmentFieldsForRole,
  getRunPlanSampleBarcodeAssignments,
  listSequencingRunsForOrder,
  loadRunAssignmentFormSchema,
  mapRunPlanHeader,
  normalizeBarcode,
  normalizeRunPlanImportedValue,
  normalizeRunAssignmentFormSchema,
  ONT_RUN_ASSIGNMENT_FIELDS,
  ONT_SAMPLE_FIELDS,
  prefillSequencingRunSamplesFromOrderBarcodes,
  RUN_PLAN_ASSIGNMENT_MAX_BATCH,
  saveRunAssignmentFormSchema,
  updateSequencingRunForOrder,
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
    mocks.db.sequencingRun.update.mockResolvedValue({ id: "run-db-1" });
    mocks.db.sequencingRun.delete.mockResolvedValue({ id: "run-db-1" });
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-db-1", sampleId: "sample-1" },
    ]);
    mocks.db.sequencingRunSample.findMany.mockResolvedValue([]);
    mocks.db.sequencingRunSample.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.sequencingRunSample.upsert.mockResolvedValue({ id: "assignment-1" });
    mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });
    mocks.db.siteSettings.upsert.mockResolvedValue({});
    mocks.db.orderFormConfig.findUnique.mockResolvedValue(null);
    mocks.db.orderFormConfig.upsert.mockResolvedValue({});
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
    expect(mapRunPlanHeader("10ng DNA 20 µl H2O")).toBe("total_volume_ul");
    expect(mapRunPlanHeader("Nanopore DNA (ng/µl) after PCR and purification")).toBe(
      "post_pcr_concentration_ng_ul"
    );
    expect(mapRunPlanHeader("Unknown Column")).toBeNull();
  });

  it("includes order barcode fields in the ONT sample preset", () => {
    expect(ONT_SAMPLE_FIELDS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "barcode",
          name: "_barcode",
          perSample: true,
          moduleSource: "sequencing-tech",
        }),
      ])
    );
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

  it("allows barcode swaps when both owning samples are in the same request", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-db-1", sampleId: "sample-1" },
      { id: "sample-db-2", sampleId: "sample-2" },
    ]);
    mocks.db.sequencingRunSample.findMany.mockResolvedValue([
      { sampleId: "sample-db-1", barcode: "barcode01" },
      { sampleId: "sample-db-2", barcode: "barcode02" },
    ]);

    await upsertSequencingRunSamples({
      orderId: "order-1",
      runDbId: "run-db-1",
      assignments: [
        { sampleId: "sample-1", barcode: "BC2" },
        { sampleId: "sample-2", barcode: "BC1" },
      ],
    });

    expect(mocks.db.sequencingRunSample.updateMany).toHaveBeenCalledWith({
      where: {
        sequencingRunId: "run-db-1",
        sampleId: { in: ["sample-db-1", "sample-db-2"] },
        barcode: { in: ["barcode02", "barcode01"] },
      },
      data: { barcode: null },
    });
    expect(mocks.db.sequencingRunSample.upsert).toHaveBeenCalledTimes(2);
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

  // ---------------------------------------------------------------------------
  // normalizeRunAssignmentFormSchema: group id/order defaults + sorting.
  // ---------------------------------------------------------------------------

  it("assigns group ids and orders groups by their declared order", () => {
    const schema = normalizeRunAssignmentFormSchema({
      fields: [],
      groups: [
        { id: "", name: "Second", order: 5 },
        { id: "first-group", name: "First", order: 1 },
      ] as never,
    });

    // Sorted by order ascending; the empty id gets a generated fallback.
    expect(schema.groups[0]).toMatchObject({ name: "First", order: 1 });
    expect(schema.groups[1].name).toBe("Second");
    expect(schema.groups[1].id).toBe("group_run_assignment_0");
  });

  it("falls back to the default run-assignment fields when none are provided", () => {
    const schema = normalizeRunAssignmentFormSchema();
    expect(schema.fields.length).toBe(ONT_RUN_ASSIGNMENT_FIELDS.length);
    expect(schema.groups.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // loadRunAssignmentFormSchema / saveRunAssignmentFormSchema.
  // ---------------------------------------------------------------------------

  it("loads the default run-assignment schema when no settings are stored", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });

    const schema = await loadRunAssignmentFormSchema();

    expect(schema.fields.length).toBe(ONT_RUN_ASSIGNMENT_FIELDS.length);
    expect(schema.version).toBe(1);
    expect(schema.defaultsVersion).toBe(1);
  });

  it("loads stored fields and applies the role filter for non-admins", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingRunSampleFormFields: [
          { id: "f_public", type: "text", label: "Public", name: "public", visible: true },
          { id: "f_admin", type: "text", label: "Admin", name: "admin", visible: true, adminOnly: true },
        ],
        sequencingRunSampleFormDefaultsVersion: 7,
      }),
    });

    const adminSchema = await loadRunAssignmentFormSchema({
      isFacilityAdmin: true,
      applyRoleFilter: true,
    });
    const userSchema = await loadRunAssignmentFormSchema({
      isFacilityAdmin: false,
      applyRoleFilter: true,
    });

    expect(adminSchema.fields.map((f) => f.name)).toEqual(["public", "admin"]);
    expect(userSchema.fields.map((f) => f.name)).toEqual(["public"]);
    expect(adminSchema.defaultsVersion).toBe(7);
  });

  it("saves the normalized run-assignment schema into extra settings", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });

    const result = await saveRunAssignmentFormSchema({
      fields: [
        { id: "", type: "text", label: "Notes", name: "Run Notes", visible: true } as never,
      ],
    });

    expect(result.fields[0]).toMatchObject({ name: "run_notes", perSample: false });
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = mocks.db.siteSettings.upsert.mock.calls[0][0];
    const saved = JSON.parse(upsertArg.update.extraSettings);
    expect(saved.sequencingRunSampleFormFields[0].name).toBe("run_notes");
    expect(saved.sequencingRunSampleFormDefaultsVersion).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // applyOntRunPlanPreset: order + run-assignment field merge.
  // ---------------------------------------------------------------------------

  it("adds ONT preset fields to a fresh order config and run-assignment schema", async () => {
    mocks.db.orderFormConfig.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });

    const result = await applyOntRunPlanPreset();

    expect(result.orderFieldsAdded).toBeGreaterThan(0);
    expect(result.runAssignmentFieldsAdded).toBe(ONT_RUN_ASSIGNMENT_FIELDS.length);
    expect(mocks.db.orderFormConfig.upsert).toHaveBeenCalledTimes(1);
    const orderUpsert = mocks.db.orderFormConfig.upsert.mock.calls[0][0];
    expect(orderUpsert.create.version).toBe(1);
  });

  it("does not re-add ONT fields already present in the order config", async () => {
    const existingOrderFields = [
      ...ONT_SAMPLE_FIELDS,
      { id: "field_ont_run_type", type: "select", label: "Run Type", name: "run_type", visible: true },
    ];
    mocks.db.orderFormConfig.findUnique.mockResolvedValue({
      schema: JSON.stringify({ fields: existingOrderFields, groups: [], enabledMixsChecklists: ["mixs-1"] }),
      version: 4,
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        sequencingRunSampleFormFields: ONT_RUN_ASSIGNMENT_FIELDS,
      }),
    });

    const result = await applyOntRunPlanPreset();

    // run_type already present, so fewer than the full ONT order field set is added.
    expect(result.runAssignmentFieldsAdded).toBe(0);
    const orderUpsert = mocks.db.orderFormConfig.upsert.mock.calls[0][0];
    expect(orderUpsert.update.version).toBe(5);
    // Existing enabled checklists are preserved in the update payload.
    expect(JSON.parse(orderUpsert.update.schema).enabledMixsChecklists).toEqual(["mixs-1"]);
  });

  // ---------------------------------------------------------------------------
  // createSequencingRunForOrder / update / delete happy + guard paths.
  // ---------------------------------------------------------------------------

  it("creates a sequencing run with trimmed and parsed fields", async () => {
    mocks.db.order.findUnique.mockResolvedValue({ id: "order-1", status: "SUBMITTED" });

    await createSequencingRunForOrder({
      orderId: "order-1",
      runId: "  RUN-1  ",
      runName: "  My Run  ",
      platform: "  ONT  ",
      instrument: "  MinION  ",
      runDate: "13.12.2022",
      folderPath: "  /data/run  ",
      runParameters: { foo: "bar" },
    });

    expect(mocks.db.sequencingRun.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-1",
        runId: "RUN-1",
        runName: "My Run",
        platform: "ONT",
        instrument: "MinION",
        runDate: new Date("2022-12-13"),
        folderPath: "/data/run",
        runParameters: JSON.stringify({ foo: "bar" }),
      },
    });
  });

  it("rejects run creation when the order is missing", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);

    await expect(
      createSequencingRunForOrder({ orderId: "order-1", runId: "RUN-1" })
    ).rejects.toThrow("Order not found");
    expect(mocks.db.sequencingRun.create).not.toHaveBeenCalled();
  });

  it("rejects run creation when the run ID is blank", async () => {
    mocks.db.order.findUnique.mockResolvedValue({ id: "order-1", status: "COMPLETED" });

    await expect(
      createSequencingRunForOrder({ orderId: "order-1", runId: "   " })
    ).rejects.toThrow("Run ID is required");
  });

  it("updates only the provided run fields, leaving omitted ones untouched", async () => {
    await updateSequencingRunForOrder({
      orderId: "order-1",
      runDbId: "run-db-1",
      runName: "  Updated  ",
      // platform/instrument/runDate/folderPath/runParameters omitted.
    });

    expect(mocks.db.sequencingRun.update).toHaveBeenCalledWith({
      where: { id: "run-db-1" },
      data: {
        runName: "Updated",
        platform: undefined,
        instrument: undefined,
        runDate: undefined,
        folderPath: undefined,
        runParameters: undefined,
      },
    });
  });

  it("clears nullable run fields when explicit null/empty values are supplied", async () => {
    await updateSequencingRunForOrder({
      orderId: "order-1",
      runDbId: "run-db-1",
      runName: null,
      platform: "   ",
      runParameters: {},
    });

    expect(mocks.db.sequencingRun.update).toHaveBeenCalledWith({
      where: { id: "run-db-1" },
      data: expect.objectContaining({
        runName: null,
        platform: null,
        runParameters: null,
      }),
    });
  });

  it("rejects updates when the run does not belong to the order", async () => {
    mocks.db.sequencingRun.findFirst.mockResolvedValue(null);

    await expect(
      updateSequencingRunForOrder({ orderId: "order-1", runDbId: "missing" })
    ).rejects.toThrow("Sequencing run not found");
    expect(mocks.db.sequencingRun.update).not.toHaveBeenCalled();
  });

  it("deletes a run that belongs to a manageable order", async () => {
    await deleteSequencingRunForOrder("order-1", "run-db-1");
    expect(mocks.db.sequencingRun.delete).toHaveBeenCalledWith({ where: { id: "run-db-1" } });
  });

  // ---------------------------------------------------------------------------
  // upsertSequencingRunSamples: conflict guards and limits.
  // ---------------------------------------------------------------------------

  it("rejects assignment batches above the maximum size", async () => {
    const assignments = Array.from({ length: RUN_PLAN_ASSIGNMENT_MAX_BATCH + 1 }, (_, i) => ({
      sampleId: `sample-${i}`,
    }));

    await expect(
      upsertSequencingRunSamples({ orderId: "order-1", runDbId: "run-db-1", assignments })
    ).rejects.toThrow(`limited to ${RUN_PLAN_ASSIGNMENT_MAX_BATCH} rows`);
  });

  it("throws when an assignment references an unknown sample", async () => {
    mocks.db.sample.findMany.mockResolvedValue([{ id: "sample-db-1", sampleId: "sample-1" }]);

    await expect(
      upsertSequencingRunSamples({
        orderId: "order-1",
        runDbId: "run-db-1",
        assignments: [{ sampleId: "unknown-sample", barcode: "BC1" }],
      })
    ).rejects.toThrow("Sample not found: unknown-sample");
  });

  it("rejects a request that assigns the same barcode to two samples", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-db-1", sampleId: "sample-1" },
      { id: "sample-db-2", sampleId: "sample-2" },
    ]);

    await expect(
      upsertSequencingRunSamples({
        orderId: "order-1",
        runDbId: "run-db-1",
        assignments: [
          { sampleId: "sample-1", barcode: "BC1" },
          { sampleId: "sample-2", barcode: "barcode01" },
        ],
      })
    ).rejects.toThrow("assigned more than once in this request");
  });

  it("rejects when a barcode is already held by a sample outside the request", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      { id: "sample-db-1", sampleId: "sample-1" },
    ]);
    // The barcode is already owned by sample-db-9, which is NOT in this request.
    mocks.db.sequencingRunSample.findMany.mockResolvedValue([
      { sampleId: "sample-db-9", barcode: "barcode01" },
    ]);

    await expect(
      upsertSequencingRunSamples({
        orderId: "order-1",
        runDbId: "run-db-1",
        assignments: [{ sampleId: "sample-1", barcode: "BC1" }],
      })
    ).rejects.toThrow("Barcode barcode01 is already assigned in this run");
  });

  it("translates a Prisma P2002 unique violation into a friendly barcode error", async () => {
    mocks.db.sample.findMany.mockResolvedValue([{ id: "sample-db-1", sampleId: "sample-1" }]);
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    mocks.db.sequencingRunSample.upsert.mockRejectedValue(p2002);

    await expect(
      upsertSequencingRunSamples({
        orderId: "order-1",
        runDbId: "run-db-1",
        assignments: [{ sampleId: "sample-1", barcode: "BC1" }],
      })
    ).rejects.toThrow("Barcode barcode01 is already assigned in this run");
  });

  it("re-throws unexpected upsert errors unchanged", async () => {
    mocks.db.sample.findMany.mockResolvedValue([{ id: "sample-db-1", sampleId: "sample-1" }]);
    mocks.db.sequencingRunSample.upsert.mockRejectedValue(new Error("connection reset"));

    await expect(
      upsertSequencingRunSamples({
        orderId: "order-1",
        runDbId: "run-db-1",
        assignments: [{ sampleId: "sample-1", barcode: "BC1" }],
      })
    ).rejects.toThrow("connection reset");
  });

  // ---------------------------------------------------------------------------
  // normalizeRunPlanImportedValue: remaining branches.
  // ---------------------------------------------------------------------------

  it("normalizes barcode, falls back to raw text on unparseable dates/numbers", () => {
    expect(normalizeRunPlanImportedValue("barcode", "BC7")).toBe("barcode07");
    // Non-date text in a *_date field returns the raw text unchanged.
    expect(normalizeRunPlanImportedValue("sampling_date", "not a date")).toBe("not a date");
    // Non-numeric concentration text returns the raw text.
    expect(normalizeRunPlanImportedValue("concentration_ng_ul", "n/a")).toBe("n/a");
    // Empty/whitespace input returns null.
    expect(normalizeRunPlanImportedValue("run_specific_notes", "   ")).toBeNull();
    // Plain text passthrough.
    expect(normalizeRunPlanImportedValue("run_specific_notes", "hello")).toBe("hello");
  });

  // ---------------------------------------------------------------------------
  // listSequencingRunsForOrder: serialization of runs + sample rows.
  // ---------------------------------------------------------------------------

  it("lists sequencing runs for an order with mapped sample rows", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });
    mocks.db.sequencingRun.findMany.mockResolvedValue([
      {
        id: "run-db-1",
        runId: "RUN-1",
        runName: "Run One",
        platform: "ONT",
        instrument: "MinION",
        runDate: new Date("2026-01-02T00:00:00.000Z"),
        folderPath: "/data/run-1",
        runParameters: JSON.stringify({ basecaller: "dorado" }),
        samples: [
          {
            id: "assignment-1",
            barcode: "barcode03",
            customFields: JSON.stringify({ depletion: "HD" }),
            sample: {
              id: "sample-db-1",
              sampleId: "S1",
              sampleTitle: "Sample One",
              sampleAlias: "Alias",
              customFields: JSON.stringify({ material_body_site: "blood" }),
              reads: [{ id: "read-1" }, { id: "read-2" }],
              sequencingArtifacts: [{ id: "artifact-1" }],
            },
          },
        ],
      },
    ]);

    const result = await listSequencingRunsForOrder("order-1", { isFacilityAdmin: true });

    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      runId: "RUN-1",
      runName: "Run One",
      platform: "ONT",
      runDate: "2026-01-02T00:00:00.000Z",
      runParameters: { basecaller: "dorado" },
    });
    expect(result.runs[0].samples[0]).toMatchObject({
      sampleId: "sample-db-1",
      sampleCode: "S1",
      material: "blood",
      barcode: "barcode03",
      readCount: 2,
      artifactCount: 1,
      customFields: { depletion: "HD" },
    });
  });
});
