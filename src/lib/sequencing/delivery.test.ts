import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
    read: {
      findFirst: vi.fn(),
    },
    sequencingArtifact: {
      findFirst: vi.fn(),
    },
  },
  getSequencingFilesConfig: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/files/sequencing-config", () => ({
  getSequencingFilesConfig: mocks.getSequencingFilesConfig,
}));

import {
  CUSTOMER_SEQUENCING_ARTIFACT_VISIBILITY,
  FACILITY_SEQUENCING_ARTIFACT_VISIBILITY,
  assertSequencingDeliveryAccess,
  buildOrderSequencingDeliverySummary,
  canUserAccessDeliveryArtifact,
  canUserAccessDeliveryRead,
  findSequencingDeliveryArtifactByPath,
  findSequencingDeliveryReadByPath,
} from "./delivery";

type DeliveryRead = Parameters<typeof canUserAccessDeliveryRead>[1];
type DeliveryArtifact = Parameters<typeof canUserAccessDeliveryArtifact>[1];

function makeRead(overrides: Partial<DeliveryRead> = {}): DeliveryRead {
  return {
    id: "read-1",
    file1: "reads/S1_R1.fastq.gz",
    file2: "reads/S1_R2.fastq.gz",
    checksum1: "md5-r1",
    checksum2: "md5-r2",
    readCount1: 10,
    readCount2: 11,
    dataClass: "cleaned",
    isActive: true,
    sample: {
      id: "sample-1",
      sampleId: "S1",
      sampleTitle: "Sample 1",
      order: {
        id: "order-1",
        userId: "owner-1",
        sequencingFilesPublishedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<DeliveryArtifact> = {}): DeliveryArtifact {
  return {
    id: "artifact-1",
    orderId: "order-1",
    sampleId: "sample-1",
    stage: "delivery",
    artifactType: "delivery_report",
    visibility: CUSTOMER_SEQUENCING_ARTIFACT_VISIBILITY,
    path: "reports/delivery.html",
    originalName: "delivery.html",
    size: 42n,
    checksum: "md5-report",
    order: {
      id: "order-1",
      userId: "owner-1",
      sequencingFilesPublishedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    sample: {
      id: "sample-1",
      sampleId: "S1",
      sampleTitle: "Sample 1",
    },
    ...overrides,
  };
}

async function writeRelative(basePath: string, relativePath: string, content = "x") {
  const absolutePath = path.join(basePath, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}

describe("sequencing delivery", () => {
  let tempDir = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-delivery-"));
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: tempDir,
      config: {
        allowedExtensions: [".fastq.gz", ".fq.gz"],
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("applies customer and facility access rules for reads and artifacts", () => {
    const owner = { id: "owner-1", role: "RESEARCHER" };
    const otherUser = { id: "other-user", role: "RESEARCHER" };
    const facilityAdmin = { id: "admin-1", role: "FACILITY_ADMIN" };

    expect(canUserAccessDeliveryRead(owner, makeRead())).toBe(true);
    expect(canUserAccessDeliveryRead(facilityAdmin, makeRead({ dataClass: "raw" }))).toBe(true);
    expect(canUserAccessDeliveryRead(otherUser, makeRead())).toBe(false);
    expect(
      canUserAccessDeliveryRead(
        owner,
        makeRead({
          sample: {
            ...makeRead().sample,
            order: {
              ...makeRead().sample.order,
              sequencingFilesPublishedAt: null,
            },
          },
        })
      )
    ).toBe(false);
    expect(canUserAccessDeliveryRead(owner, makeRead({ dataClass: "raw" }))).toBe(false);
    expect(canUserAccessDeliveryRead(owner, makeRead({ isActive: false }))).toBe(false);

    expect(canUserAccessDeliveryArtifact(owner, makeArtifact())).toBe(true);
    expect(
      canUserAccessDeliveryArtifact(
        facilityAdmin,
        makeArtifact({ visibility: FACILITY_SEQUENCING_ARTIFACT_VISIBILITY })
      )
    ).toBe(true);
    expect(canUserAccessDeliveryArtifact(otherUser, makeArtifact())).toBe(false);
    expect(
      canUserAccessDeliveryArtifact(
        owner,
        makeArtifact({ visibility: FACILITY_SEQUENCING_ARTIFACT_VISIBILITY })
      )
    ).toBe(false);
  });

  it("builds a delivery summary and explains excluded files", async () => {
    await writeRelative(tempDir, "reads/S1_R1.fastq.gz", "r1");
    await writeRelative(tempDir, "reports/delivery.html", "report");

    const cleanedRead = makeRead({
      file2: "reads/S1_R2.bam",
    });
    const rawRead = makeRead({
      id: "read-raw",
      file1: "reads/raw_R1.fastq.gz",
      file2: "reads/raw_R2.fastq.gz",
      dataClass: "raw",
    });

    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      name: "Order 1",
      sequencingFilesPublishedAt: new Date("2026-01-02T03:04:05.000Z"),
      sequencingFilesPublishedBy: {
        id: "admin-1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.test",
      },
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          sampleTitle: "Sample 1",
          reads: [cleanedRead, rawRead],
        },
      ],
      sequencingArtifacts: [
        makeArtifact(),
        makeArtifact({
          id: "artifact-unsupported",
          path: "reports/archive.zip",
          originalName: "archive.zip",
        }),
        makeArtifact({
          id: "artifact-facility",
          visibility: FACILITY_SEQUENCING_ARTIFACT_VISIBILITY,
        }),
        makeArtifact({
          id: "artifact-missing",
          path: "reports/missing.pdf",
          originalName: "missing.pdf",
        }),
      ],
    });

    const summary = await buildOrderSequencingDeliverySummary("order-1");

    expect(summary).toMatchObject({
      orderId: "order-1",
      orderName: "Order 1",
      isPublished: true,
      publishedAt: "2026-01-02T03:04:05.000Z",
      dataBasePathConfigured: true,
      excluded: {
        missingCleanedReadFiles: 1,
        rawOrUnknownReadFiles: 2,
        missingCustomerArtifacts: 1,
        unsupportedCustomerArtifacts: 1,
        facilityArtifacts: 1,
      },
    });
    expect(summary.readFiles).toEqual([
      expect.objectContaining({
        id: "read-1:R1",
        kind: "read",
        label: "S1 R1",
        fileName: "S1_R1.fastq.gz",
        size: 2,
        checksum: "md5-r1",
        readDirection: "R1",
      }),
    ]);
    expect(summary.artifactFiles).toEqual([
      expect.objectContaining({
        id: "artifact-1",
        kind: "artifact",
        fileName: "delivery.html",
        size: 6,
        checksum: "md5-report",
      }),
    ]);
  });

  it("throws when a delivery summary is requested for a missing order", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);

    await expect(buildOrderSequencingDeliverySummary("missing")).rejects.toThrow(
      "Order not found"
    );
  });

  it("checks order delivery access and publication state", async () => {
    mocks.db.order.findUnique.mockResolvedValueOnce(null);
    await expect(
      assertSequencingDeliveryAccess("missing", { id: "owner-1", role: "RESEARCHER" })
    ).resolves.toEqual({ status: 404, body: { error: "Order not found" } });

    mocks.db.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      userId: "owner-1",
      sequencingFilesPublishedAt: null,
    });
    await expect(
      assertSequencingDeliveryAccess("order-1", { id: "owner-1", role: "RESEARCHER" })
    ).resolves.toEqual({
      status: 403,
      body: { error: "Sequencing files are not available for this order" },
    });

    mocks.db.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      userId: "owner-1",
      sequencingFilesPublishedAt: null,
    });
    await expect(
      assertSequencingDeliveryAccess("order-1", { id: "admin-1", role: "FACILITY_ADMIN" })
    ).resolves.toBeNull();

    mocks.db.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      userId: "owner-1",
      sequencingFilesPublishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await expect(
      assertSequencingDeliveryAccess("order-1", { id: "owner-1", role: "RESEARCHER" })
    ).resolves.toBeNull();

    mocks.db.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      userId: "owner-1",
      sequencingFilesPublishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await expect(
      assertSequencingDeliveryAccess("order-1", { id: "other-user", role: "RESEARCHER" })
    ).resolves.toEqual({ status: 403, body: { error: "Forbidden" } });
  });

  it("delegates delivery lookup database queries", async () => {
    mocks.db.read.findFirst.mockResolvedValue(makeRead());
    mocks.db.sequencingArtifact.findFirst.mockResolvedValue(makeArtifact());

    await expect(findSequencingDeliveryReadByPath("reads/S1_R1.fastq.gz")).resolves.toEqual(
      makeRead()
    );
    expect(mocks.db.read.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ file1: "reads/S1_R1.fastq.gz" }, { file2: "reads/S1_R1.fastq.gz" }],
        },
      })
    );

    await expect(findSequencingDeliveryArtifactByPath("reports/delivery.html")).resolves.toEqual(
      makeArtifact()
    );
    expect(mocks.db.sequencingArtifact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { path: "reports/delivery.html" },
      })
    );
  });
});
