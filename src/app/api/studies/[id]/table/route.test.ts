import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  loadStudyFormSchema: vi.fn(),
  loadOrderFormSchema: vi.fn(),
  getChecklistForStudy: vi.fn(),
  parseStudyModulesConfig: vi.fn(),
  isStudyModuleEnabled: vi.fn(),
  db: {
    study: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
    studyFormConfig: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/studies/schema", () => ({
  loadStudyFormSchema: mocks.loadStudyFormSchema,
  parseStudyModulesConfig: mocks.parseStudyModulesConfig,
  isStudyModuleEnabled: mocks.isStudyModuleEnabled,
}));
vi.mock("@/lib/orders/order-form", () => ({
  loadOrderFormSchema: mocks.loadOrderFormSchema,
}));
vi.mock("@/lib/mixs/config", () => ({
  getChecklistForStudy: mocks.getChecklistForStudy,
}));

import { GET, PATCH } from "./route";

const params = Promise.resolve({ id: "study-1" });
const req = () => new Request("http://localhost/api/studies/study-1/table");

function adminSession() {
  return { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
}
function researcherSession(id = "user-1") {
  return { user: { id, role: "RESEARCHER" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerSession.mockResolvedValue(adminSession());
  mocks.db.study.findUnique.mockResolvedValue({
    id: "study-1",
    title: "Study One",
    alias: null,
    userId: "user-1",
    checklistType: "soil",
    studyMetadata: JSON.stringify({ study_abstract: "An abstract" }),
  });
  mocks.db.study.findFirst.mockResolvedValue(null);
  mocks.db.sample.findMany.mockResolvedValue([
    {
      id: "s1",
      sampleId: "S-1",
      sampleAlias: null,
      sampleTitle: "Gut sample",
      sampleDescription: null,
      scientificName: "Escherichia coli",
      taxId: "562",
      sampleAccessionNumber: null,
      checklistData: JSON.stringify({ collection_date: "2024-01-01" }),
      customFields: JSON.stringify({ sample_volume: "5", legacy_field: "x" }),
      facilityStatus: "SEQUENCED",
      biosampleNumber: "SAMN999",
      reads: [
        {
          file1: "a.fq",
          file2: "b.fq",
          readCount1: 1000,
          readCount2: 1000,
          avgQuality1: 35.5,
          avgQuality2: null,
          dataClass: "cleaned",
          runAccessionNumber: "ERR123",
        },
      ],
      assemblies: [{ assemblyName: "asm1", assemblyAccession: null }],
      order: {
        id: "o1",
        orderNumber: "ORD-1",
        name: "My Order",
        platform: "Illumina",
        instrumentModel: "NovaSeq",
        libraryStrategy: null,
        librarySource: null,
        librarySelection: null,
        customFields: null,
      },
    },
    {
      id: "s2",
      sampleId: "S-2",
      sampleAlias: null,
      sampleTitle: null,
      sampleDescription: null,
      scientificName: null,
      taxId: null,
      sampleAccessionNumber: "SAMEA123",
      checklistData: null,
      customFields: null,
      facilityStatus: "NONSENSE",
      order: {
        id: "o2",
        orderNumber: "ORD-2",
        name: null,
        platform: null,
        instrumentModel: null,
        libraryStrategy: null,
        librarySource: null,
        librarySelection: null,
        customFields: null,
      },
    },
  ]);
  mocks.db.siteSettings.findUnique.mockResolvedValue({ modulesConfig: null });
  mocks.db.studyFormConfig.findUnique.mockResolvedValue(null);
  mocks.db.sample.findFirst.mockResolvedValue({
    id: "s1",
    checklistData: JSON.stringify({ collection_date: "old", keep: "x" }),
    customFields: JSON.stringify({ sample_volume: "1" }),
  });
  mocks.db.sample.update.mockResolvedValue({});
  mocks.parseStudyModulesConfig.mockReturnValue({});
  mocks.isStudyModuleEnabled.mockReturnValue(false);
  mocks.getChecklistForStudy.mockResolvedValue({
    fields: [{ name: "collection_date" }],
  });
  mocks.loadOrderFormSchema.mockResolvedValue({
    fields: [],
    groups: [],
    version: 1,
    enabledMixsChecklists: [],
    perSampleFields: [
      { name: "sample_volume", label: "Volume", type: "number", visible: true },
      { name: "sample_title", label: "Title", type: "text", visible: true },
    ],
  });
  mocks.loadStudyFormSchema.mockResolvedValue({
    fields: [],
    studyFields: [
      { name: "study_abstract", label: "Study Abstract", type: "textarea", visible: true },
    ],
    perSampleFields: [
      { name: "collection_date", label: "Collection Date", type: "date", visible: true },
      { name: "scientific_name", label: "Organism (dup)", type: "organism", visible: true },
      { name: "hidden_field", label: "Hidden", type: "text", visible: false },
    ],
    groups: [],
    modules: { mixs: false, sampleAssociation: false, funding: false },
  });
});

describe("GET /api/studies/[id]/table", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the study cannot be resolved", async () => {
    mocks.db.study.findUnique.mockResolvedValueOnce(null);
    mocks.db.study.findFirst.mockResolvedValueOnce(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-admin accessing someone else's study", async () => {
    mocks.getServerSession.mockResolvedValueOnce(researcherSession("other-user"));
    const res = await GET(req(), { params });
    expect(res.status).toBe(403);
  });

  it("merges identity + order + study columns (and a stray stored key), deduping core fields", async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    const cols = body.columns.map((c: { label: string; group: string }) => [c.label, c.group]);
    expect(cols).toEqual([
      ["Sample ID", "identity"],
      ["Status", "status"],
      ["Organism", "identity"],
      ["ENA Accession", "identity"],
      ["Sequencing Order", "order"],
      ["Volume", "order"], // order form per-sample field (customFields)
      ["Title", "order"], // order field mapping to the sampleTitle column
      ["Collection Date", "mixs"], // MIxS checklist field → distinct group
      ["Legacy Field", "order"], // stray customFields key, surfaced anyway
      ["Read type", "output"], // pipeline outputs come last
      ["Read files", "output"],
      ["Read count", "output"],
      ["Avg quality", "output"],
      ["BioSample", "output"],
      ["ENA Run", "output"],
      ["Assembly", "output"],
      ["Created", "identity"], // lifecycle dates come last
      ["Last edited", "identity"],
    ]);
  });

  it("fills pipeline-output cells from reads and assemblies", async () => {
    const res = await GET(req(), { params });
    const body = await res.json();
    const r1 = body.rows[0];
    expect(r1.cells["out:dataClass"]).toBe("cleaned");
    expect(r1.cells["out:readFiles"]).toBe("2");
    expect(r1.cells["out:readCount"]).toBe("2,000");
    expect(r1.cells["out:avgQuality"]).toBe("35.5");
    expect(r1.cells["out:biosample"]).toBe("SAMN999");
    expect(r1.cells["out:runAccession"]).toBe("ERR123");
    expect(r1.cells["out:assembly"]).toBe("asm1");
    // a sample with no reads/assemblies → empty output cells
    expect(body.rows[1].cells["out:readFiles"]).toBe("");
  });

  it("fills cells from the right source and shows which order a sample came from", async () => {
    const res = await GET(req(), { params });
    const body = await res.json();
    const r1 = body.rows[0];
    expect(r1.status).toBe("SEQUENCED");
    expect(r1.cells._order).toBe("ORD-1 (My Order)");
    expect(r1.cells._organism).toBe("Escherichia coli (taxid 562)");
    expect(r1.cells["custom:sample_volume"]).toBe("5"); // from customFields
    expect(r1.cells["core:sampleTitle"]).toBe("Gut sample"); // from the Sample column
    expect(r1.cells["checklist:collection_date"]).toBe("2024-01-01"); // from checklistData
    expect(r1.cells["custom:legacy_field"]).toBe("x");

    const r2 = body.rows[1];
    expect(r2.status).toBe("WAITING"); // invalid facilityStatus falls back
    expect(r2.cells._order).toBe("ORD-2");
    expect(r2.cells._accession).toBe("SAMEA123");
    expect(r2.cells["custom:sample_volume"]).toBe("");
  });

  it("does not surface stored admin-only per-sample fields as extras to researchers", async () => {
    mocks.getServerSession.mockResolvedValueOnce(researcherSession("user-1"));

    const publicOrderField = {
      name: "sample_volume",
      label: "Volume",
      type: "number",
      visible: true,
      perSample: true,
    };
    const adminOrderField = {
      name: "facility_sample_qc_result",
      label: "Sample QC Result",
      type: "select",
      visible: true,
      perSample: true,
      adminOnly: true,
    };

    mocks.loadOrderFormSchema
      .mockResolvedValueOnce({
        fields: [publicOrderField],
        groups: [],
        version: 1,
        enabledMixsChecklists: [],
        perSampleFields: [publicOrderField],
      })
      .mockResolvedValueOnce({
        fields: [publicOrderField, adminOrderField],
        groups: [],
        version: 1,
        enabledMixsChecklists: [],
        perSampleFields: [publicOrderField, adminOrderField],
      });

    mocks.db.sample.findMany.mockResolvedValueOnce([
      {
        id: "s1",
        sampleId: "S-1",
        sampleAlias: null,
        sampleTitle: null,
        sampleDescription: null,
        scientificName: null,
        taxId: null,
        sampleAccessionNumber: null,
        checklistData: null,
        customFields: JSON.stringify({
          sample_volume: "5",
          facility_sample_qc_result: "PASS",
        }),
        facilityStatus: "WAITING",
        biosampleNumber: null,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
        reads: [],
        assemblies: [],
        order: {
          id: "o1",
          orderNumber: "ORD-1",
          name: null,
          platform: null,
          instrumentModel: null,
          libraryStrategy: null,
          librarySource: null,
          librarySelection: null,
          customFields: null,
        },
      },
    ]);

    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.columns.map((column: { key: string }) => column.key)).not.toContain(
      "custom:facility_sample_qc_result"
    );
    expect(body.rows[0].cells["custom:facility_sample_qc_result"]).toBeUndefined();
  });

  it("groups not-per-sample info into a Study panel and a per-order Sequencing panel", async () => {
    const res = await GET(req(), { params });
    const body = await res.json();
    expect(body.perStudy).toBe(false);

    const studyPanel = body.info.find((p: { heading: string }) => p.heading === "Study");
    expect(studyPanel.fields).toEqual([
      { label: "MIxS checklist", value: "soil" },
      { label: "Study Abstract", value: "An abstract" },
    ]);

    // Only the order that has sequencer info gets a panel (ORD-1 → Illumina/NovaSeq).
    const orderPanels = body.info.filter(
      (p: { heading: string }) => p.heading === "Sequencing Order"
    );
    expect(orderPanels).toHaveLength(1);
    expect(orderPanels[0].subheading).toBe("ORD-1 · My Order");
    expect(orderPanels[0].fields).toEqual([
      { label: "Platform", value: "Illumina" },
      { label: "Instrument", value: "NovaSeq" },
    ]);
  });

  it("reports perStudy=true when dynamic-studies is on and the study has its own form", async () => {
    mocks.isStudyModuleEnabled.mockReturnValue(true);
    mocks.db.studyFormConfig.findUnique.mockResolvedValueOnce({ id: "cfg-1" });
    const res = await GET(req(), { params });
    const body = await res.json();
    expect(body.perStudy).toBe(true);
    expect(mocks.loadStudyFormSchema).toHaveBeenCalledWith(
      expect.objectContaining({ studyId: "study-1" })
    );
  });
});

