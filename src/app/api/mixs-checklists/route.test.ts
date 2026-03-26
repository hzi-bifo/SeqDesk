import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: mocks.existsSync,
  readdirSync: mocks.readdirSync,
  readFileSync: mocks.readFileSync,
}));

// Reset the module-level cache between tests by re-importing each time
// We need to reset module state between tests
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function importGET() {
  const mod = await import("./route");
  return mod.GET;
}

const sampleChecklist = {
  name: "Soil",
  description: "Soil checklist",
  version: "6.0",
  source: "GSC",
  category: "environment",
  accession: "ERC000022",
  fields: [
    { type: "text", label: "Sample Name", name: "sample_name", required: true, visible: true },
    { type: "text", label: "Depth", name: "depth", required: false, visible: true },
  ],
};

const sampleIndex = {
  checklists: [
    { name: "Soil", file: "mixs-soil.json", fieldCount: 2, mandatoryCount: 1, accession: "ERC000022" },
  ],
};

function setupFsMocks() {
  mocks.existsSync.mockReturnValue(true);
  mocks.readdirSync.mockReturnValue(["mixs-soil.json"]);
  mocks.readFileSync.mockImplementation((filePath: string) => {
    if (String(filePath).endsWith("_index.json")) {
      return JSON.stringify(sampleIndex);
    }
    return JSON.stringify(sampleChecklist);
  });
}

describe("GET /api/mixs-checklists", () => {
  it("returns checklist index when no params given", async () => {
    setupFsMocks();
    const GET = await importGET();

    const request = new NextRequest("http://localhost:3000/api/mixs-checklists");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checklists).toBeDefined();
    expect(body.total).toBeGreaterThanOrEqual(0);
  });

  it("returns specific checklist by accession", async () => {
    setupFsMocks();
    const GET = await importGET();

    const request = new NextRequest("http://localhost:3000/api/mixs-checklists?accession=ERC000022");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Soil");
    expect(body.accession).toBe("ERC000022");
  });

  it("returns 404 for unknown accession", async () => {
    setupFsMocks();
    const GET = await importGET();

    const request = new NextRequest("http://localhost:3000/api/mixs-checklists?accession=NONEXISTENT");
    const response = await GET(request);

    expect(response.status).toBe(404);
  });

  it("returns checklist by name search", async () => {
    setupFsMocks();
    const GET = await importGET();

    const request = new NextRequest("http://localhost:3000/api/mixs-checklists?name=soil");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Soil");
  });

  it("returns 404 for name not found", async () => {
    setupFsMocks();
    const GET = await importGET();

    const request = new NextRequest("http://localhost:3000/api/mixs-checklists?name=nonexistent");
    const response = await GET(request);

    expect(response.status).toBe(404);
  });

  it("returns empty list when templates directory does not exist", async () => {
    mocks.existsSync.mockReturnValue(false);
    const GET = await importGET();

    const request = new NextRequest("http://localhost:3000/api/mixs-checklists");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checklists).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
