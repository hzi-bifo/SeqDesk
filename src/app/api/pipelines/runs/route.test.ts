import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  validatePipelineMetadata: vi.fn(),
  getAdapter: vi.fn(),
  registerAdapter: vi.fn(),
  createGenericAdapter: vi.fn(),
  mergePipelineDerivedConfig: vi.fn(),
  isDemoSession: vi.fn(),
  getDemoFacilityWorkspaceUserIds: vi.fn(),
  supportsPipelineTarget: vi.fn(),
  db: {
    pipelineRun: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    pipelineResultSelection: {
      findMany: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
    },
    pipelineConfig: {
      findUnique: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  pipelineRegistry: {
    "simulate-reads": {
      id: "simulate-reads",
      name: "Simulate Reads",
      icon: "FlaskConical",
      input: {
        supportedScopes: ["order"],
        perSample: {
          reads: false,
          pairedEnd: true,
        },
      },
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
}));

vi.mock("@/lib/pipelines/adapters", () => ({
  getAdapter: mocks.getAdapter,
  registerAdapter: mocks.registerAdapter,
}));

vi.mock("@/lib/pipelines/generic-adapter", () => ({
  createGenericAdapter: mocks.createGenericAdapter,
}));

vi.mock("@/lib/pipelines/derived-config", () => ({
  mergePipelineDerivedConfig: mocks.mergePipelineDerivedConfig,
}));

vi.mock("@/lib/pipelines/metadata-validation", () => ({
  validatePipelineMetadata: mocks.validatePipelineMetadata,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
  getDemoFacilityWorkspaceUserIds: mocks.getDemoFacilityWorkspaceUserIds,
}));

vi.mock("@/lib/pipelines/target", () => ({
  supportsPipelineTarget: mocks.supportsPipelineTarget,
}));

import { GET, POST } from "./route";

describe("GET /api/pipelines/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });
    mocks.getDemoFacilityWorkspaceUserIds.mockResolvedValue([]);
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        runFolder: null,
        targetType: "order",
        studyId: null,
        orderId: "order-1",
        pipelineId: "simulate-reads",
        results: JSON.stringify({ warnings: ["ok"] }),
        artifacts: [
          {
            id: "artifact-1",
            name: "run-report.html",
            path: "/tmp/run-report.html",
            type: "report",
            sampleId: null,
            outputId: null,
            size: null,
          },
        ],
      },
    ]);
    mocks.db.pipelineRun.count.mockResolvedValue(1);
    mocks.db.pipelineResultSelection.findMany.mockResolvedValue([]);
  });

  it("returns 401 when there is no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs")
    );

    expect(response.status).toBe(401);
  });

  it("applies ownership filters for non-admin users and enriches runs", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/pipelines/runs?pipelineId=simulate-reads&status=completed&orderId=order-1&limit=10&offset=5"
      )
    );

    expect(mocks.db.pipelineRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { study: { userId: "user-1" } },
                { order: { userId: "user-1" } },
              ],
            },
            { selectedResultSelections: { some: {} } },
          ],
          pipelineId: "simulate-reads",
          status: "completed",
          orderId: "order-1",
        },
        take: 10,
        skip: 5,
      })
    );

    const body = await response.json();
    expect(body).toEqual({
      runs: [
        {
          id: "run-1",
          runFolder: null,
          targetType: "order",
          studyId: null,
          orderId: "order-1",
          pipelineId: "simulate-reads",
          pipelineName: "Simulate Reads",
          pipelineIcon: "FlaskConical",
          results: { warnings: ["ok"] },
          artifacts: [
            {
              id: "artifact-1",
              name: "run-report.html",
              path: "/tmp/run-report.html",
              type: "report",
              sampleId: null,
              outputId: null,
              size: null,
            },
          ],
          isSelectedFinal: false,
          isUserVisible: false,
          selectedFinal: null,
          resultFiles: [
            {
              id: "artifact-1",
              name: "run-report.html",
              path: "/tmp/run-report.html",
              type: "report",
              outputId: null,
              source: "artifact",
              size: null,
              previewable: false,
            },
          ],
          resultFilesOmittedCount: 0,
          resultFilesOmittedSampleFileCount: 0,
          primaryResultFile: {
            id: "artifact-1",
            name: "run-report.html",
            path: "/tmp/run-report.html",
            type: "report",
            outputId: null,
            source: "artifact",
            size: null,
            previewable: false,
          },
        },
      ],
      total: 1,
      limit: 10,
      offset: 5,
    });
  });

  it("marks the explicitly selected final run", async () => {
    const selectedAt = new Date("2026-05-20T10:00:00.000Z");
    mocks.db.pipelineResultSelection.findMany.mockResolvedValue([
      {
        pipelineId: "simulate-reads",
        targetKey: "order:order-1",
        selectedRunId: "run-1",
        selectedAt,
        selectedBy: {
          id: "admin-1",
          firstName: "Ada",
          lastName: "Admin",
          email: "ada@example.org",
        },
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs?orderId=order-1")
    );

    const body = await response.json();
    expect(body.runs[0].isSelectedFinal).toBe(true);
    expect(body.runs[0].isUserVisible).toBe(true);
    expect(body.runs[0].selectedFinal).toEqual({
      selectedRunId: "run-1",
      selectedAt: selectedAt.toISOString(),
      selectedBy: {
        id: "admin-1",
        firstName: "Ada",
        lastName: "Admin",
        email: "ada@example.org",
      },
    });
  });

  it("does not add visibility filters for admins unless requested", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });

    await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs?orderId=order-1")
    );

    expect(mocks.db.pipelineRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: "order-1",
        },
      })
    );
  });

  it("lets admins request only user-visible runs", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });

    await GET(
      new NextRequest(
        "http://localhost:3000/api/pipelines/runs?orderId=order-1&publishedOnly=true"
      )
    );

    expect(mocks.db.pipelineRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: "order-1",
          AND: [{ selectedResultSelections: { some: {} } }],
        },
      })
    );
  });
});

