import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  spawn: vi.fn(),
  fs: {
    access: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
  },
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  pipelineRegistry: {
    "simulate-reads": {
      id: "simulate-reads",
      name: "Simulate Reads",
      icon: "FlaskConical",
      description: "Generate synthetic sequencing reads",
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

vi.mock("child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("fs/promises", () => ({
  default: mocks.fs,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

import { DELETE, GET } from "./route";

describe("GET /api/pipelines/runs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.fs.access.mockResolvedValue(undefined);
    mocks.fs.readFile.mockResolvedValue(
      '#!/usr/bin/env bash\n"${NEXTFLOW_RUNNER[@]}" run main.nf \\\n  --input samplesheet.csv \\\n  --outdir results\n'
    );
    mocks.fs.stat.mockImplementation(async (filePath: string) => ({
      size: filePath.endsWith("samplesheet.csv") ? 33 : 101,
      isFile: () => !filePath.endsWith("/missing"),
    }));
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      pipelineId: "simulate-reads",
      targetType: "order",
      inputSampleIds: JSON.stringify(["sample-db-1"]),
      config: JSON.stringify({ replaceExisting: true }),
      results: JSON.stringify({ warnings: ["ok"] }),
      runFolder: "/runs/run-1",
      queueJobId: "local-123",
      outputPath: "/runs/run-1/output.txt",
      errorPath: "/runs/run-1/error.txt",
      status: "completed",
      order: {
        id: "order-1",
        name: "Order One",
        orderNumber: "ORD-001",
        userId: "user-1",
        samples: [
          {
            id: "sample-db-1",
            sampleId: "S1",
            reads: [
              {
                id: "read-1",
                file1: "/reads/S1_R1.fastq",
                file2: "/reads/S1_R2.fastq",
                checksum1: "aaa",
                checksum2: "bbb",
              },
            ],
          },
          {
            id: "sample-db-2",
            sampleId: "S2",
            reads: [
              {
                id: "read-2",
                file1: "/reads/S2_R1.fastq",
                file2: null,
                checksum1: "ccc",
                checksum2: null,
              },
            ],
          },
        ],
      },
      study: null,
      user: {
        id: "admin-1",
        firstName: "Ada",
        lastName: "Admin",
        email: "ada@example.com",
      },
      steps: [],
      assembliesCreated: [],
      binsCreated: [],
      artifacts: [
        {
          id: "artifact-1",
          type: "report",
          name: "report.html",
          path: "/runs/run-1/report.html",
          sampleId: null,
          size: null,
          checksum: null,
          producedByStepId: null,
          metadata: null,
        },
      ],
      events: [],
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the run does not exist", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Run not found" });
  });

  it("enforces ownership checks for non-admins", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      study: { userId: "other-user" },
      order: { userId: "different-user" },
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1"),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("returns enriched run details and filters input files to selected samples", async () => {
    const response = await GET(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1"),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run).toMatchObject({
      id: "run-1",
      pipelineId: "simulate-reads",
      pipelineName: "Simulate Reads",
      pipelineIcon: "FlaskConical",
      pipelineDescription: "Generate synthetic sequencing reads",
      config: { replaceExisting: true },
      results: { warnings: ["ok"] },
      inputSampleIds: ["sample-db-1"],
      outputPathSize: 101,
      errorPathSize: 101,
      executionCommands: {
        scriptPath: "/runs/run-1/run.sh",
        launchCommand: "cd '/runs/run-1' && bash '/runs/run-1/run.sh'",
        scriptCommand: "bash '/runs/run-1/run.sh'",
        pipelineCommand:
          "\"${NEXTFLOW_RUNNER[@]}\" run main.nf --input samplesheet.csv --outdir results",
      },
    });
    expect(body.run.inputFiles).toEqual([
      expect.objectContaining({
        id: "read-1_r1",
        path: "/reads/S1_R1.fastq",
        sampleId: "S1",
        checksum: "aaa",
        size: 101,
      }),
      expect.objectContaining({
        id: "read-1_r2",
        path: "/reads/S1_R2.fastq",
        sampleId: "S1",
        checksum: "bbb",
        size: 101,
      }),
      expect.objectContaining({
        id: "samplesheet",
        path: "/runs/run-1/samplesheet.csv",
        size: 33,
      }),
    ]);
    expect(
      body.run.inputFiles.some((file: { path: string }) => file.path === "/reads/S2_R1.fastq")
    ).toBe(false);
    expect(body.run.artifacts).toEqual([
      expect.objectContaining({
        id: "artifact-1",
        size: 101,
      }),
    ]);
    expect(body.run.fileSizeByPath["/runs/run-1/report.html"]).toBe(101);
  });
});

describe("DELETE /api/pipelines/runs/[id]", () => {
  const processKill = vi.spyOn(process, "kill");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.isDemoSession.mockReturnValue(false);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      status: "running",
      queueJobId: "local-321",
    });
    mocks.db.pipelineRun.update.mockResolvedValue(null);
    processKill.mockImplementation(() => true);
  });

  afterEach(() => {
    processKill.mockReset();
  });

  it("rejects non-admin deletes", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });

    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("blocks deletes in the public demo", async () => {
    mocks.isDemoSession.mockReturnValue(true);

    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Pipeline execution is disabled in the public demo.",
    });
  });

  it("rejects completed runs", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      status: "completed",
      queueJobId: "local-321",
    });

    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Cannot cancel a completed or failed run",
    });
  });

  it("cancels local jobs and marks the run cancelled", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(processKill).toHaveBeenCalledWith(-321, "SIGTERM");
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "cancelled",
        statusSource: "manual",
        completedAt: expect.any(Date),
        lastEventAt: expect.any(Date),
      }),
    });
    expect(await response.json()).toEqual({ success: true });
  });

  it("force-stops stuck running jobs without queue IDs", async () => {
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      status: "running",
      queueJobId: null,
    });

    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/pipelines/runs/run-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.db.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "failed",
        statusSource: "manual",
      }),
    });
  });
});
