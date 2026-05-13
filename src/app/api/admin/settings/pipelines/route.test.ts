import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineConfig: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  getAllPipelineIds: vi.fn(),
  getExecutionSettings: vi.fn(),
  getPackage: vi.fn(),
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
    metaxpath: {
      name: "MetaXpath",
      description: "ONT metagenomics",
      category: "analysis",
      version: "1.0.0",
      icon: "Dna",
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
  DEFAULT_EXECUTION_SETTINGS: {
    useSlurm: false,
    slurmQueue: "cpu",
    slurmCores: 4,
    slurmMemory: "64GB",
    slurmTimeLimit: 12,
    slurmOptions: "",
    pipelineOverrides: {},
    runtimeMode: "conda",
    condaPath: "",
    condaEnv: "seqdesk-pipelines",
    nextflowProfile: "",
    pipelineRunDir: "/data/pipeline_runs",
    pipelineDatabaseDir: "",
    weblogUrl: "",
    weblogSecret: "",
  },
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackage: mocks.getPackage,
  getPackageManifest: mocks.getPackageManifest,
}));

vi.mock("@/lib/pipelines/nextflow-downloads", () => ({
  getPipelineDownloadStatus: mocks.getPipelineDownloadStatus,
}));

vi.mock("@/lib/pipelines/database-downloads", () => ({
  getPipelineDatabaseStatuses: mocks.getPipelineDatabaseStatuses,
}));

import { GET, POST } from "./route";

