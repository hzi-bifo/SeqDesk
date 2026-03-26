import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
    },
  },
  isDemoSession: vi.fn(),
  getAvailableAssemblies: vi.fn(),
  resolveAssemblySelection: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/pipelines/assembly-selection", () => ({
  getAvailableAssemblies: mocks.getAvailableAssemblies,
  resolveAssemblySelection: mocks.resolveAssemblySelection,
}));

import { GET } from "./route";

describe("GET /api/assemblies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoSession.mockReturnValue(false);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 for demo sessions", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.isDemoSession.mockReturnValue(true);

    const response = await GET();

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("demo");
  });

  it("returns 403 when user is not admin and downloads are disabled", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({ allowUserAssemblyDownload: false }),
    });

    const response = await GET();

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("disabled");
  });

  it("returns assemblies for facility admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const sampleData = {
      id: "sample-1",
      sampleId: "S001",
      preferredAssemblyId: null,
      study: { id: "study-1", title: "My Study", alias: "ms" },
      order: { id: "order-1", orderNumber: 1, name: "Order 1", status: "COMPLETED" },
      assemblies: [
        {
          id: "asm-1",
          assemblyName: "assembly1",
          assemblyFile: "/data/assembly1.fasta",
          createdByPipelineRunId: "run-1",
          createdByPipelineRun: {
            id: "run-1",
            runNumber: 1,
            status: "COMPLETED",
            createdAt: new Date("2024-01-01"),
            completedAt: new Date("2024-01-02"),
          },
        },
      ],
    };

    mocks.db.sample.findMany.mockResolvedValue([sampleData]);
    mocks.getAvailableAssemblies.mockReturnValue(sampleData.assemblies);
    mocks.resolveAssemblySelection.mockReturnValue({
      assembly: sampleData.assemblies[0],
      source: "auto",
      preferredMissing: false,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assemblies).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.assemblies[0].sample.sampleId).toBe("S001");
    expect(body.assemblies[0].finalAssembly.fileName).toBe("assembly1.fasta");
  });

  it("returns assemblies for researcher when downloads are enabled", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({ allowUserAssemblyDownload: true }),
    });
    mocks.db.sample.findMany.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assemblies).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
