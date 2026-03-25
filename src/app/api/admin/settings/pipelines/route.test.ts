import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineConfig: {
      findMany: vi.fn(),
    },
  },
  getAllPipelineIds: vi.fn(),
  getExecutionSettings: vi.fn(),
  getPackageManifest: vi.fn(),
  getPipelineDownloadStatus: vi.fn(),
  getPipelineDatabaseStatuses: vi.fn(),
  pipelineRegistry: {
    fastqc: {
      name: "FastQC",
      description: "QC",
      category: "qc",
      version: "0.1.0",
      icon: "CheckCircle",
      defaultConfig: {},
      configSchema: {
        type: "object",
        properties: {},
      },
      input: {
        supportedScopes: ["order"],
        perSample: {
          reads: true,
          pairedEnd: false,
        },
      },
      visibility: {
        showToUser: false,
        userCanStart: false,
      },
      requires: {
        reads: true,
        assemblies: false,
        bins: false,
        checksums: false,
        studyAccession: false,
        sampleMetadata: false,
      },
      outputs: [],
      sampleResult: null,
    },
    mag: {
      name: "MAG",
      description: "Assembly",
      category: "analysis",
      version: "3.0.0",
      icon: "Dna",
      defaultConfig: {},
      configSchema: {
        type: "object",
        properties: {},
      },
      input: {
        supportedScopes: ["study"],
        perSample: {
          reads: true,
          pairedEnd: true,
        },
      },
      visibility: {
        showToUser: false,
        userCanStart: false,
      },
      requires: {
        reads: true,
        assemblies: false,
        bins: false,
        checksums: false,
        studyAccession: false,
        sampleMetadata: false,
      },
      outputs: [],
      sampleResult: null,
    },
  },
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

vi.mock("@/lib/pipelines", () => ({
  PIPELINE_REGISTRY: mocks.pipelineRegistry,
  getAllPipelineIds: mocks.getAllPipelineIds,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackageManifest: mocks.getPackageManifest,
}));

vi.mock("@/lib/pipelines/nextflow-downloads", () => ({
  getPipelineDownloadStatus: mocks.getPipelineDownloadStatus,
}));

vi.mock("@/lib/pipelines/database-downloads", () => ({
  getPipelineDatabaseStatuses: mocks.getPipelineDatabaseStatuses,
}));

import { GET } from "./route";

describe("GET /api/admin/settings/pipelines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.getAllPipelineIds.mockReturnValue(["fastqc", "mag"]);
    mocks.db.pipelineConfig.findMany.mockResolvedValue([]);
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "/tmp/seqdesk-runs",
    });
    mocks.getPipelineDatabaseStatuses.mockResolvedValue([]);
    mocks.getPipelineDownloadStatus.mockResolvedValue({
      status: "downloaded",
      detail: "ok",
    });
    mocks.getPackageManifest.mockImplementation((pipelineId: string) => {
      if (pipelineId === "fastqc") {
        return {
          execution: {
            pipeline: "./workflow",
            version: "0.1.0",
          },
          targets: {
            supported: ["order"],
          },
          inputs: [
            {
              id: "reads",
              scope: "sample",
              source: "sample.reads",
              required: true,
            },
          ],
          outputs: [
            {
              id: "sample_fastqc_reads",
              scope: "sample",
              destination: "sample_reads",
              writeback: {
                target: "Read",
                mode: "merge",
                fields: {
                  fastqcReport1: "fastqcReport1",
                  avgQuality1: "avgQuality1",
                },
              },
            },
          ],
        };
      }

      return {
        execution: {
          pipeline: "nf-core/mag",
          version: "3.0.0",
        },
        targets: {
          supported: ["study"],
        },
        inputs: [
          {
            id: "reads",
            scope: "sample",
            source: "sample.reads",
            required: true,
          },
        ],
        outputs: [],
      };
    });
  });

  it("rejects invalid catalog filters", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines?catalog=bad")
    );

    expect(response.status).toBe(400);
  });

  it("filters to the order catalog and includes manifest-derived capabilities", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines?enabled=true&catalog=order")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines).toEqual([
      expect.objectContaining({
        pipelineId: "fastqc",
        targets: { supported: ["order"] },
        catalogs: ["order"],
        capabilities: {
          requiresLinkedReads: true,
          writesCanonicalReadMetadata: true,
          writesCanonicalReadFiles: false,
        },
      }),
    ]);
  });
});
