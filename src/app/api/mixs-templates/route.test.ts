import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getActiveMixsConfig: vi.fn(),
  getChecklistForStudy: vi.fn(),
  loadLegacyMixsTemplates: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/mixs/config", () => ({
  getActiveMixsConfig: mocks.getActiveMixsConfig,
  getChecklistForStudy: mocks.getChecklistForStudy,
  loadLegacyMixsTemplates: mocks.loadLegacyMixsTemplates,
}));

import { GET } from "./route";

const soil = {
  name: "GSC MIxS soil",
  description: "Soil",
  version: "6",
  source: "GSC",
  category: "mixs",
  accession: "ERC000022",
  fields: [{ type: "text", label: "Depth", name: "depth", required: true, visible: true }],
};

const legacyCore = {
  name: "MIxS Core",
  description: "Core",
  version: "1",
  source: "local",
  category: "mixs",
  accession: "",
  fields: [],
};

describe("GET /api/mixs-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "u1", role: "RESEARCHER" } });
    mocks.getActiveMixsConfig.mockResolvedValue({ version: 6, checklists: [soil], deprecated: [] });
    mocks.getChecklistForStudy.mockResolvedValue(undefined);
    mocks.loadLegacyMixsTemplates.mockReturnValue([legacyCore]);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const request = new NextRequest("http://localhost:3000/api/mixs-templates");
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("returns registry templates merged with legacy flat templates", async () => {
    const request = new NextRequest("http://localhost:3000/api/mixs-templates");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    const names = data.templates.map((t: { name: string }) => t.name);
    expect(names).toContain("GSC MIxS soil");
    expect(names).toContain("MIxS Core");
  });

  it("resolves a specific template by name via the version-aware resolver", async () => {
    mocks.getChecklistForStudy.mockResolvedValue(soil);
    const request = new NextRequest(
      "http://localhost:3000/api/mixs-templates?name=GSC%20MIxS%20soil"
    );
    const response = await GET(request);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.name).toBe("GSC MIxS soil");
  });

  it("falls back to fuzzy matching across registry + legacy templates", async () => {
    // resolver miss -> fuzzy. "MIxS Soil" should fuzzy-match "GSC MIxS soil".
    const request = new NextRequest(
      "http://localhost:3000/api/mixs-templates?name=MIxS%20Soil"
    );
    const response = await GET(request);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.name).toBe("GSC MIxS soil");
  });

  it("returns 404 when filtering by name with no match", async () => {
    mocks.loadLegacyMixsTemplates.mockReturnValue([]);
    const request = new NextRequest(
      "http://localhost:3000/api/mixs-templates?name=NonExistent"
    );
    const response = await GET(request);
    expect(response.status).toBe(404);
  });

  it("returns 500 when loading the active config throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getActiveMixsConfig.mockRejectedValue(new Error("db down"));
    const request = new NextRequest("http://localhost:3000/api/mixs-templates");
    const response = await GET(request);
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch templates");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
