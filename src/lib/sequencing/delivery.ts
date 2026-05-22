import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import { hasAllowedExtension, safeJoin } from "@/lib/files/paths";
import type {
  SequencingDeliveryFileSummary,
  SequencingDeliverySummary,
} from "@/lib/sequencing/types";

export const CUSTOMER_SEQUENCING_ARTIFACT_VISIBILITY = "customer";
export const FACILITY_SEQUENCING_ARTIFACT_VISIBILITY = "facility";

export const CUSTOMER_ARTIFACT_EXTENSIONS = [
  ".html",
  ".htm",
  ".pdf",
  ".txt",
  ".tsv",
  ".csv",
  ".json",
  ".log",
];

type DeliveryUser = {
  id: string;
  role: string;
};

type DeliveryReadRecord = {
  id: string;
  file1: string | null;
  file2: string | null;
  checksum1: string | null;
  checksum2: string | null;
  readCount1: number | null;
  readCount2: number | null;
  dataClass: string;
  isActive: boolean;
  sample: {
    id: string;
    sampleId: string;
    sampleTitle: string | null;
    order: {
      id: string;
      userId: string;
      sequencingFilesPublishedAt: Date | null;
    };
  };
};

type DeliveryArtifactRecord = {
  id: string;
  orderId: string;
  sampleId: string | null;
  stage: string;
  artifactType: string;
  visibility: string;
  path: string;
  originalName: string;
  size: bigint | number | null;
  checksum: string | null;
  order: {
    id: string;
    userId: string;
    sequencingFilesPublishedAt: Date | null;
  };
  sample: {
    id: string;
    sampleId: string;
    sampleTitle: string | null;
  } | null;
};

function isFacilityAdmin(user: DeliveryUser): boolean {
  return user.role === "FACILITY_ADMIN";
}

function isCleanedRead(read: { dataClass?: string | null; isActive?: boolean | null }): boolean {
  return read.isActive === true && (read.dataClass ?? "cleaned") === "cleaned";
}

function toNumber(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === "bigint" ? Number(value) : value;
}

