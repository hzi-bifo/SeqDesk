import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getWorkbenchAnalysisForUser: vi.fn(),
  createWorkbenchImportJob: vi.fn(),
  runWorkbenchImportJob: vi.fn(),
  getWorkbenchImporter: vi.fn(),
  resolveWorkbenchStorageBase: vi.fn(),
  provider: {
    id: "ncbi-genomes-taxon",
    inputSchema: { parse: vi.fn((value) => value) },
    preflight: vi.fn(),
    preview: vi.fn(),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workbench/analyses", () => ({
  getWorkbenchAnalysisForUser: mocks.getWorkbenchAnalysisForUser,
}));

vi.mock("@/lib/workbench/import-jobs", () => ({
  createWorkbenchImportJob: mocks.createWorkbenchImportJob,
  runWorkbenchImportJob: mocks.runWorkbenchImportJob,
}));

vi.mock("@/lib/workbench/importers/registry", () => ({
  getWorkbenchImporter: mocks.getWorkbenchImporter,
}));

vi.mock("@/lib/workbench/storage", () => ({
  resolveWorkbenchStorageBase: mocks.resolveWorkbenchStorageBase,
}));

import { POST } from "./route";

const params = {
  params: Promise.resolve({ analysisId: "analysis-1", nodeId: "source-1" }),
};

describe("POST /api/workbench/analyses/[analysisId]/nodes/[nodeId]/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getWorkbenchImporter.mockReturnValue(mocks.provider);
    mocks.provider.preflight.mockResolvedValue({ ok: true });
    mocks.provider.preview.mockResolvedValue({
      providerId: "ncbi-genomes-taxon",
      summary: { selectedCount: 1 },
      genomes: [{ accession: "GCF_1" }],
    });
    mocks.resolveWorkbenchStorageBase.mockResolvedValue({ baseDir: "/data/workbench" });
    mocks.createWorkbenchImportJob.mockResolvedValue({ job: { id: "job-1", status: "queued" } });
    mocks.getWorkbenchAnalysisForUser.mockResolvedValue({
      id: "analysis-1",
      canvas: {
        version: 1,
        nodes: [
          {
            id: "source-1",
            data: {
              kind: "source.importer",
              providerId: "ncbi-genomes-taxon",
              config: { taxon: "Escherichia coli" },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  it("starts a real importer job for a source node", async () => {
    const response = await POST(new Request("http://localhost"), params);

    expect(response.status).toBe(202);
    expect(mocks.createWorkbenchImportJob).toHaveBeenCalledWith({
      userId: "user-1",
      providerId: "ncbi-genomes-taxon",
      input: { taxon: "Escherichia coli" },
      preview: {
        providerId: "ncbi-genomes-taxon",
        summary: { selectedCount: 1 },
        genomes: [{ accession: "GCF_1" }],
      },
      analysisId: "analysis-1",
      analysisNodeId: "source-1",
    });
    expect(mocks.runWorkbenchImportJob).toHaveBeenCalledWith("job-1");
  });

  it("rejects non-source nodes", async () => {
    mocks.getWorkbenchAnalysisForUser.mockResolvedValue({
      id: "analysis-1",
      canvas: {
        version: 1,
        nodes: [{ id: "source-1", data: { kind: "note", label: "Note" } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });

    const response = await POST(new Request("http://localhost"), params);

    expect(response.status).toBe(400);
    expect(mocks.createWorkbenchImportJob).not.toHaveBeenCalled();
  });
});