describe("GET /api/admin/settings/pipelines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.getAllPipelineIds.mockReturnValue(["fastqc", "mag"]);
    mocks.db.pipelineConfig.findMany.mockResolvedValue([]);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "/tmp/seqdesk-runs",
    });
    mocks.getPipelineDatabaseStatuses.mockResolvedValue([]);
    mocks.getPipelineDownloadStatus.mockResolvedValue({
      status: "downloaded",
      detail: "ok",
    });
    mocks.getPackage.mockImplementation((pipelineId: string) => ({
      id: pipelineId,
      basePath: `/tmp/packages/${pipelineId}`,
    }));
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

      if (pipelineId === "metaxpath") {
        return {
          execution: {
            pipeline: `${process.cwd()}/package.json`,
            version: "1.0.0",
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
              id: "metaxpath_summary",
              scope: "run",
              destination: "pipeline_run",
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

  it("returns 403 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );

    expect(response.status).toBe(403);
  });

  it("returns all pipelines when enabledOnly is false", async () => {
    mocks.db.pipelineConfig.findMany.mockResolvedValue([
      { pipelineId: "fastqc", enabled: false, config: null },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines?enabled=false")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    // Should include both fastqc and mag even though fastqc is disabled
    expect(payload.pipelines).toHaveLength(2);
    expect(payload.pipelines[0].readiness).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        summary: expect.any(String),
        items: expect.arrayContaining([
          expect.objectContaining({ id: "package", label: "Pipeline package" }),
          expect.objectContaining({ id: "outputs", label: "Output browsing" }),
          expect.objectContaining({ id: "enabled", label: "Enabled for users" }),
        ]),
      })
    );
  });

  it("filters to the study catalog", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines?catalog=study")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    // Only MAG has study target
    expect(payload.pipelines).toEqual([
      expect.objectContaining({ pipelineId: "mag" }),
    ]);
  });

  it("includes resolved execution policy for pipeline overrides", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: "/tmp/seqdesk-runs",
      useSlurm: false,
      slurmQueue: "cpu",
      slurmCores: 4,
      slurmMemory: "64GB",
      slurmTimeLimit: 12,
      slurmOptions: "",
      nextflowProfile: "",
      pipelineOverrides: {
        mag: {
          mode: "slurm",
          slurm: {
            queue: "bigmem",
            cores: 24,
          },
        },
      },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines?catalog=study")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines[0]).toEqual(
      expect.objectContaining({
        pipelineId: "mag",
        executionPolicy: expect.objectContaining({
          mode: "slurm",
          source: "pipeline",
          slurm: expect.objectContaining({
            queue: "bigmem",
            cores: 24,
          }),
        }),
      })
    );
  });

  it("returns empty pipelines when getAllPipelineIds returns empty array", async () => {
    mocks.getAllPipelineIds.mockReturnValue([]);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines).toEqual([]);
  });

  it("returns 500 when an internal error occurs in GET", async () => {
    mocks.db.pipelineConfig.findMany.mockRejectedValue(new Error("DB error"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toBe("Failed to fetch pipeline configurations");
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

  it("uses an install-profile pipeline allowlist for pipelines without explicit config rows", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        installProfilePipelineAllowlist: ["fastqc"],
      }),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines?enabled=true")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines.map((pipeline: { pipelineId: string }) => pipeline.pipelineId))
      .toEqual(["fastqc"]);
  });

  it("reports missing and ready database assets in pipeline readiness", async () => {
    mocks.getAllPipelineIds.mockReturnValue(["mag"]);
    mocks.getPipelineDatabaseStatuses.mockResolvedValueOnce([
      {
        id: "gtdb",
        label: "GTDB-Tk Database",
        status: "missing",
        configKey: "gtdbDb",
      },
    ]);

    const missingResponse = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const missingPayload = await missingResponse.json();

    expect(missingPayload.pipelines[0].readiness).toEqual(
      expect.objectContaining({
        status: "missing",
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "databases",
            status: "missing",
            action: "download-db",
          }),
        ]),
      })
    );

    mocks.getPipelineDatabaseStatuses.mockResolvedValueOnce([
      {
        id: "gtdb",
        label: "GTDB-Tk Database",
        status: "downloaded",
        configKey: "gtdbDb",
        path: "/shared/dbs/mag/gtdb/gtdbtk_r214_data.tar.gz",
      },
    ]);

    const readyResponse = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const readyPayload = await readyResponse.json();

    expect(readyPayload.pipelines[0].readiness.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "databases",
          status: "ready",
        }),
      ])
    );
  });

  it("reports MetaXpath missing before DB install and ready after params file exists", async () => {
    mocks.getAllPipelineIds.mockReturnValue(["metaxpath"]);
    mocks.getPipelineDatabaseStatuses.mockResolvedValueOnce([
      {
        id: "db-bundle",
        label: "MetaxPath Database Bundle",
        status: "missing",
        configKey: "paramsFile",
      },
    ]);

    const missingResponse = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const missingPayload = await missingResponse.json();

    expect(missingPayload.pipelines[0].readiness).toEqual(
      expect.objectContaining({
        status: "missing",
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "databases",
            status: "missing",
            action: "download-db",
          }),
          expect.objectContaining({
            id: "params-file",
            status: "missing",
            action: "download-db",
          }),
        ]),
      })
    );

    mocks.db.pipelineConfig.findMany.mockResolvedValue([
      {
        pipelineId: "metaxpath",
        enabled: true,
        config: JSON.stringify({ paramsFile: `${process.cwd()}/package.json` }),
      },
    ]);
    mocks.getPipelineDatabaseStatuses.mockResolvedValueOnce([
      {
        id: "db-bundle",
        label: "MetaxPath Database Bundle",
        status: "downloaded",
        configKey: "paramsFile",
        path: `${process.cwd()}/package.json`,
      },
    ]);

    const readyResponse = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const readyPayload = await readyResponse.json();

    expect(readyPayload.pipelines[0].readiness).toEqual(
      expect.objectContaining({
        status: "ready",
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "databases",
            status: "ready",
          }),
          expect.objectContaining({
            id: "params-file",
            status: "ready",
          }),
        ]),
      })
    );
  });
});

describe("POST /api/admin/settings/pipelines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
  });

  it("returns 403 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipelineId: "fastqc", enabled: true }),
      })
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 when pipelineId is null", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipelineId: null, enabled: true }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("Invalid pipeline ID");
  });

  it("returns 400 when pipelineId is not in registry", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipelineId: "nonexistent", enabled: true }),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("Invalid pipeline ID");
  });

  it("saves config successfully", async () => {
    mocks.db.pipelineConfig.upsert.mockResolvedValue({
      pipelineId: "fastqc",
      enabled: false,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "fastqc",
          enabled: false,
          config: { someParam: "value" },
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.pipelineId).toBe("fastqc");
    expect(payload.enabled).toBe(false);
    expect(mocks.db.pipelineConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: "fastqc" },
        create: expect.objectContaining({
          pipelineId: "fastqc",
          enabled: false,
          config: JSON.stringify({ someParam: "value" }),
        }),
      }),
    );
  });

  it("returns 500 when upsert fails", async () => {
    mocks.db.pipelineConfig.upsert.mockRejectedValue(new Error("DB error"));

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipelineId: "fastqc", enabled: true }),
      })
    );

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toBe("Failed to update pipeline configuration");
  });
});
