import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getActiveMixsConfig: vi.fn(),
  getChecklistForStudy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/mixs/config", () => ({
  getActiveMixsConfig: mocks.getActiveMixsConfig,
  getChecklistForStudy: mocks.getChecklistForStudy,
}));

import { GET } from "./route";

const sampleChecklist = {
  name: "GSC MIxS soil",
  description: "Soil checklist",
  version: "6.0",
  source: "GSC",
  category: "mixs",
  accession: "ERC000022",
  fields: [
    { type: "text", label: "Sample Name", name: "sample_name", required: true, visible: true },
    { type: "text", label: "Depth", name: "depth", required: false, visible: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveMixsConfig.mockResolvedValue({
    version: 6,
    checklists: [sampleChecklist],
    deprecated: [],
  });
  mocks.getChecklistForStudy.mockResolvedValue(undefined);
});

describe("GET /api/mixs-checklists", () => {
  it("returns checklist index with version when no params given", async () => {
    const request = new NextRequest("http://localhost:3000/api/mixs-checklists");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checklists).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.version).toBe(6);
    expect(body.checklists[0]).toMatchObject({
      name: "GSC MIxS soil",
      accession: "ERC000022",
      fieldCount: 2,
      mandatoryCount: 1,
    });
  });

  it("excludes unavailable checklists from the index", async () => {
    mocks.getActiveMixsConfig.mockResolvedValue({
      version: 6,
      checklists: [sampleChecklist, { ...sampleChecklist, name: "Hidden", available: false }],
      deprecated: [],
    });
    const request = new NextRequest("http://localhost:3000/api/mixs-checklists");
    const response = await GET(request);
    const body = await response.json();
    expect(body.total).toBe(1);
  });

  it("returns specific checklist by accession", async () => {
    mocks.getChecklistForStudy.mockResolvedValue(sampleChecklist);
    const request = new NextRequest("http://localhost:3000/api/mixs-checklists?accession=ERC000022");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("GSC MIxS soil");
    expect(body.accession).toBe("ERC000022");
    expect(mocks.getChecklistForStudy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accession: "ERC000022" })
    );
  });

  it("passes the version param through for pinned resolution", async () => {
    mocks.getChecklistForStudy.mockResolvedValue(sampleChecklist);
    const request = new NextRequest(
      "http://localhost:3000/api/mixs-checklists?accession=ERC000022&version=5"
    );
    await GET(request);
    expect(mocks.getChecklistForStudy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: 5 })
    );
  });

  it("returns 404 for unknown accession", async () => {
    mocks.getChecklistForStudy.mockResolvedValue(undefined);
    const request = new NextRequest("http://localhost:3000/api/mixs-checklists?accession=NONEXISTENT");
    const response = await GET(request);
    expect(response.status).toBe(404);
  });

  it("returns checklist by name search", async () => {
    mocks.getChecklistForStudy.mockResolvedValue(sampleChecklist);
    const request = new NextRequest("http://localhost:3000/api/mixs-checklists?name=soil");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("GSC MIxS soil");
  });

  it("returns 404 for name not found", async () => {
    mocks.getChecklistForStudy.mockResolvedValue(undefined);
    const request = new NextRequest("http://localhost:3000/api/mixs-checklists?name=nonexistent");
    const response = await GET(request);
    expect(response.status).toBe(404);
  });
});
