import * as fs from "fs/promises";
import * as path from "path";
import { gzipSync } from "zlib";
import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import { buildSimulatedFastq } from "@/lib/simulation/fastq";
import {
  buildDummySeedDataset,
  getSeedDummyOrderNumberPrefix,
  SEED_DUMMY_MARKER,
} from "./dummy-orders";
import { setDummyDataEnabledFlag } from "./extra-settings-flag";
import { selectPlatformForSeed } from "./select-platform";

export interface RunDummySeedOptions {
  ownerUserId: string;
  /** Already-resolved absolute base path; caller is responsible for verifying writability. */
  resolvedBase: string;
  /** Display name + email for Order.contactName / contactEmail. */
  ownerEmail?: string | null;
  ownerDisplayName?: string;
  /**
   * Synthetic reads per FASTQ. Overrides the SEQDESK_SEED_READ_COUNT env var and the
   * built-in default. Used by heavy pipelines (mag assembly) that need larger inputs.
   */
  syntheticReadCount?: number;
  /** Synthetic read length. Overrides SEQDESK_SEED_READ_LENGTH and the default. */
  syntheticReadLength?: number;
}

export interface RunDummySeedResult {
  ordersCreated: number;
  samplesCreated: number;
  readsCreated: number;
  filesCreated: number;
  /** Primary gut-recovery study. */
  studyId: string;
  /** Dedicated study-scoped dataset (study-level pipeline target). */
  studyScopedId: string;
  dataPath: string;
  /** Synthetic read count/length actually used (after resolving options/env/defaults). */
  syntheticReadCount: number;
  syntheticReadLength: number;
  platform: {
    platform: string;
    instrumentModel: string;
    pairedEnd: boolean;
    fromConfiguredDevice: boolean;
  };
}

export class DummySeedAlreadyExistsError extends Error {
  constructor(public readonly ordersCount: number) {
    super(`Dummy seed data already exists (${ordersCount} orders).`);
    this.name = "DummySeedAlreadyExistsError";
  }
}

/**
 * Core dummy-seed workflow. Writes synthetic FASTQ files under resolvedBase and
 * creates the linked Study/Order/Sample/Read rows owned by ownerUserId.
 *
 * Used by:
 *  - the admin "Seed dummy data" button ([src/app/api/admin/seed/dummy-data/route.ts])
 *  - the auto-seed-on-install hook ([src/lib/auto-seed.ts]) when the
 *    SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA env var is set
 *
 * Throws {@link DummySeedAlreadyExistsError} if the owner already has seeded rows.
 * Callers must catch and decide whether to surface 409 or skip silently.
 */