async function getExistingFileSize(
  dataBasePath: string | null,
  relativePath: string
): Promise<number | null> {
  if (!dataBasePath) return null;
  try {
    const stat = await fs.stat(safeJoin(dataBasePath, relativePath));
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function readFileSummary(args: {
  read: DeliveryReadRecord;
  direction: "R1" | "R2";
  filePath: string;
  size: number | null;
}): SequencingDeliveryFileSummary {
  const { read, direction, filePath, size } = args;
  const isR1 = direction === "R1";
  return {
    id: `${read.id}:${direction}`,
    kind: "read",
    label: `${read.sample.sampleId} ${direction}`,
    path: filePath,
    fileName: path.basename(filePath),
    sampleId: read.sample.id,
    sampleCode: read.sample.sampleId,
    sampleTitle: read.sample.sampleTitle,
    size,
    checksum: isR1 ? read.checksum1 : read.checksum2,
    readId: read.id,
    readDirection: direction,
    readCount: isR1 ? read.readCount1 : read.readCount2,
  };
}

function artifactFileSummary(
  artifact: DeliveryArtifactRecord,
  size: number | null
): SequencingDeliveryFileSummary {
  return {
    id: artifact.id,
    kind: "artifact",
    label: artifact.originalName,
    path: artifact.path,
    fileName: path.basename(artifact.path),
    sampleId: artifact.sample?.id ?? null,
    sampleCode: artifact.sample?.sampleId ?? null,
    sampleTitle: artifact.sample?.sampleTitle ?? null,
    size,
    checksum: artifact.checksum,
    artifactId: artifact.id,
    stage: artifact.stage,
    artifactType: artifact.artifactType,
  };
}

export function canUserAccessDeliveryRead(
  user: DeliveryUser,
  read: DeliveryReadRecord
): boolean {
  if (isFacilityAdmin(user)) return true;
  return (
    read.sample.order.userId === user.id &&
    read.sample.order.sequencingFilesPublishedAt !== null &&
    isCleanedRead(read)
  );
}

export function canUserAccessDeliveryArtifact(
  user: DeliveryUser,
  artifact: DeliveryArtifactRecord
): boolean {
  if (isFacilityAdmin(user)) return true;
  return (
    artifact.order.userId === user.id &&
    artifact.order.sequencingFilesPublishedAt !== null &&
    artifact.visibility === CUSTOMER_SEQUENCING_ARTIFACT_VISIBILITY
  );
}

export async function findSequencingDeliveryReadByPath(filePath: string) {
  return db.read.findFirst({
    where: {
      OR: [{ file1: filePath }, { file2: filePath }],
    },
    select: {
      id: true,
      file1: true,
      file2: true,
      checksum1: true,
      checksum2: true,
      readCount1: true,
      readCount2: true,
      dataClass: true,
      isActive: true,
      sample: {
        select: {
          id: true,
          sampleId: true,
          sampleTitle: true,
          order: {
            select: {
              id: true,
              userId: true,
              sequencingFilesPublishedAt: true,
            },
          },
        },
      },
    },
  });
}

export async function findSequencingDeliveryArtifactByPath(filePath: string) {
  return db.sequencingArtifact.findFirst({
    where: { path: filePath },
    select: {
      id: true,
      orderId: true,
      sampleId: true,
      stage: true,
      artifactType: true,
      visibility: true,
      path: true,
      originalName: true,
      size: true,
      checksum: true,
      order: {
        select: {
          id: true,
          userId: true,
          sequencingFilesPublishedAt: true,
        },
      },
      sample: {
        select: {
          id: true,
          sampleId: true,
          sampleTitle: true,
        },
      },
    },
  });
}

export async function buildOrderSequencingDeliverySummary(
  orderId: string
): Promise<SequencingDeliverySummary> {
  const [order, { dataBasePath, config }] = await Promise.all([
    db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        name: true,
        sequencingFilesPublishedAt: true,
        sequencingFilesPublishedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        samples: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            sampleId: true,
            sampleTitle: true,
            reads: {
              select: {
                id: true,
                file1: true,
                file2: true,
                checksum1: true,
                checksum2: true,
                readCount1: true,
                readCount2: true,
                dataClass: true,
                isActive: true,
                sample: {
                  select: {
                    id: true,
                    sampleId: true,
                    sampleTitle: true,
                    order: {
                      select: {
                        id: true,
                        userId: true,
                        sequencingFilesPublishedAt: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        sequencingArtifacts: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            orderId: true,
            sampleId: true,
            stage: true,
            artifactType: true,
            visibility: true,
            path: true,
            originalName: true,
            size: true,
            checksum: true,
            order: {
              select: {
                id: true,
                userId: true,
                sequencingFilesPublishedAt: true,
              },
            },
            sample: {
              select: {
                id: true,
                sampleId: true,
                sampleTitle: true,
              },
            },
          },
        },
      },
    }),
    getSequencingFilesConfig(),
  ]);

  if (!order) {
    throw new Error("Order not found");
  }

  const readFiles: SequencingDeliveryFileSummary[] = [];
  const artifactFiles: SequencingDeliveryFileSummary[] = [];
  const excluded = {
    missingCleanedReadFiles: 0,
    rawOrUnknownReadFiles: 0,
    missingCustomerArtifacts: 0,
    unsupportedCustomerArtifacts: 0,
    facilityArtifacts: 0,
  };

  for (const sample of order.samples) {
    for (const read of sample.reads) {
      const filePaths = [
        { direction: "R1" as const, filePath: read.file1 },
        { direction: "R2" as const, filePath: read.file2 },
      ].filter((item): item is { direction: "R1" | "R2"; filePath: string } =>
        Boolean(item.filePath)
      );

      if (!isCleanedRead(read)) {
        excluded.rawOrUnknownReadFiles += filePaths.length;
        continue;
      }

      for (const file of filePaths) {
        if (!hasAllowedExtension(file.filePath, config.allowedExtensions)) {
          excluded.missingCleanedReadFiles += 1;
          continue;
        }
        const size = await getExistingFileSize(dataBasePath, file.filePath);
        if (size === null) {
          excluded.missingCleanedReadFiles += 1;
          continue;
        }
        readFiles.push(readFileSummary({ read, ...file, size }));
      }
    }
  }

  for (const artifact of order.sequencingArtifacts) {
    if (artifact.visibility !== CUSTOMER_SEQUENCING_ARTIFACT_VISIBILITY) {
      excluded.facilityArtifacts += 1;
      continue;
    }

    if (!hasAllowedExtension(artifact.path, CUSTOMER_ARTIFACT_EXTENSIONS)) {
      excluded.unsupportedCustomerArtifacts += 1;
      continue;
    }

    const existingSize = await getExistingFileSize(dataBasePath, artifact.path);
    if (existingSize === null) {
      excluded.missingCustomerArtifacts += 1;
      continue;
    }
    artifactFiles.push(artifactFileSummary(artifact, existingSize ?? toNumber(artifact.size)));
  }

  return {
    orderId: order.id,
    orderName: order.name,
    isPublished: order.sequencingFilesPublishedAt !== null,
    publishedAt: order.sequencingFilesPublishedAt?.toISOString() ?? null,
    publishedBy: order.sequencingFilesPublishedBy,
    dataBasePathConfigured: Boolean(dataBasePath),
    readFiles,
    artifactFiles,
    excluded,
  };
}

export async function assertSequencingDeliveryAccess(
  orderId: string,
  user: DeliveryUser
) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      sequencingFilesPublishedAt: true,
    },
  });

  if (!order) {
    return { status: 404 as const, body: { error: "Order not found" } };
  }

  if (isFacilityAdmin(user)) return null;

  if (order.userId !== user.id) {
    return { status: 403 as const, body: { error: "Forbidden" } };
  }

  if (!order.sequencingFilesPublishedAt) {
    return {
      status: 403 as const,
      body: { error: "Sequencing files are not available for this order" },
    };
  }

  return null;
}