function patchReq(payload: unknown) {
  return new Request("http://localhost/api/studies/study-1/table", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("PATCH /api/studies/[id]/table", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "checklist:collection_date", value: "x" }),
      { params }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when sampleId or columnKey is missing", async () => {
    const res = await PATCH(patchReq({ value: "x" }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-admin editing someone else's study", async () => {
    mocks.getServerSession.mockResolvedValueOnce(researcherSession("other-user"));
    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "checklist:collection_date", value: "x" }),
      { params }
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when the sample is not in the study", async () => {
    mocks.db.sample.findFirst.mockResolvedValueOnce(null);
    const res = await PATCH(
      patchReq({ sampleId: "nope", columnKey: "checklist:collection_date", value: "x" }),
      { params }
    );
    expect(res.status).toBe(404);
  });

  it("merges an editable study field into checklistData", async () => {
    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "checklist:collection_date", value: "2025-05-05" }),
      { params }
    );
    expect(res.status).toBe(200);
    const arg = mocks.db.sample.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "s1" });
    expect(JSON.parse(arg.data.checklistData)).toEqual({
      keep: "x", // preserved
      collection_date: "2025-05-05",
    });
  });

  it("merges an editable order field into customFields", async () => {
    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "custom:sample_volume", value: "9" }),
      { params }
    );
    expect(res.status).toBe(200);
    const arg = mocks.db.sample.update.mock.calls[0][0];
    expect(JSON.parse(arg.data.customFields)).toEqual({ sample_volume: "9" });
  });

  it("rejects invalid values before updating a cell", async () => {
    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "custom:sample_volume", value: "abc" }),
      { params }
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter a valid number" });
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });

  it("normalizes select labels to stored option values", async () => {
    mocks.loadOrderFormSchema.mockResolvedValueOnce({
      fields: [],
      groups: [],
      version: 1,
      enabledMixsChecklists: [],
      perSampleFields: [
        {
          name: "sample_type",
          label: "Sample Type",
          type: "select",
          visible: true,
          options: [{ value: "soil", label: "Soil" }],
        },
      ],
    });

    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "custom:sample_type", value: "Soil" }),
      { params }
    );
    expect(res.status).toBe(200);
    const arg = mocks.db.sample.update.mock.calls[0][0];
    expect(JSON.parse(arg.data.customFields)).toEqual({
      sample_volume: "1",
      sample_type: "soil",
    });
  });

  it("updates a whitelisted core sample column", async () => {
    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "core:sampleTitle", value: "New title" }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { sampleTitle: "New title" },
    });
  });

  it("rejects a non-editable field type (organism)", async () => {
    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "checklist:scientific_name", value: "x" }),
      { params }
    );
    expect(res.status).toBe(400);
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });

  it("rejects a non-whitelisted core column", async () => {
    const res = await PATCH(
      patchReq({ sampleId: "s1", columnKey: "core:scientificName", value: "x" }),
      { params }
    );
    expect(res.status).toBe(400);
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });

  describe("added MIxS columns / authorization", () => {
    // A study whose stored metadata advertises extra MIxS columns the user added
    // from the "+ Add MIxS field" picker. The schema (perSampleFields) does NOT
    // list these, so `field` is undefined and the route falls to the isAddedMixs
    // branch, which re-checks them against the live checklist.
    function studyWithMixsColumns(columns: string[]) {
      return {
        id: "study-1",
        title: "Study One",
        alias: null,
        userId: "user-1",
        checklistType: "soil",
        mixsVersion: null,
        studyMetadata: JSON.stringify({
          study_abstract: "An abstract",
          _mixsColumns: columns,
        }),
      };
    }

    it("accepts a valid added-MIxS edit and writes the normalized value", async () => {
      mocks.db.study.findUnique.mockResolvedValueOnce(
        studyWithMixsColumns(["depth"])
      );
      mocks.getChecklistForStudy.mockResolvedValueOnce({
        fields: [{ name: "depth", label: "Depth", type: "number", visible: true }],
      });

      const res = await PATCH(
        patchReq({ sampleId: "s1", columnKey: "checklist:depth", value: "12" }),
        { params }
      );
      expect(res.status).toBe(200);
      const arg = mocks.db.sample.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: "s1" });
      const stored = JSON.parse(arg.data.checklistData);
      expect(stored.depth).toBe("12");
    });

    it("rejects an invalid value for an added-MIxS field", async () => {
      mocks.db.study.findUnique.mockResolvedValueOnce(
        studyWithMixsColumns(["depth"])
      );
      mocks.getChecklistForStudy.mockResolvedValueOnce({
        fields: [{ name: "depth", label: "Depth", type: "number", visible: true }],
      });

      const res = await PATCH(
        patchReq({ sampleId: "s1", columnKey: "checklist:depth", value: "abc" }),
        { params }
      );
      expect(res.status).toBe(400);
      expect(mocks.db.sample.update).not.toHaveBeenCalled();
    });

    it("normalizes an added-MIxS select label to its stored option value", async () => {
      mocks.db.study.findUnique.mockResolvedValueOnce(
        studyWithMixsColumns(["depth"])
      );
      mocks.getChecklistForStudy.mockResolvedValueOnce({
        fields: [
          {
            name: "depth",
            label: "Depth",
            type: "select",
            visible: true,
            options: [
              { value: "shallow", label: "Shallow" },
              { value: "deep", label: "Deep" },
            ],
          },
        ],
      });

      const res = await PATCH(
        patchReq({ sampleId: "s1", columnKey: "checklist:depth", value: "Deep" }),
        { params }
      );
      expect(res.status).toBe(200);
      const arg = mocks.db.sample.update.mock.calls[0][0];
      expect(JSON.parse(arg.data.checklistData).depth).toBe("deep");
    });

    it("rejects an added-MIxS column that is no longer a current checklist field", async () => {
      mocks.db.study.findUnique.mockResolvedValueOnce(
        studyWithMixsColumns(["ghost"])
      );
      // The live checklist no longer has "ghost".
      mocks.getChecklistForStudy.mockResolvedValueOnce({
        fields: [{ name: "depth", label: "Depth", type: "number", visible: true }],
      });

      const res = await PATCH(
        patchReq({ sampleId: "s1", columnKey: "checklist:ghost", value: "x" }),
        { params }
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Field is not editable" });
      expect(mocks.db.sample.update).not.toHaveBeenCalled();
    });

    it("clears a checklist key when the value is empty (deletes, not blanks)", async () => {
      // The sample already stores collection_date; an empty PATCH should remove it
      // while keeping the rest of the blob intact.
      const res = await PATCH(
        patchReq({ sampleId: "s1", columnKey: "checklist:collection_date", value: "" }),
        { params }
      );
      expect(res.status).toBe(200);
      const arg = mocks.db.sample.update.mock.calls[0][0];
      const stored = JSON.parse(arg.data.checklistData);
      expect(stored).not.toHaveProperty("collection_date");
      expect(stored).toEqual({ keep: "x" });
    });

    it("lets a non-admin owner edit an editable field", async () => {
      mocks.getServerSession.mockResolvedValueOnce(researcherSession("user-1"));
      // study.userId is "user-1" (the owner) in the default findUnique mock.
      const res = await PATCH(
        patchReq({ sampleId: "s1", columnKey: "checklist:collection_date", value: "2025-06-06" }),
        { params }
      );
      expect(res.status).toBe(200);
      const arg = mocks.db.sample.update.mock.calls[0][0];
      expect(JSON.parse(arg.data.checklistData)).toEqual({
        keep: "x",
        collection_date: "2025-06-06",
      });
    });

    it("rejects a non-admin owner editing an admin-only (role-filtered) field", async () => {
      mocks.getServerSession.mockResolvedValueOnce(researcherSession("user-1"));
      // Simulate role filtering: the field only appears when isFacilityAdmin is true.
      // For a non-admin the schema omits it, and it is not an added MIxS column, so
      // the request falls through to the final "Field is not editable".
      mocks.loadStudyFormSchema.mockImplementationOnce(async (args) => ({
        fields: [],
        studyFields: [],
        perSampleFields: args?.isFacilityAdmin
          ? [
              {
                name: "facility_only_field",
                label: "Facility Only",
                type: "text",
                visible: true,
              },
            ]
          : [],
        groups: [],
        modules: { mixs: false, sampleAssociation: false, funding: false },
      }));

      const res = await PATCH(
        patchReq({ sampleId: "s1", columnKey: "checklist:facility_only_field", value: "x" }),
        { params }
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Field is not editable" });
      expect(mocks.db.sample.update).not.toHaveBeenCalled();
    });
  });
});