describe("POST /api/pipelines/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (mocks.pipelineRegistry as Record<string, unknown>).metaxpath;
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.supportsPipelineTarget.mockReturnValue(true);
    mocks.validatePipelineMetadata.mockResolvedValue({ issues: [] });
    mocks.mergePipelineDerivedConfig.mockImplementation(
      async ({ config }: { config: Record<string, unknown> }) => ({
        config,
        settings: [],
        issues: [],
      })
    );
    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(null);
    mocks.db.pipelineConfig.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.study.findUnique.mockResolvedValue(null);
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      samples: [
        { id: "sample-1", reads: [], assemblies: [], bins: [] },
        { id: "sample-2", reads: [], assemblies: [], bins: [] },
      ],
    });
    mocks.db.pipelineRun.create.mockResolvedValue({
      id: "run-1",
      runNumber: "SIMULATE-READS-123",
      status: "pending",
      pipelineId: "simulate-reads",
      studyId: null,
      orderId: "order-1",
      targetType: "order",
    });
  });

  it("returns 403 for demo sessions", async () => {
    mocks.isDemoSession.mockReturnValue(true);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.db.pipelineRun.create).not.toHaveBeenCalled();
  });

  it("rejects malformed sampleIds", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
          sampleIds: ["sample-1", 3],
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "sampleIds must be an array of strings",
    });
  });

  it("rejects invalid executionMode", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
          executionMode: "cluster",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "executionMode must be one of: default, local, slurm",
    });
    expect(mocks.db.pipelineRun.create).not.toHaveBeenCalled();
  });

  it("rejects disabled pipelines before creating a run", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        installProfilePipelineAllowlist: [],
      }),
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Pipeline simulate-reads is disabled",
    });
    expect(mocks.db.pipelineRun.create).not.toHaveBeenCalled();
  });

  it("returns metadata validation errors", async () => {
    mocks.validatePipelineMetadata.mockResolvedValue({
      issues: [
        { severity: "warning", message: "ignore" },
        { severity: "error", message: "Reads missing" },
      ],
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Pipeline metadata validation failed",
      details: ["Reads missing"],
    });
  });

  it("returns adapter validation failures from a generic adapter", async () => {
    const adapter = {
      validateInputs: vi.fn().mockResolvedValue({
        valid: false,
        issues: ["Reads are required"],
      }),
    };
    mocks.createGenericAdapter.mockReturnValue(adapter);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
          sampleIds: ["sample-1"],
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.registerAdapter).toHaveBeenCalledWith(adapter);
    expect(await response.json()).toEqual({
      error: "Pipeline input validation failed",
      details: ["Reads are required"],
    });
  });

  it("rejects invalid simulate-reads config combinations", async () => {
    const adapter = {
      validateInputs: vi.fn().mockResolvedValue({
        valid: true,
      }),
    };
    mocks.createGenericAdapter.mockReturnValue(adapter);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
          config: {
            simulationMode: "template",
            mode: "longRead",
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Pipeline config validation failed",
      details: [
        "Template simulation is not supported for long-read mode. Choose synthetic or auto mode, or switch to a short-read mode.",
      ],
    });
  });

  it("merges saved admin pipeline config into created runs", async () => {
    (mocks.pipelineRegistry as Record<string, unknown>).metaxpath = {
      id: "metaxpath",
      name: "MetaxPath",
      icon: "Dna",
      defaultConfig: {
        topn: 50,
      },
      input: {
        supportedScopes: ["order"],
        perSample: {
          reads: true,
          pairedEnd: false,
        },
      },
    };
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({
      enabled: true,
      config: JSON.stringify({
        paramsFile: "/shared/metaxpath/downloaded.params.yaml",
        topn: 25,
        allowedSequencingTechnologies: ["Nanopore"],
      }),
    });
    const adapter = {
      validateInputs: vi.fn().mockResolvedValue({
        valid: true,
      }),
    };
    mocks.createGenericAdapter.mockReturnValue(adapter);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "metaxpath",
          orderId: "order-1",
          config: {
            topn: 10,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pipelineId: "metaxpath",
        config: JSON.stringify({
          topn: 10,
          paramsFile: "/shared/metaxpath/downloaded.params.yaml",
        }),
      }),
    });
  });

  it("merges derived MetaxPath sequencer config into created runs", async () => {
    (mocks.pipelineRegistry as Record<string, unknown>).metaxpath = {
      id: "metaxpath",
      name: "MetaxPath",
      icon: "Dna",
      defaultConfig: {
        sequencer: "Nanopore",
        topn: 50,
      },
      input: {
        supportedScopes: ["order"],
        perSample: {
          reads: true,
          pairedEnd: false,
        },
      },
    };
    const adapter = {
      validateInputs: vi.fn().mockResolvedValue({
        valid: true,
      }),
    };
    mocks.createGenericAdapter.mockReturnValue(adapter);
    mocks.mergePipelineDerivedConfig.mockResolvedValueOnce({
      config: {
        sequencer: "Nanopore",
        topn: 25,
      },
      settings: [
        {
          key: "sequencer",
          title: "Sequencing Mode",
          value: "Nanopore",
          message: "MetaxPath will run in Nanopore mode.",
          source: "order.sequencingTechnology.platformFamily",
        },
      ],
      issues: [],
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "metaxpath",
          orderId: "order-1",
          config: {
            sequencer: "PacBio",
            topn: 25,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.mergePipelineDerivedConfig).toHaveBeenCalledWith({
      pipelineId: "metaxpath",
      target: { type: "order", orderId: "order-1", sampleIds: undefined },
      config: expect.objectContaining({
        sequencer: "PacBio",
        topn: 25,
      }),
    });
    expect(mocks.db.pipelineRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pipelineId: "metaxpath",
        config: JSON.stringify({
          sequencer: "Nanopore",
          topn: 25,
        }),
      }),
    });
  });

  it("creates a pending order run and persists selected sample ids", async () => {
    const adapter = {
      validateInputs: vi.fn().mockResolvedValue({
        valid: true,
      }),
    };
    mocks.createGenericAdapter.mockReturnValue(adapter);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
          sampleIds: ["sample-1"],
          config: {
            simulationMode: "synthetic",
            mode: "shortReadPaired",
            readCount: 999999,
            readLength: 90,
            replaceExisting: false,
            qualityProfile: "noisy",
            insertMean: 420,
            insertStdDev: 25,
            seed: 7,
            templateDir: "facility/templates",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pipelineId: "simulate-reads",
        status: "pending",
        targetType: "order",
        orderId: "order-1",
        studyId: null,
        userId: "admin-1",
        config: JSON.stringify({
          simulationMode: "synthetic",
          mode: "shortReadPaired",
          readCount: 50000,
          readLength: 90,
          replaceExisting: false,
          qualityProfile: "noisy",
          insertMean: 420,
          insertStdDev: 25,
          seed: 7,
          templateDir: "facility/templates",
        }),
        inputSampleIds: JSON.stringify(["sample-1"]),
      }),
    });

    expect(await response.json()).toEqual({
      success: true,
      run: {
        id: "run-1",
        runNumber: "SIMULATE-READS-123",
        status: "pending",
        pipelineId: "simulate-reads",
        studyId: null,
        orderId: "order-1",
        targetType: "order",
      },
    });
  });

  it("persists a per-run SLURM execution request", async () => {
    mocks.db.pipelineRun.create.mockResolvedValueOnce({
      id: "run-slurm",
      runNumber: "SIMULATE-READS-124",
      status: "pending",
      pipelineId: "simulate-reads",
      studyId: null,
      orderId: "order-1",
      targetType: "order",
      executionMode: "slurm",
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/pipelines/runs", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "simulate-reads",
          orderId: "order-1",
          executionMode: "slurm",
          slurm: {
            queue: "dev",
            cores: 4,
            memory: "16GB",
            timeLimit: 2,
            options: "--account=seqdesk",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        executionMode: "slurm",
        executionProfile: JSON.stringify({
          request: {
            executionMode: "slurm",
            slurm: {
              queue: "dev",
              cores: 4,
              memory: "16GB",
              timeLimit: 2,
              options: "--account=seqdesk",
            },
          },
        }),
      }),
    });

    const body = await response.json();
    expect(body.run.executionMode).toBe("slurm");
  });
});
