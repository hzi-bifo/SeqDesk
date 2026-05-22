import { beforeEach, describe, expect, it, vi } from "vitest";
import { stringifyWorkbenchCanvas } from "./canvas";

const now = new Date("2026-05-21T10:00:00.000Z");

const mocks = vi.hoisted(() => ({
  getOrCreateDefaultWorkbenchWorkspace: vi.fn(),
  db: {
    workbenchAnalysis: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/workbench/workspaces", () => ({
  getOrCreateDefaultWorkbenchWorkspace: mocks.getOrCreateDefaultWorkbenchWorkspace,
}));

import {
  getOrCreateDefaultWorkbenchAnalysis,
  updateWorkbenchAnalysis,
  updateWorkbenchAnalysisNodeForImportJob,
} from "./analyses";

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    id: "analysis-1",
    workspaceId: "workspace-1",
    name: "Untitled analysis",
    description: null,
    canvas: stringifyWorkbenchCanvas({
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    revision: 1,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("workbench analyses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrCreateDefaultWorkbenchWorkspace.mockResolvedValue({ id: "workspace-1" });
  });

  it("lazily creates one default analysis per workspace", async () => {
    mocks.db.workbenchAnalysis.findFirst.mockResolvedValue(null);
    mocks.db.workbenchAnalysis.create.mockResolvedValue(analysis());

    const result = await getOrCreateDefaultWorkbenchAnalysis("user-1");

    expect(mocks.db.workbenchAnalysis.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace-1",
        name: "Untitled analysis",
        isDefault: true,
      }),
    });
    expect(result.canvas.nodes).toEqual([]);
  });

  it("returns a conflict when autosave revision is stale", async () => {
    mocks.db.workbenchAnalysis.findFirst
      .mockResolvedValueOnce(analysis({ revision: 2 }))
      .mockResolvedValueOnce(analysis({ revision: 2 }));
    mocks.db.workbenchAnalysis.updateMany.mockResolvedValue({ count: 0 });

    const result = await updateWorkbenchAnalysis({
      userId: "user-1",
      analysisId: "analysis-1",
      revision: 1,
      name: "Changed",
    });

    expect(result.conflict).toBe(true);
    expect(result.analysis?.revision).toBe(2);
  });

  it("updates source node status and adds a dataset node on import success", async () => {
    mocks.db.workbenchAnalysis.findUnique.mockResolvedValue(
      analysis({
        canvas: stringifyWorkbenchCanvas({
          version: 1,
          nodes: [
            {
              id: "source-1",
              type: "workbench",
              position: { x: 100, y: 120 },
              data: {
                kind: "source.importer",
                label: "Reference genomes",
                providerId: "ncbi-genomes-taxon",
              },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
      })
    );
    mocks.db.workbenchAnalysis.update.mockResolvedValue({});

    await updateWorkbenchAnalysisNodeForImportJob({
      analysisId: "analysis-1",
      analysisNodeId: "source-1",
      jobId: "job-1",
      status: "success",
      phase: "complete",
      progress: 100,
      resultDataset: {
        id: "dataset-1",
        name: "NCBI genomes: Escherichia coli",
        description: "1 genome",
      },
    });

    const updatedCanvas = JSON.parse(mocks.db.workbenchAnalysis.update.mock.calls[0][0].data.canvas);
    expect(updatedCanvas.nodes.map((node: { id: string }) => node.id)).toContain("dataset-dataset-1");
    expect(updatedCanvas.edges[0]).toMatchObject({
      source: "source-1",
      target: "dataset-dataset-1",
    });
  });
});
