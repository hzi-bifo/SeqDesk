import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  loadStudyFormSchema: vi.fn(),
  loadOrderFormSchema: vi.fn(),
  parseStudyModulesConfig: vi.fn(),
  isStudyModuleEnabled: vi.fn(),
  db: {
    study: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
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

import { GET } from "./route";

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
      order: { orderNumber: "ORD-1", name: "My Order" },
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
      order: { orderNumber: "ORD-2", name: null },
    },
  ]);
  mocks.db.siteSettings.findUnique.mockResolvedValue({ modulesConfig: null });
  mocks.db.studyFormConfig.findUnique.mockResolvedValue(null);
  mocks.parseStudyModulesConfig.mockReturnValue({});
  mocks.isStudyModuleEnabled.mockReturnValue(false);
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
      ["Collection Date", "study"], // study form per-sample field (checklistData)
      ["Legacy Field", "order"], // stray customFields key, surfaced anyway
    ]);
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

  it("exposes study-level fields as a summary and reports perStudy=false by default", async () => {
    const res = await GET(req(), { params });
    const body = await res.json();
    expect(body.perStudy).toBe(false);
    expect(body.studySummary).toEqual([
      { label: "Study Abstract", value: "An abstract" },
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
