import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs, { constants as fsConstants } from "node:fs";
import fsPromises from "fs/promises";
import os from "node:os";
import path from "node:path";
import type { PipelineConfigSchema } from "@/lib/pipelines/types";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineConfig: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
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
  getResolvedDataBasePath: vi.fn(),
  checkPipelineRuntimePrerequisites: vi.fn(),
  getPipelineRunConfigIssues: vi.fn(),
  pipelineRegistry: {
    fastqc: {
      name: "FastQC",
      description: "QC",
      category: "qc",
      version: "0.1.0",
      icon: "CheckCircle",
      defaultConfig: {
        requiredToken: "default-token",
      },
      configSchema: {
        type: "object",
        required: ["requiredToken"],
        properties: {
          requiredToken: {
            type: "string",
            title: "Required token",
          },
        },
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

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
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

vi.mock("@/lib/pipelines/prerequisite-check", () => ({
  checkPipelineRuntimePrerequisites: mocks.checkPipelineRuntimePrerequisites,
}));

vi.mock("@/lib/pipelines/simulate-reads-config", () => ({
  SIMULATE_READS_PIPELINE_ID: "simulate-reads",
  READ_CLEANING_PIPELINE_ID: "read-cleaning",
  normalizePipelineRunConfig: (
    _pipelineId: string,
    config: Record<string, unknown>
  ) => config,
  getPipelineRunConfigIssues: mocks.getPipelineRunConfigIssues,
}));

import { GET, POST } from "./route";
import { updateManagedPipeline } from "@/lib/pipelines/pipeline-management-service";

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
      useSlurm: false,
      pipelineOverrides: {},
      pipelineRunDir: process.cwd(),
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: process.cwd(),
      source: "database",
      isImplicit: false,
    });
    mocks.checkPipelineRuntimePrerequisites.mockImplementation(
      async (settings: { useSlurm?: boolean }) => [
        {
          id: "nextflow",
          name: "Nextflow",
          description: "Workflow engine",
          status: "pass",
          message: "Installed",
          required: true,
        },
        {
          id: "java",
          name: "Java Runtime",
          description: "Java",
          status: "pass",
          message: "Installed",
          required: true,
        },
        {
          id: settings.useSlurm ? "slurm" : "conda",
          name: settings.useSlurm ? "SLURM" : "Conda/Mamba",
          description: "Execution runtime",
          status: "pass",
          message: "Available",
          required: true,
        },
      ]
    );
    mocks.getPipelineRunConfigIssues.mockReturnValue([]);
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
          package: {
            id: "metaxpath",
            name: "MetaXpath",
            version: "0.1.5",
            description: "ONT metagenomics",
          },
          execution: {
            pipeline: `${process.cwd()}/package.json`,
            version: "1.0.0",
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
        canEnable: expect.any(Boolean),
        items: expect.arrayContaining([
          expect.objectContaining({ id: "package", label: "Pipeline package" }),
          expect.objectContaining({
            id: "required-config",
            label: "Required configuration",
          }),
          expect.objectContaining({
            id: "runtime-nextflow",
            href: "/admin/pipeline-runtime#required-runtime",
          }),
          expect.objectContaining({
            id: "data-storage-path",
            href: "/admin/data-storage#required-data-storage",
          }),
          expect.objectContaining({ id: "outputs", label: "Output browsing" }),
          expect.objectContaining({ id: "enabled", label: "Enabled for users" }),
        ]),
      })
    );
    expect(mocks.checkPipelineRuntimePrerequisites).toHaveBeenCalledTimes(1);
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
      pipelineRunDir: process.cwd(),
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
        readiness: expect.objectContaining({
          canEnable: true,
          items: expect.arrayContaining([
            expect.objectContaining({
              id: "runtime-slurm",
              status: "ready",
            }),
          ]),
        }),
      })
    );
    expect(mocks.checkPipelineRuntimePrerequisites).toHaveBeenCalledWith(
      expect.objectContaining({ useSlurm: true })
    );
  });

  it("checks distinct SLURM queues separately for per-pipeline overrides", async () => {
    mocks.getExecutionSettings.mockResolvedValue({
      pipelineRunDir: process.cwd(),
      useSlurm: true,
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
          },
        },
      },
    });
    mocks.checkPipelineRuntimePrerequisites.mockImplementation(
      async (settings: { slurmQueue?: string }) => [
        {
          id: "slurm",
          name: "SLURM",
          description: "Execution runtime",
          status: settings.slurmQueue === "bigmem" ? "fail" : "pass",
          message:
            settings.slurmQueue === "bigmem"
              ? "Partition bigmem is not available"
              : "Partition cpu is available",
          required: true,
        },
      ]
    );

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.checkPipelineRuntimePrerequisites).toHaveBeenCalledTimes(2);
    expect(mocks.checkPipelineRuntimePrerequisites).toHaveBeenCalledWith(
      expect.objectContaining({ useSlurm: true, slurmQueue: "cpu" })
    );
    expect(mocks.checkPipelineRuntimePrerequisites).toHaveBeenCalledWith(
      expect.objectContaining({ useSlurm: true, slurmQueue: "bigmem" })
    );

    const fastqc = payload.pipelines.find(
      (pipeline: { pipelineId: string }) => pipeline.pipelineId === "fastqc"
    );
    const mag = payload.pipelines.find(
      (pipeline: { pipelineId: string }) => pipeline.pipelineId === "mag"
    );
    expect(
      fastqc.readiness.items.find(
        (item: { id: string }) => item.id === "runtime-slurm"
      )
    ).toEqual(expect.objectContaining({ status: "ready" }));
    expect(
      mag.readiness.items.find(
        (item: { id: string }) => item.id === "runtime-slurm"
      )
    ).toEqual(
      expect.objectContaining({
        status: "missing",
        detail: expect.stringContaining("bigmem"),
      })
    );
    expect(mag.readiness.canEnable).toBe(false);
  });

  it("blocks enabling when a required runtime prerequisite is missing", async () => {
    mocks.getAllPipelineIds.mockReturnValue(["mag"]);
    mocks.checkPipelineRuntimePrerequisites.mockResolvedValue([
      {
        id: "nextflow",
        name: "Nextflow",
        description: "Workflow engine",
        status: "fail",
        message: "Not installed",
        details: "Install Nextflow on the SeqDesk host.",
        required: true,
      },
      {
        id: "java",
        name: "Java Runtime",
        description: "Java",
        status: "pass",
        message: "Installed",
        required: true,
      },
      {
        id: "conda",
        name: "Conda/Mamba",
        description: "Runtime",
        status: "pass",
        message: "Available",
        required: true,
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines[0].readiness).toEqual(
      expect.objectContaining({
        status: "missing",
        canEnable: false,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "runtime-nextflow",
            status: "missing",
            action: "configure-runtime",
            href: "/admin/pipeline-runtime#required-runtime",
            blocking: true,
          }),
        ]),
      })
    );
  });

  it("blocks enabling when a required runtime prerequisite only has warning status", async () => {
    mocks.getAllPipelineIds.mockReturnValue(["mag"]);
    mocks.checkPipelineRuntimePrerequisites.mockResolvedValue([
      {
        id: "nextflow",
        name: "Nextflow",
        description: "Workflow engine",
        status: "pass",
        message: "Installed",
        required: true,
      },
      {
        id: "java",
        name: "Java Runtime",
        description: "Java",
        status: "warning",
        message: "Java 8 found (11+ required)",
        required: true,
      },
      {
        id: "conda",
        name: "Conda/Mamba",
        description: "Runtime",
        status: "pass",
        message: "Available",
        required: true,
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines[0].readiness).toEqual(
      expect.objectContaining({
        status: "warning",
        canEnable: false,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "runtime-java",
            status: "warning",
            action: "configure-runtime",
            blocking: true,
          }),
        ]),
      })
    );
  });

  it("reports required config and pipeline-specific validation issues", async () => {
    mocks.getAllPipelineIds.mockReturnValue(["fastqc"]);
    mocks.db.pipelineConfig.findMany.mockResolvedValue([
      {
        pipelineId: "fastqc",
        enabled: false,
        config: JSON.stringify({
          requiredToken: "",
          invalidCombination: true,
        }),
      },
    ]);
    mocks.getPipelineRunConfigIssues.mockReturnValue([
      "The selected options cannot be used together.",
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines[0].readiness).toEqual(
      expect.objectContaining({
        canEnable: false,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "required-config",
            status: "missing",
            action: "configure",
            detail: "Configure: Required token.",
          }),
          expect.objectContaining({
            id: "pipeline-config",
            status: "missing",
            action: "configure",
            detail: "The selected options cannot be used together.",
          }),
        ]),
      })
    );
  });

  it("classifies a required database path without a managed download as needs-db", async () => {
    const property = mocks.pipelineRegistry.fastqc.configSchema.properties
      .requiredToken as typeof mocks.pipelineRegistry.fastqc.configSchema.properties.requiredToken & {
        "x-seqdesk"?: { group: "databases" };
      };
    property["x-seqdesk"] = { group: "databases" };

    try {
      mocks.getAllPipelineIds.mockReturnValue(["fastqc"]);
      mocks.db.pipelineConfig.findMany.mockResolvedValue([
        {
          pipelineId: "fastqc",
          enabled: false,
          config: JSON.stringify({ requiredToken: "" }),
        },
      ]);
      mocks.getPipelineDatabaseStatuses.mockResolvedValue([]);
      mocks.getPackageManifest.mockReturnValue({
        execution: {
          pipeline: "nf-core/fastqc",
          version: "0.1.0",
        },
        targets: { supported: ["order"] },
        inputs: [],
        outputs: [
          {
            id: "report",
            scope: "run",
            destination: "pipeline_run",
          },
        ],
      });

      const response = await GET(
        new NextRequest("http://localhost/api/admin/settings/pipelines")
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.pipelines[0]).toEqual(
        expect.objectContaining({
          setupState: "needs-db",
          readiness: expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({
                id: "database-config",
                status: "missing",
                action: "configure",
                blocking: true,
              }),
            ]),
          }),
        })
      );
    } finally {
      delete property["x-seqdesk"];
    }
  });

  it("reports generic schema value issues in readiness using field titles", async () => {
    const schema = mocks.pipelineRegistry.fastqc
      .configSchema as unknown as PipelineConfigSchema;
    Object.assign(schema.properties, {
      runLabel: {
        type: "string",
        title: "Run label",
      },
      retryCount: {
        type: "integer",
        title: "Retry count",
        minimum: 1,
      },
      confidence: {
        type: "number",
        title: "Confidence",
        minimum: 0,
        maximum: 1,
      },
      strictMode: {
        type: "boolean",
        title: "Strict mode",
      },
      selectedReports: {
        type: "array",
        title: "Selected reports",
      },
      executionMode: {
        type: "string",
        title: "Execution mode",
        enum: ["safe", "fast"],
      },
    });

    try {
      mocks.getAllPipelineIds.mockReturnValue(["fastqc"]);
      mocks.db.pipelineConfig.findMany.mockResolvedValue([
        {
          pipelineId: "fastqc",
          enabled: false,
          config: JSON.stringify({
            requiredToken: "configured",
            runLabel: 42,
            retryCount: 1.5,
            confidence: 2,
            strictMode: "yes",
            selectedReports: "summary",
            executionMode: "turbo",
          }),
        },
      ]);

      const response = await GET(
        new NextRequest("http://localhost/api/admin/settings/pipelines")
      );
      const payload = await response.json();
      const configItem = payload.pipelines[0].readiness.items.find(
        (item: { id: string }) => item.id === "pipeline-config"
      );

      expect(response.status).toBe(200);
      expect(payload.pipelines[0].readiness.canEnable).toBe(false);
      expect(configItem).toEqual(
        expect.objectContaining({
          status: "missing",
          action: "configure",
          blocking: true,
        })
      );
      expect(configItem.detail).toContain("Run label must be a string.");
      expect(configItem.detail).toContain("Retry count must be an integer.");
      expect(configItem.detail).toContain("Confidence must be at most 1.");
      expect(configItem.detail).toContain("Strict mode must be true or false.");
      expect(configItem.detail).toContain("Selected reports must be an array.");
      expect(configItem.detail).toContain(
        "Execution mode must be one of: safe, fast."
      );
    } finally {
      delete schema.properties.runLabel;
      delete schema.properties.retryCount;
      delete schema.properties.confidence;
      delete schema.properties.strictMode;
      delete schema.properties.selectedReports;
      delete schema.properties.executionMode;
    }
  });

  it("reports inaccessible shared paths with direct setup links", async () => {
    mocks.getAllPipelineIds.mockReturnValue(["mag"]);
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: null,
      source: "none",
      isImplicit: false,
    });
    mocks.getExecutionSettings.mockResolvedValue({
      useSlurm: false,
      pipelineOverrides: {},
      pipelineRunDir: "/definitely/missing/seqdesk-runs",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines[0].readiness).toEqual(
      expect.objectContaining({
        canEnable: false,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "data-storage-path",
            status: "missing",
            action: "configure-storage",
          }),
          expect.objectContaining({
            id: "pipeline-run-directory",
            status: "missing",
            action: "configure-runtime",
          }),
        ]),
      })
    );
  });

  it("rejects regular files used as data or pipeline run directories", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-readiness-file-")
    );
    const regularFile = path.join(tempRoot, "not-a-directory");
    fs.writeFileSync(regularFile, "not a directory\n");

    try {
      mocks.getAllPipelineIds.mockReturnValue(["mag"]);
      mocks.getResolvedDataBasePath.mockResolvedValue({
        dataBasePath: regularFile,
        source: "database",
        isImplicit: false,
      });
      mocks.getExecutionSettings.mockResolvedValue({
        useSlurm: false,
        pipelineOverrides: {},
        pipelineRunDir: regularFile,
      });

      const response = await GET(
        new NextRequest("http://localhost/api/admin/settings/pipelines")
      );
      const payload = await response.json();
      const items = payload.pipelines[0].readiness.items as Array<{
        id: string;
        status: string;
        detail: string;
      }>;

      expect(response.status).toBe(200);
      expect(items.find((item) => item.id === "data-storage-path")).toEqual(
        expect.objectContaining({
          status: "missing",
          detail: `Path is not a directory: ${regularFile}`,
        })
      );
      expect(
        items.find((item) => item.id === "pipeline-run-directory")
      ).toEqual(
        expect.objectContaining({
          status: "missing",
          detail: `Path is not a directory: ${regularFile}`,
        })
      );
      expect(payload.pipelines[0].readiness.canEnable).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts a pipeline run root symlink to canonical shared storage", async () => {
    if (process.platform === "win32") return;

    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-readiness-link-")
    );
    const realRunDirectory = path.join(tempRoot, "real-runs");
    const linkedRunDirectory = path.join(tempRoot, "linked-runs");
    fs.mkdirSync(realRunDirectory);
    fs.symlinkSync(realRunDirectory, linkedRunDirectory, "dir");

    try {
      mocks.getAllPipelineIds.mockReturnValue(["mag"]);
      mocks.getResolvedDataBasePath.mockResolvedValue({
        dataBasePath: realRunDirectory,
        source: "database",
        isImplicit: false,
      });
      mocks.getExecutionSettings.mockResolvedValue({
        useSlurm: false,
        pipelineOverrides: {},
        pipelineRunDir: linkedRunDirectory,
      });

      const response = await GET(
        new NextRequest("http://localhost/api/admin/settings/pipelines")
      );
      const payload = await response.json();
      const runDirectoryItem = payload.pipelines[0].readiness.items.find(
        (item: { id: string }) => item.id === "pipeline-run-directory"
      );

      expect(response.status).toBe(200);
      expect(runDirectoryItem).toEqual(
        expect.objectContaining({
          status: "ready",
          detail: `Accessible and writable: ${linkedRunDirectory}`,
        })
      );
      expect(
        fs
          .readdirSync(realRunDirectory)
          .filter((entry) => entry.startsWith(".seqdesk-readiness-"))
      ).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a dangling pipeline run root symlink", async () => {
    if (process.platform === "win32") return;

    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-readiness-dangling-link-")
    );
    const linkedRunDirectory = path.join(tempRoot, "linked-runs");
    fs.symlinkSync(path.join(tempRoot, "missing-runs"), linkedRunDirectory, "dir");

    try {
      mocks.getAllPipelineIds.mockReturnValue(["mag"]);
      mocks.getResolvedDataBasePath.mockResolvedValue({
        dataBasePath: tempRoot,
        source: "database",
        isImplicit: false,
      });
      mocks.getExecutionSettings.mockResolvedValue({
        useSlurm: false,
        pipelineOverrides: {},
        pipelineRunDir: linkedRunDirectory,
      });

      const response = await GET(
        new NextRequest("http://localhost/api/admin/settings/pipelines")
      );
      const payload = await response.json();
      const runDirectoryItem = payload.pipelines[0].readiness.items.find(
        (item: { id: string }) => item.id === "pipeline-run-directory"
      );

      expect(response.status).toBe(200);
      expect(runDirectoryItem).toEqual(
        expect.objectContaining({
          status: "missing",
          detail: `Path does not exist or is not writable: ${linkedRunDirectory}`,
        })
      );
      expect(payload.pipelines[0].readiness.canEnable).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a run directory that fails the writable access check", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-readiness-unwritable-")
    );
    const runDirectory = path.join(tempRoot, "runs");
    fs.mkdirSync(runDirectory);
    const realAccess = fsPromises.access.bind(fsPromises);
    const accessSpy = vi
      .spyOn(fsPromises, "access")
      .mockImplementation(async (target, mode) => {
        if (
          path.resolve(String(target)) === path.resolve(runDirectory) &&
          mode === (fsConstants.R_OK | fsConstants.W_OK)
        ) {
          const error = new Error("permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        await realAccess(target, mode);
      });

    try {
      mocks.getAllPipelineIds.mockReturnValue(["mag"]);
      mocks.getResolvedDataBasePath.mockResolvedValue({
        dataBasePath: tempRoot,
        source: "database",
        isImplicit: false,
      });
      mocks.getExecutionSettings.mockResolvedValue({
        useSlurm: false,
        pipelineOverrides: {},
        pipelineRunDir: runDirectory,
      });

      const response = await GET(
        new NextRequest("http://localhost/api/admin/settings/pipelines")
      );
      const payload = await response.json();
      const runDirectoryItem = payload.pipelines[0].readiness.items.find(
        (item: { id: string }) => item.id === "pipeline-run-directory"
      );

      expect(response.status).toBe(200);
      expect(runDirectoryItem).toEqual(
        expect.objectContaining({
          status: "missing",
          detail: `Path does not exist or is not writable: ${runDirectory}`,
        })
      );
      expect(payload.pipelines[0].readiness.canEnable).toBe(false);
    } finally {
      accessSpy.mockRestore();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs only one writable probe per shared run directory in a GET", async () => {
    const mkdtempSpy = vi.spyOn(fsPromises, "mkdtemp");

    try {
      const response = await GET(
        new NextRequest("http://localhost/api/admin/settings/pipelines")
      );

      expect(response.status).toBe(200);
      expect(mkdtempSpy).toHaveBeenCalledTimes(1);
      expect(mkdtempSpy).toHaveBeenCalledWith(
        path.join(process.cwd(), ".seqdesk-readiness-")
      );
    } finally {
      mkdtempSpy.mockRestore();
    }
  });

  it("keeps unverifiable absolute SLURM config paths as non-blocking warnings", async () => {
    const property = mocks.pipelineRegistry.fastqc.configSchema.properties
      .requiredToken as typeof mocks.pipelineRegistry.fastqc.configSchema.properties.requiredToken & {
        "x-seqdesk"?: { group: "databases" };
      };
    property["x-seqdesk"] = { group: "databases" };

    try {
      mocks.getAllPipelineIds.mockReturnValue(["fastqc"]);
      mocks.db.pipelineConfig.findMany.mockResolvedValue([
        {
          pipelineId: "fastqc",
          enabled: false,
          config: JSON.stringify({ requiredToken: "/cluster/references/db" }),
        },
      ]);
      mocks.getExecutionSettings.mockResolvedValue({
        useSlurm: true,
        pipelineOverrides: {},
        pipelineRunDir: process.cwd(),
      });
      mocks.getPackageManifest.mockReturnValue({
        execution: {
          pipeline: "nf-core/fastqc",
          version: "0.1.0",
        },
        targets: { supported: ["order"] },
        inputs: [],
        outputs: [{ id: "report", scope: "run", destination: "pipeline_run" }],
      });

      const response = await GET(
        new NextRequest("http://localhost/api/admin/settings/pipelines")
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.pipelines[0].readiness).toEqual(
        expect.objectContaining({
          canEnable: true,
          items: expect.arrayContaining([
            expect.objectContaining({
              id: "pipeline-config",
              status: "warning",
              blocking: false,
              detail: expect.stringContaining(
                "assumed to exist on the compute node"
              ),
            }),
          ]),
        })
      );
    } finally {
      delete property["x-seqdesk"];
    }
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
          stagesReadCandidates: false,
          requiresAdminReadPromotion: false,
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
    mocks.getPipelineRunConfigIssues.mockReturnValueOnce([
      "The configured database path is required by this pipeline.",
    ]);
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
    const missingItems = missingPayload.pipelines[0].readiness.items as Array<{
      id: string;
    }>;
    expect(missingItems.findIndex((item) => item.id === "databases")).toBeLessThan(
      missingItems.findIndex((item) => item.id === "pipeline-config")
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
            detail: expect.stringContaining(`${process.cwd()}/package.json`),
          }),
        ]),
      })
    );
  });

  it("reports stale MetaXpath packages as not ready", async () => {
    mocks.getAllPipelineIds.mockReturnValue(["metaxpath"]);
    mocks.getPackageManifest.mockReturnValue({
      package: {
        id: "metaxpath",
        name: "MetaXpath",
        version: "0.1.0",
        description: "ONT metagenomics",
      },
      execution: {
        pipeline: `${process.cwd()}/package.json`,
        version: "1.0.0",
      },
      targets: {
        supported: ["order"],
      },
      inputs: [],
      outputs: [],
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines[0].readiness.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "metaxpath-compatibility",
          status: "missing",
          action: "sync",
          detail: expect.stringContaining("older than required 0.1.1"),
        }),
      ])
    );
  });

  it("returns non-blocking MetaxPath runtime warnings for unsafe Kraken2 defaults", async () => {
    mocks.getAllPipelineIds.mockReturnValue(["metaxpath"]);
    mocks.db.pipelineConfig.findMany.mockResolvedValue([
      {
        pipelineId: "metaxpath",
        enabled: true,
        config: JSON.stringify({
          paramsFile: `${process.cwd()}/package.json`,
          kraken2Db: "/shared/dbs/kraken2_pluspf_20230314",
          kraken2MemoryMapping: false,
          predVfsAmrsMemory: "64 GB",
        }),
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines[0]).toEqual(
      expect.objectContaining({
        pipelineId: "metaxpath",
        runtimeWarnings: expect.arrayContaining([
          expect.stringContaining("PlusPF is configured without memory mapping"),
          expect.stringContaining("PRED_VFS_AMRS memory is 64 GB"),
        ]),
        readiness: expect.objectContaining({
          status: "warning",
          items: expect.arrayContaining([
            expect.objectContaining({
              id: "metaxpath-runtime-warnings",
              status: "warning",
              detail: expect.stringContaining("SIGKILLed"),
            }),
          ]),
        }),
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
    mocks.getExecutionSettings.mockResolvedValue({
      useSlurm: false,
      pipelineOverrides: {},
      pipelineRunDir: process.cwd(),
    });
    mocks.getPipelineRunConfigIssues.mockReturnValue([]);
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({ enabled: true });
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

  it("merges CLI-style config patches over persisted settings", async () => {
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({
      enabled: false,
      config: JSON.stringify({
        requiredToken: "saved-token",
        keepMe: "preserved",
        overrideMe: "old",
      }),
    });
    mocks.db.pipelineConfig.upsert.mockResolvedValue({
      pipelineId: "fastqc",
      enabled: false,
    });

    await expect(
      updateManagedPipeline({
        pipelineId: "fastqc",
        enabled: false,
        config: { overrideMe: "new" },
      })
    ).resolves.toEqual({
      success: true,
      pipelineId: "fastqc",
      enabled: false,
    });
    expect(mocks.db.pipelineConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          config: JSON.stringify({
            requiredToken: "saved-token",
            keepMe: "preserved",
            overrideMe: "new",
          }),
        }),
      })
    );
  });

  it("rejects missing required configuration values with actionable details", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "fastqc",
          enabled: false,
          config: { requiredToken: "" },
        }),
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Pipeline configuration validation failed",
      details: ["Required token is required."],
    });
    expect(mocks.db.pipelineConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects generic schema type, enum, and range issues before saving", async () => {
    const schema = mocks.pipelineRegistry.fastqc
      .configSchema as unknown as PipelineConfigSchema;
    Object.assign(schema.properties, {
      runLabel: {
        type: "string",
        title: "Run label",
      },
      retryCount: {
        type: "integer",
        title: "Retry count",
        minimum: 1,
      },
      confidence: {
        type: "number",
        title: "Confidence",
        minimum: 0,
        maximum: 1,
      },
      strictMode: {
        type: "boolean",
        title: "Strict mode",
      },
      selectedReports: {
        type: "array",
        title: "Selected reports",
      },
      executionMode: {
        type: "string",
        title: "Execution mode",
        enum: ["safe", "fast"],
      },
    });

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/admin/settings/pipelines", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pipelineId: "fastqc",
            enabled: false,
            config: {
              requiredToken: "configured",
              runLabel: 42,
              retryCount: 1.5,
              confidence: 2,
              strictMode: "yes",
              selectedReports: "summary",
              executionMode: "turbo",
              packageSpecificFutureOption: "preserved",
            },
          }),
        })
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({
        error: "Pipeline configuration validation failed",
        details: [
          "Run label must be a string.",
          "Retry count must be an integer.",
          "Confidence must be at most 1.",
          "Strict mode must be true or false.",
          "Selected reports must be an array.",
          "Execution mode must be one of: safe, fast.",
        ],
      });
      expect(mocks.db.pipelineConfig.upsert).not.toHaveBeenCalled();
    } finally {
      delete schema.properties.runLabel;
      delete schema.properties.retryCount;
      delete schema.properties.confidence;
      delete schema.properties.strictMode;
      delete schema.properties.selectedReports;
      delete schema.properties.executionMode;
    }
  });

  it("rejects pipeline-specific configuration issues before saving", async () => {
    mocks.getPipelineRunConfigIssues.mockReturnValue([
      "The selected options cannot be used together.",
    ]);

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "fastqc",
          enabled: false,
          config: { requiredToken: "configured", invalidCombination: true },
        }),
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Pipeline configuration validation failed",
      details: ["The selected options cannot be used together."],
    });
    expect(mocks.db.pipelineConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects unreadable required local database paths", async () => {
    const property = mocks.pipelineRegistry.fastqc.configSchema.properties
      .requiredToken as typeof mocks.pipelineRegistry.fastqc.configSchema.properties.requiredToken & {
        "x-seqdesk"?: { group: "databases" };
      };
    property["x-seqdesk"] = { group: "databases" };

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/admin/settings/pipelines", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pipelineId: "fastqc",
            enabled: false,
            config: {
              requiredToken: "/definitely/missing/seqdesk-database",
            },
          }),
        })
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({
        error: "Pipeline configuration validation failed",
        details: [
          "Required token does not exist or is not readable: /definitely/missing/seqdesk-database",
        ],
      });
      expect(mocks.db.pipelineConfig.upsert).not.toHaveBeenCalled();
    } finally {
      delete property["x-seqdesk"];
    }
  });

  it("rejects non-object pipeline configuration payloads", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "fastqc",
          enabled: false,
          config: "not-an-object",
        }),
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid pipeline configuration",
      details: ["Configuration must be a JSON object."],
    });
    expect(mocks.db.pipelineConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects activation while a blocking readiness check is incomplete", async () => {
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({ enabled: false });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: process.cwd(),
      source: "database",
      isImplicit: false,
    });
    mocks.getPipelineDatabaseStatuses.mockResolvedValue([]);
    mocks.getPackage.mockReturnValue({
      id: "fastqc",
      basePath: process.cwd(),
    });
    mocks.getPackageManifest.mockReturnValue({
      execution: {
        pipeline: "nf-core/fastqc",
        version: "0.1.0",
      },
      targets: { supported: ["order"] },
      inputs: [],
      outputs: [{ id: "report", scope: "run", destination: "pipeline_run" }],
    });
    mocks.checkPipelineRuntimePrerequisites.mockResolvedValue([
      {
        id: "nextflow",
        name: "Nextflow",
        description: "Workflow engine",
        status: "fail",
        message: "Not installed",
        details: "Install Nextflow on the SeqDesk host.",
        required: true,
      },
      {
        id: "java",
        name: "Java Runtime",
        description: "Java",
        status: "pass",
        message: "Installed",
        required: true,
      },
      {
        id: "conda",
        name: "Conda/Mamba",
        description: "Runtime",
        status: "pass",
        message: "Available",
        required: true,
      },
    ]);

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "fastqc",
          enabled: true,
          config: { requiredToken: "configured" },
        }),
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Pipeline is not ready to enable",
      details: [
        "Nextflow: Not installed. Install Nextflow on the SeqDesk host.",
      ],
    });
    expect(mocks.db.pipelineConfig.upsert).not.toHaveBeenCalled();
  });

  it("allows activation after every blocking readiness check passes", async () => {
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({ enabled: false });
    mocks.db.pipelineConfig.upsert.mockResolvedValue({
      pipelineId: "fastqc",
      enabled: true,
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: process.cwd(),
      source: "database",
      isImplicit: false,
    });
    mocks.getPipelineDatabaseStatuses.mockResolvedValue([]);
    mocks.getPackage.mockReturnValue({
      id: "fastqc",
      basePath: process.cwd(),
    });
    mocks.getPackageManifest.mockReturnValue({
      execution: {
        pipeline: "nf-core/fastqc",
        version: "0.1.0",
      },
      targets: { supported: ["order"] },
      inputs: [],
      outputs: [{ id: "report", scope: "run", destination: "pipeline_run" }],
    });
    mocks.checkPipelineRuntimePrerequisites.mockResolvedValue([
      {
        id: "nextflow",
        name: "Nextflow",
        description: "Workflow engine",
        status: "pass",
        message: "Installed",
        required: true,
      },
      {
        id: "java",
        name: "Java Runtime",
        description: "Java",
        status: "pass",
        message: "Installed",
        required: true,
      },
      {
        id: "conda",
        name: "Conda/Mamba",
        description: "Runtime",
        status: "pass",
        message: "Available",
        required: true,
      },
    ]);

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "fastqc",
          enabled: true,
          config: { requiredToken: "configured" },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      pipelineId: "fastqc",
      enabled: true,
    });
    expect(mocks.db.pipelineConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: "fastqc" },
        update: expect.objectContaining({ enabled: true }),
      })
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