export async function runDummySeed(
  options: RunDummySeedOptions
): Promise<RunDummySeedResult> {
  const { ownerUserId, resolvedBase } = options;

  const orderPrefix = getSeedDummyOrderNumberPrefix(ownerUserId);
  const existingCount = await db.order.count({
    where: { userId: ownerUserId, orderNumber: { startsWith: orderPrefix } },
  });
  if (existingCount > 0) {
    throw new DummySeedAlreadyExistsError(existingCount);
  }

  const platformSelection = await selectPlatformForSeed();
  const dataset = buildDummySeedDataset({
    ownerUserId,
    dataBasePath: resolvedBase,
    primaryPlatform: platformSelection.primary,
    syntheticReadCount: options.syntheticReadCount,
    syntheticReadLength: options.syntheticReadLength,
  });

  const safeFolder = ensureWithinBase(resolvedBase, dataset.fastqRelativeFolder);
  await fs.mkdir(safeFolder, { recursive: true });

  let filesCreated = 0;
  try {
    for (const target of dataset.sampleFastqTargets) {
      ensureWithinBase(resolvedBase, target.file1Relative);
      if (target.file2Relative) {
        ensureWithinBase(resolvedBase, target.file2Relative);
      }

      const reads = buildSimulatedFastq({
        sampleId: target.sampleId,
        sampleIndex: target.sampleIndex,
        readCount: dataset.syntheticReadCount,
        readLength: dataset.syntheticReadLength,
        pairedEnd: target.pairedEnd,
      });
      await fs.writeFile(target.file1Absolute, gzipSync(reads.read1));
      filesCreated += 1;
      if (reads.read2 && target.file2Absolute) {
        await fs.writeFile(target.file2Absolute, gzipSync(reads.read2));
        filesCreated += 1;
      }
    }
  } catch (error) {
    await fs.rm(safeFolder, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  let createdSummary: {
    studyId: string;
    studyScopedId: string;
    ordersCreated: number;
    samplesCreated: number;
    readsCreated: number;
  };
  try {
    createdSummary = await db.$transaction(async (tx) => {
      const createStudy = (spec: typeof dataset.study) =>
        tx.study.create({
          data: {
            title: spec.title,
            alias: spec.alias,
            description: spec.description,
            checklistType: spec.checklistType,
            studyMetadata: JSON.stringify({
              principal_investigator: spec.principalInvestigator,
              study_abstract: spec.abstract,
              seedSource: SEED_DUMMY_MARKER,
            }),
            readyForSubmission: spec.readyForSubmission,
            readyAt: spec.readyForSubmission ? new Date() : null,
            userId: ownerUserId,
          },
        });

      const study = await createStudy(dataset.study);
      const studyScoped = await createStudy(dataset.studyScoped);
      const studyIdByLink: Record<"primary" | "study", string> = {
        primary: study.id,
        study: studyScoped.id,
      };

      let ordersCreated = 0;
      let samplesCreated = 0;
      let readsCreated = 0;

      for (const orderSpec of dataset.orders) {
        const linkedStudyId = orderSpec.studyLink
          ? studyIdByLink[orderSpec.studyLink]
          : null;

        const order = await tx.order.create({
          data: {
            orderNumber: orderSpec.orderNumber,
            name: orderSpec.name,
            status: orderSpec.status,
            statusUpdatedAt: new Date(),
            numberOfSamples: orderSpec.numberOfSamples,
            contactName: options.ownerDisplayName ?? "Seed Dummy Data",
            contactEmail: options.ownerEmail ?? null,
            platform: orderSpec.platform ?? null,
            instrumentModel: orderSpec.instrumentModel,
            libraryStrategy: orderSpec.libraryStrategy,
            librarySource: orderSpec.librarySource,
            customFields: JSON.stringify({
              _sequencing_tech: orderSpec.sequencingTechSelection,
              seedSource: SEED_DUMMY_MARKER,
            }),
            userId: ownerUserId,
            samples: {
              create: orderSpec.samples.map((sample) => ({
                sampleId: sample.sampleId,
                sampleAlias: sample.sampleAlias,
                sampleTitle: sample.sampleTitle,
                scientificName: sample.scientificName,
                taxId: sample.taxId,
                checklistData:
                  Object.keys(sample.checklistData).length > 0
                    ? JSON.stringify(sample.checklistData)
                    : null,
                customFields: JSON.stringify({
                  ...sample.customFields,
                  seedSource: SEED_DUMMY_MARKER,
                }),
                ...(linkedStudyId
                  ? { study: { connect: { id: linkedStudyId } } }
                  : {}),
                ...(sample.reads.length > 0
                  ? {
                      reads: {
                        create: sample.reads.map((read) => ({
                          file1: read.file1Relative,
                          file2: read.file2Relative ?? null,
                          dataClass: read.dataClass,
                          dataClassSource: read.dataClassSource,
                          isActive: read.isActive,
                        })),
                      },
                    }
                  : {}),
              })),
            },
          },
          include: { samples: { include: { reads: true } } },
        });

        ordersCreated += 1;
        samplesCreated += order.samples.length;
        readsCreated += order.samples.reduce(
          (count, sample) => count + sample.reads.length,
          0
        );
      }

      return {
        studyId: study.id,
        studyScopedId: studyScoped.id,
        ordersCreated,
        samplesCreated,
        readsCreated,
      };
    });
  } catch (error) {
    await fs.rm(safeFolder, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  // Record the persisted intent in installation config so it shows in dumps and so
  // future tooling (seqdesk.com install profiles, etc.) can read it. Best-effort —
  // an error here doesn't unwind the seed itself.
  await setDummyDataEnabledFlag(true).catch((error) => {
    console.warn(
      "[runDummySeed] Failed to persist dummyDataEnabled flag:",
      error
    );
  });

  return {
    ordersCreated: createdSummary.ordersCreated,
    samplesCreated: createdSummary.samplesCreated,
    readsCreated: createdSummary.readsCreated,
    filesCreated,
    studyId: createdSummary.studyId,
    studyScopedId: createdSummary.studyScopedId,
    dataPath: dataset.fastqRelativeFolder,
    syntheticReadCount: dataset.syntheticReadCount,
    syntheticReadLength: dataset.syntheticReadLength,
    platform: {
      platform: platformSelection.primary.platform,
      instrumentModel: platformSelection.primary.instrumentModel,
      pairedEnd: platformSelection.primary.pairedEnd,
      fromConfiguredDevice: platformSelection.fromConfiguredDevice,
    },
  };
}

/**
 * Best-effort path resolver for auto-seed: returns the absolute base path if it
 * exists and is writable, otherwise null.
 */
export async function resolveWritableBase(
  basePath: string | null | undefined
): Promise<string | null> {
  if (!basePath) return null;
  try {
    const resolved = path.resolve(basePath);
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) return null;
    await fs.access(resolved, fs.constants.W_OK);
    return resolved;
  } catch {
    return null;
  }
}
