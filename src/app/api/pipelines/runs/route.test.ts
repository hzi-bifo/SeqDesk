import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  validatePipelineMetadata: vi.fn(),
  getAdapter: vi.fn(),
  registerAdapter: vi.fn(),
  createGenericAdapter: vi.fn(),
  isDemoSession: vi.fn(),
  supportsPipelineTarget: vi.fn(),
  db: {
    pipelineRun: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
    },
    order: {
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

vi.mock("@/lib/pipelines/metadata-validation", () => ({
  validatePipelineMetadata: mocks.validatePipelineMetadata,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
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
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        pipelineId: "simulate-reads",
        results: JSON.stringify({ warnings: ["ok"] }),
        artifacts: [
          {
            id: "artifact-1",
            name: "run-report.html",
            path: "/tmp/run-report.html",
            type: "report",
            sampleId: null,
          },
        ],
      },
    ]);
    mocks.db.pipelineRun.count.mockResolvedValue(1);
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
          OR: [
            { study: { userId: "user-1" } },
            { order: { userId: "user-1" } },
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
            },
          ],
        },
      ],
      total: 1,
      limit: 10,
      offset: 5,
    });
  });
});

describe("POST /api/pipelines/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.supportsPipelineTarget.mockReturnValue(true);
    mocks.validatePipelineMetadata.mockResolvedValue({ issues: [] });
    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(null);
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
});
