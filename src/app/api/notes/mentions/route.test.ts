import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      findUnique: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
    },
    assembly: {
      findMany: vi.fn(),
    },
    bin: {
      findMany: vi.fn(),
    },
    pipelineRun: {
      findMany: vi.fn(),
    },
    sequencingArtifact: {
      findMany: vi.fn(),
    },
    pipelineArtifact: {
      findMany: vi.fn(),
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

import { GET } from "./route";

function request(url: string) {
  return new NextRequest(`http://localhost:3000${url}`);
}

describe("GET /api/notes/mentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.assembly.findMany.mockResolvedValue([]);
    mocks.db.bin.findMany.mockResolvedValue([]);
    mocks.db.pipelineRun.findMany.mockResolvedValue([]);
    mocks.db.sequencingArtifact.findMany.mockResolvedValue([]);
    mocks.db.pipelineArtifact.findMany.mockResolvedValue([]);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(request("/api/notes/mentions?entityType=order&entityId=order-1"));

    expect(response.status).toBe(401);
  });

  it("returns grouped order mentions for associated objects only", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-001",
      name: "Pilot order",
      userId: "user-1",
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-001",
          sampleAlias: "S1",
          sampleTitle: "Soil sample",
          scientificName: "Escherichia coli",
          taxId: "562",
          reads: [{ id: "read-1", file1: "reads/SAMPLE-001_R1.fastq.gz", file2: null }],
          study: { id: "study-1", title: "Soil study", alias: "soil-study" },
        },
      ],
    });
    mocks.db.assembly.findMany.mockResolvedValue([
      { id: "assembly-1", assemblyName: "Assembly A", assemblyFile: "assembly/sample.fa", sampleId: "sample-1" },
    ]);
    mocks.db.bin.findMany.mockResolvedValue([
      { id: "bin-1", binName: "Bin A", binFile: "bins/bin-a.fa", sampleId: "sample-1" },
    ]);
    mocks.db.pipelineRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        runNumber: "FASTQC-001",
        pipelineId: "fastqc",
        status: "completed",
        studyId: null,
        orderId: "order-1",
      },
    ]);
    mocks.db.sequencingArtifact.findMany.mockResolvedValue([
      {
        id: "artifact-1",
        originalName: "multiqc.html",
        path: "reports/multiqc.html",
        artifactType: "qc_report",
        stage: "qc",
        sampleId: "sample-1",
      },
    ]);
    mocks.db.pipelineArtifact.findMany.mockResolvedValue([
      {
        id: "pipeline-artifact-1",
        name: "FastQC report",
        path: "pipeline/fastqc.html",
        type: "qc_report",
        sampleId: "sample-1",
        studyId: "study-1",
        pipelineRunId: "run-1",
      },
    ]);

    const response = await GET(request("/api/notes/mentions?entityType=order&entityId=order-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.groups.map((group: { label: string }) => group.label)).toEqual([
      "Samples",
      "Orders/Studies",
      "Files",
      "Assemblies",
      "Bins",
      "Pipeline runs",
      "Artifacts",
    ]);
    expect(payload.mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "sample",
          id: "sample-1",
          label: "S1",
          detail: "ID SAMPLE-001 · Soil sample · Escherichia coli (tax 562) · Soil study",
        }),
        expect.objectContaining({ type: "study", id: "study-1", label: "Soil study" }),
        expect.objectContaining({ type: "file", id: "reads/SAMPLE-001_R1.fastq.gz" }),
        expect.objectContaining({ type: "assembly", id: "assembly-1", label: "Assembly A" }),
        expect.objectContaining({ type: "bin", id: "bin-1", label: "Bin A" }),
        expect.objectContaining({ type: "pipeline-run", id: "run-1", label: "FASTQC-001" }),
        expect.objectContaining({ type: "sequencing-artifact", id: "artifact-1", label: "multiqc.html" }),
        expect.objectContaining({ type: "pipeline-artifact", id: "pipeline-artifact-1", label: "FastQC report" }),
      ])
    );
    expect(payload.mentions[0].mentionHref).toMatch(/^seqdesk-mention:\/\//);
  });

  it("filters grouped results by query while keeping mention resolution data", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-001",
      name: null,
      userId: "user-1",
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-001",
          sampleAlias: null,
          sampleTitle: null,
          scientificName: null,
          taxId: null,
          reads: [],
          study: null,
        },
      ],
    });

    const response = await GET(request("/api/notes/mentions?entityType=order&entityId=order-1&q=sample"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.groups).toEqual([
      expect.objectContaining({
        label: "Samples",
        items: [expect.objectContaining({ id: "sample-1" })],
      }),
    ]);
    expect(payload.mentions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "order", id: "order-1" })])
    );
  });

  it("prevents access to another user's study context", async () => {
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study 1",
      alias: null,
      userId: "other-user",
      samples: [],
    });

    const response = await GET(request("/api/notes/mentions?entityType=study&entityId=study-1"));

    expect(response.status).toBe(404);
  });
});
