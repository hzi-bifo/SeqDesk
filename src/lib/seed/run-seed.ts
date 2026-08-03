import * as fs from "fs/promises";
import * as path from "path";
import { gzipSync } from "zlib";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureWithinBase } from "@/lib/files";
import { inspectDataStoragePath } from "@/lib/files/data-storage-path-validation";
import { buildSimulatedFastq } from "@/lib/simulation/fastq";
import {
  buildDummySeedDataset,
  SEED_DUMMY_FOLDER_ROOT,
  SEED_DUMMY_MARKER,
} from "./dummy-orders";
import {
  getDummyDataCleanupPath,
  lockSiteSettingsExtraSettings,
  setDummyDataCleanupPath,
  setDummyDataEnabledFlag,
} from "./extra-settings-flag";
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

export class DummySeedInUseError extends Error {
  constructor(public readonly pipelineRunsCount: number) {
    super(
      `The demo dataset has ${pipelineRunsCount} linked pipeline run${
        pipelineRunsCount === 1 ? "" : "s"
      }. Delete those runs from Pipeline Runs before removing the demo dataset.`
    );
    this.name = "DummySeedInUseError";
  }
}

export class DummySeedCleanupPendingError extends Error {
  constructor() {
    super(
      "A partial demo dataset still exists. Remove the demo dataset first, then retry installation."
    );
    this.name = "DummySeedCleanupPendingError";
  }
}

export class DummySeedSubmissionError extends Error {
  constructor(public readonly submissionsCount: number) {
    super(
      "The demo dataset has ENA submission history or registered accessions. Delete test submissions through Admin → Submissions first. A production-submitted study cannot be wiped."
    );
    this.name = "DummySeedSubmissionError";
  }
}

export class DummySeedReferencesError extends Error {
  constructor(public readonly externalSamplesCount: number) {
    super(
      "Samples from other sequencing orders reference a seeded study. Reassign those samples before removing the demo dataset."
    );
    this.name = "DummySeedReferencesError";
  }
}

export class DummySeedStorageMismatchError extends Error {
  constructor() {
    super(
      "The demo dataset changed storage location while removal was starting. Nothing was deleted; refresh status and retry."
    );
    this.name = "DummySeedStorageMismatchError";
  }
}

export interface DummySeedStatus {
  seeded: boolean;
  databaseComplete: boolean;
  databasePresent: boolean;
  incomplete: boolean;
  ordersCount: number;
  studiesCount: number;
  samplesCount: number;
  readsCount: number;
  samplesWithSeedMetadataCount: number;
  sampleMetadataComplete: boolean;
  readPathsComplete: boolean;
  ordersByStatus: Record<string, number>;
  storedDataBasePath: string | null;
  pendingCleanupDataBasePath: string | null;
  storagePathConflict: boolean;
}

export interface DummySeedFilesystemStatus {
  folderPresent: boolean;
  referencedFilesCount: number;
  validFilesCount: number;
  invalidFilesCount: number;
  filesComplete: boolean;
}

export interface RemoveDummySeedOptions {
  ownerUserId: string;
  /**
   * Already-resolved absolute base path containing the seeded FASTQ folder.
   * May be absent when storage was unconfigured/unmounted after the rows were
   * created; database cleanup must still remain possible in that state.
   */
  resolvedBase?: string | null;
  /** Test seam for deterministic filesystem-failure coverage. */
  removeFolder?: (target: string) => Promise<void>;
}

export interface RemoveDummySeedResult {
  ordersDeleted: number;
  ticketLinksCleared: number;
  filesRemoved: boolean;
}

const DUMMY_SEED_EXPECTED_ORDERS = 4;
const DUMMY_SEED_EXPECTED_STUDIES = 2;
const DUMMY_SEED_EXPECTED_SAMPLES = 10;
const DUMMY_SEED_EXPECTED_READS = 12;
const GZIP_MAGIC_BYTE_1 = 0x1f;
const GZIP_MAGIC_BYTE_2 = 0x8b;

const DUMMY_SEED_TRANSACTION_OPTIONS = {
  maxWait: 30_000,
  timeout: 5 * 60_000,
} as const;

/**
 * Serialize mutations for one owner's deterministic fixture.
 *
 * Both the Settings route and the installed CLI can start this operation. The
 * generated order numbers and file paths are deliberately deterministic, so a
 * check-then-create race would otherwise let two callers write the same files.
 * PostgreSQL releases this transaction-scoped advisory lock automatically on
 * commit/rollback or when the connection closes.
 */
async function lockDummySeedOwner(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  ownerUserId: string
): Promise<void> {
  // pg_advisory_xact_lock returns PostgreSQL void, which Prisma cannot
  // deserialize from a raw SELECT. Cast it while preserving lock semantics.
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('seqdesk-dummy-seed'),
      hashtext(${ownerUserId})
    )::text AS locked
  `;
}

function getDummySeedFolder(
  ownerUserId: string,
  resolvedBase: string
): string {
  const relativeFolder = path.posix.join(
    SEED_DUMMY_FOLDER_ROOT,
    ownerUserId
  );
  ensureWithinBase(resolvedBase, relativeFolder);
  return path.resolve(resolvedBase, relativeFolder);
}

function collectStoredSeedPaths(
  values: Array<string | null | undefined>
): Set<string> {
  const storedPaths = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    try {
      const parsed = JSON.parse(value) as { seedDataBasePath?: unknown };
      if (
        typeof parsed.seedDataBasePath === "string" &&
        parsed.seedDataBasePath.trim()
      ) {
        storedPaths.add(path.resolve(parsed.seedDataBasePath));
      }
    } catch {
      // Marker discovery remains authoritative even if unrelated JSON metadata
      // was edited manually.
    }
  }
  return storedPaths;
}

/**
 * Report whether the deterministic fixture folder is still present.
 *
 * This is intentionally independent from the database status. If the process
 * exits after the database cleanup commits but before filesystem cleanup, a
 * later Settings/CLI removal can see and retry the orphaned folder.
 */
export async function getDummySeedFilesPresent(
  ownerUserId: string,
  resolvedBase: string | null | undefined,
  dependencies: {
    lstat?: (target: string) => Promise<unknown>;
  } = {}
): Promise<boolean> {
  if (!resolvedBase) return false;
  const inspection = await inspectDataStoragePath(resolvedBase);
  if (!inspection.valid || !inspection.configuredPath) return false;
  const seedFolder = getDummySeedFolder(
    ownerUserId,
    inspection.configuredPath
  );
  try {
    await (dependencies.lstat ?? fs.lstat)(seedFolder);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    // An unreadable/unmounted path is not safe to classify as absent.
    return true;
  }
}

export async function getDummySeedStatus(
  ownerUserId: string
): Promise<DummySeedStatus> {
  const [orders, studies, pendingCleanupPath] = await Promise.all([
    db.order.findMany({
      where: {
        userId: ownerUserId,
        customFields: { contains: `"seedSource":"${SEED_DUMMY_MARKER}"` },
      },
      select: {
        status: true,
        customFields: true,
        samples: {
          select: {
            customFields: true,
            checklistData: true,
            reads: {
              select: { file1: true, file2: true },
            },
          },
        },
      },
    }),
    db.study.findMany({
      where: {
        userId: ownerUserId,
        studyMetadata: {
          contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
        },
      },
      select: { studyMetadata: true },
    }),
    getDummyDataCleanupPath(ownerUserId),
  ]);
  const samples = orders.flatMap((order) => order.samples);
  const reads = samples.flatMap((sample) => sample.reads);
  const studiesCount = studies.length;
  const databasePresent = orders.length > 0 || studiesCount > 0;
  const samplesWithSeedMetadataCount = samples.filter((sample) => {
    try {
      const customFields = JSON.parse(sample.customFields ?? "") as unknown;
      const checklistData = JSON.parse(sample.checklistData ?? "") as unknown;
      return (
        Boolean(customFields) &&
        typeof customFields === "object" &&
        !Array.isArray(customFields) &&
        (customFields as Record<string, unknown>).seedSource ===
          SEED_DUMMY_MARKER &&
        Boolean(checklistData) &&
        typeof checklistData === "object" &&
        !Array.isArray(checklistData) &&
        Object.keys(checklistData as Record<string, unknown>).length > 0
      );
    } catch {
      return false;
    }
  }).length;
  const sampleMetadataComplete =
    samples.length === DUMMY_SEED_EXPECTED_SAMPLES &&
    samplesWithSeedMetadataCount === DUMMY_SEED_EXPECTED_SAMPLES;
  const readPathsComplete =
    reads.length === DUMMY_SEED_EXPECTED_READS &&
    reads.every(
      (read) =>
        typeof read.file1 === "string" &&
        Boolean(read.file1.trim()) &&
        (read.file2 === null ||
          (typeof read.file2 === "string" && Boolean(read.file2.trim())))
    );
  const databaseComplete =
    orders.length === DUMMY_SEED_EXPECTED_ORDERS &&
    studiesCount === DUMMY_SEED_EXPECTED_STUDIES &&
    sampleMetadataComplete &&
    readPathsComplete;
  const incomplete = databasePresent && !databaseComplete;
  const storedPaths = collectStoredSeedPaths([
    ...orders.map((order) => order.customFields),
    ...studies.map((study) => study.studyMetadata),
  ]);
  const pendingCleanupDataBasePath = pendingCleanupPath
    ? path.resolve(pendingCleanupPath)
    : null;
  if (pendingCleanupDataBasePath) {
    storedPaths.add(pendingCleanupDataBasePath);
  }

  return {
    seeded: databaseComplete,
    databaseComplete,
    databasePresent,
    incomplete,
    ordersCount: orders.length,
    studiesCount,
    samplesCount: samples.length,
    readsCount: reads.length,
    samplesWithSeedMetadataCount,
    sampleMetadataComplete,
    readPathsComplete,
    storedDataBasePath:
      storedPaths.size === 1 ? [...storedPaths][0] : null,
    pendingCleanupDataBasePath,
    storagePathConflict: storedPaths.size > 1,
    ordersByStatus: orders.reduce<Record<string, number>>((acc, order) => {
      acc[order.status] = (acc[order.status] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

async function isNonEmptyRegularGzipFile(
  dataBasePath: string,
  storedPath: string
): Promise<boolean> {
  let absolutePath: string;
  try {
    absolutePath = ensureWithinBase(dataBasePath, storedPath);
  } catch {
    return false;
  }

  try {
    const [realDataBasePath, realFilePath] = await Promise.all([
      fs.realpath(dataBasePath),
      fs.realpath(absolutePath),
    ]);
    ensureWithinBase(realDataBasePath, realFilePath);
    const stats = await fs.lstat(absolutePath);
    if (!stats.isFile() || stats.size < 2) return false;

    const handle = await fs.open(absolutePath, "r");
    try {
      const magic = Buffer.alloc(2);
      const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
      return (
        bytesRead === magic.length &&
        magic[0] === GZIP_MAGIC_BYTE_1 &&
        magic[1] === GZIP_MAGIC_BYTE_2
      );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/**
 * Validate the on-disk side of the deterministic fixture without returning
 * its paths. Folder presence is reported independently so an orphaned fixture
 * directory remains discoverable and removable after its database rows are
 * gone.
 */
export async function getDummySeedFilesystemStatus(
  ownerUserId: string,
  resolvedBase: string | null | undefined
): Promise<DummySeedFilesystemStatus> {
  const reads = await db.read.findMany({
    where: {
      sample: {
        order: {
          userId: ownerUserId,
          customFields: { contains: `"seedSource":"${SEED_DUMMY_MARKER}"` },
        },
      },
    },
    select: { file1: true, file2: true },
  });
  const referencedFiles = new Set<string>();
  for (const read of reads) {
    if (read.file1?.trim()) referencedFiles.add(read.file1.trim());
    if (read.file2?.trim()) referencedFiles.add(read.file2.trim());
  }

  const folderPresent = await getDummySeedFilesPresent(
    ownerUserId,
    resolvedBase
  );
  if (!resolvedBase) {
    return {
      folderPresent,
      referencedFilesCount: referencedFiles.size,
      validFilesCount: 0,
      invalidFilesCount: referencedFiles.size,
      filesComplete: false,
    };
  }

  const inspection = await inspectDataStoragePath(resolvedBase);
  if (!inspection.valid || !inspection.configuredPath) {
    return {
      folderPresent,
      referencedFilesCount: referencedFiles.size,
      validFilesCount: 0,
      invalidFilesCount: referencedFiles.size,
      filesComplete: false,
    };
  }

  const results = await Promise.all(
    [...referencedFiles].map((storedPath) =>
      isNonEmptyRegularGzipFile(inspection.configuredPath!, storedPath)
    )
  );
  const validFilesCount = results.filter(Boolean).length;
  const invalidFilesCount = referencedFiles.size - validFilesCount;
  return {
    folderPresent,
    referencedFilesCount: referencedFiles.size,
    validFilesCount,
    invalidFilesCount,
    filesComplete:
      folderPresent &&
      referencedFiles.size > 0 &&
      invalidFilesCount === 0,
  };
}

/**
 * Core dummy-seed workflow. Writes synthetic FASTQ files under resolvedBase and
 * creates the linked Study/Order/Sample/Read rows owned by ownerUserId.
 *
 * Used by:
 *  - the Admin → Settings demo-data control
 *  - the installed `seqdesk demo-data` CLI worker
 *
 * Throws {@link DummySeedAlreadyExistsError} if the owner already has seeded rows.
 * Callers must catch and decide whether to surface 409 or skip silently.
 */
export async function runDummySeed(
  options: RunDummySeedOptions
): Promise<RunDummySeedResult> {
  const { ownerUserId } = options;
  const storageInspection = await inspectDataStoragePath(options.resolvedBase);
  if (
    !storageInspection.valid ||
    !storageInspection.writable ||
    !storageInspection.configuredPath
  ) {
    throw new Error(
      storageInspection.error ??
        "The configured data storage is not readable and writable."
    );
  }
  const resolvedBase = storageInspection.configuredPath;

  const platformSelection = await selectPlatformForSeed();
  const dataset = buildDummySeedDataset({
    ownerUserId,
    dataBasePath: resolvedBase,
    primaryPlatform: platformSelection.primary,
    syntheticReadCount: options.syntheticReadCount,
    syntheticReadLength: options.syntheticReadLength,
  });

  const safeFolder = ensureWithinBase(resolvedBase, dataset.fastqRelativeFolder);
  let filesCreated = 0;
  let wroteFixtureFiles = false;

  let createdSummary: {
    studyId: string;
    studyScopedId: string;
    ordersCreated: number;
    samplesCreated: number;
    readsCreated: number;
  };
  try {
    createdSummary = await db.$transaction(async (tx) => {
      await lockDummySeedOwner(tx, ownerUserId);
      if (await getDummyDataCleanupPath(ownerUserId, tx)) {
        throw new DummySeedCleanupPendingError();
      }

      const [existingCount, existingStudiesCount] = await Promise.all([
        tx.order.count({
          where: {
            userId: ownerUserId,
            customFields: {
              contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
            },
          },
        }),
        tx.study.count({
          where: {
            userId: ownerUserId,
            studyMetadata: {
              contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
            },
          },
        }),
      ]);
      if (existingCount > 0) {
        throw new DummySeedAlreadyExistsError(existingCount);
      }
      if (existingStudiesCount > 0) {
        throw new DummySeedCleanupPendingError();
      }

      // A prior interrupted removal/install can leave the deterministic folder
      // without database rows. Do not overwrite it: removal after its database
      // commit may still be cleaning that exact path. Requiring an explicit
      // cleanup pass prevents a concurrent remover from deleting fresh files.
      try {
        await fs.lstat(safeFolder);
        throw new DummySeedCleanupPendingError();
      } catch (error) {
        if (error instanceof DummySeedCleanupPendingError) {
          throw error;
        }
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }

      await fs.mkdir(safeFolder, { recursive: true });
      wroteFixtureFiles = true;
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
              seedDataBasePath: resolvedBase,
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
              seedDataBasePath: resolvedBase,
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
                facilityStatus:
                  sample.reads.length > 0 ? "SEQUENCED" : "WAITING",
                facilityStatusUpdatedAt:
                  sample.reads.length > 0 ? new Date() : null,
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
    }, DUMMY_SEED_TRANSACTION_OPTIONS);
  } catch (error) {
    // A caller that only waited for the lock and then discovered an existing
    // fixture must never remove the successful caller's deterministic folder.
    if (wroteFixtureFiles) {
      await fs.rm(safeFolder, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }

  // Record the persisted intent in installation config so it shows in dumps and so
  // future tooling (seqdesk.org install profiles, etc.) can read it. Best-effort —
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
 * Remove only the deterministic fixture owned by one user.
 *
 * This shares the same advisory lock as installation, so a CLI removal cannot
 * race the Settings switch (or another CLI install) for the same owner.
 */
export async function removeDummySeed(
  options: RemoveDummySeedOptions
): Promise<RemoveDummySeedResult> {
  const { ownerUserId, resolvedBase } = options;
  const removeFolder =
    options.removeFolder ??
    ((target: string) =>
      fs.rm(target, { recursive: true, force: true }));
  const storageInspection = resolvedBase
    ? await inspectDataStoragePath(resolvedBase)
    : null;
  const removableBase =
    storageInspection?.valid &&
    storageInspection.writable &&
    storageInspection.configuredPath
      ? storageInspection.configuredPath
      : null;
  const seedFolder = removableBase
    ? getDummySeedFolder(ownerUserId, removableBase)
    : null;

  const databaseCleanup = await db.$transaction(async (tx) => {
    await lockDummySeedOwner(tx, ownerUserId);
    await lockSiteSettingsExtraSettings(tx);

    const [orders, studies, pendingCleanupPath] = await Promise.all([
      tx.order.findMany({
        where: {
          userId: ownerUserId,
          customFields: {
            contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
          },
        },
        select: { id: true, customFields: true },
      }),
      tx.study.findMany({
        where: {
          userId: ownerUserId,
          studyMetadata: {
            contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
          },
        },
        select: {
          id: true,
          submitted: true,
          studyAccessionId: true,
          studyMetadata: true,
        },
      }),
      getDummyDataCleanupPath(ownerUserId, tx),
    ]);
    const orderIds = orders.map((order) => order.id);
    const studyIds = studies.map((study) => study.id);
    const lockedStoredPaths = collectStoredSeedPaths([
      ...orders.map((order) => order.customFields),
      ...studies.map((study) => study.studyMetadata),
    ]);
    if (pendingCleanupPath) {
      lockedStoredPaths.add(path.resolve(pendingCleanupPath));
    }
    const lockedStoredBase =
      lockedStoredPaths.size === 1 ? [...lockedStoredPaths][0] : null;
    if (
      lockedStoredPaths.size > 1 ||
      (lockedStoredBase &&
        (!removableBase ||
          path.resolve(removableBase) !== lockedStoredBase))
    ) {
      throw new DummySeedStorageMismatchError();
    }
    const cleanupBase = lockedStoredBase ?? removableBase;

    if (orderIds.length > 0 || studyIds.length > 0) {
      // Pipeline deletion has its own cancellation, scheduler identity, output
      // writeback and run-folder lifecycle. Never bypass it from fixture cleanup:
      // the operator must delete linked runs through Pipeline Runs first.
      const pipelineRunsCount = await tx.pipelineRun.count({
        where: {
          OR: [
            ...(orderIds.length > 0
              ? [{ orderId: { in: orderIds } }]
              : []),
            ...(studyIds.length > 0
              ? [{ studyId: { in: studyIds } }]
              : []),
          ],
        },
      });
      if (pipelineRunsCount > 0) {
        throw new DummySeedInUseError(pipelineRunsCount);
      }
    }

    const externalSamplesCount =
      studyIds.length > 0
        ? await tx.sample.count({
            where: {
              studyId: { in: studyIds },
              ...(orderIds.length > 0
                ? { orderId: { notIn: orderIds } }
                : {}),
            },
          })
        : 0;
    if (externalSamplesCount > 0) {
      throw new DummySeedReferencesError(externalSamplesCount);
    }

    let samples: Array<{
      id: string;
      sampleId: string;
      sampleAccessionNumber: string | null;
    }> = [];
    if (orderIds.length > 0) {
      samples = await tx.sample.findMany({
        where: { orderId: { in: orderIds } },
        select: {
          id: true,
          sampleId: true,
          sampleAccessionNumber: true,
        },
      });
    }
    const sampleIds = samples.map((sample) => sample.id);

    const registeredStudyCount = studies.filter(
      (study) => study.submitted || Boolean(study.studyAccessionId)
    ).length;
    const registeredSampleCount = samples.filter((sample) =>
      Boolean(sample.sampleAccessionNumber)
    ).length;
    const submissionTargets = [
      ...orderIds,
      ...studyIds,
      ...sampleIds,
      ...samples.map((sample) => sample.sampleId),
    ];
    const submissionsCount =
      submissionTargets.length > 0
        ? await tx.submission.count({
            where: { entityId: { in: submissionTargets } },
          })
        : 0;
    if (
      submissionsCount > 0 ||
      registeredStudyCount > 0 ||
      registeredSampleCount > 0
    ) {
      throw new DummySeedSubmissionError(
        submissionsCount + registeredStudyCount + registeredSampleCount
      );
    }

    if (cleanupBase) {
      await setDummyDataCleanupPath(ownerUserId, cleanupBase, tx);
    }

    if (sampleIds.length > 0) {
      await tx.assembly.deleteMany({
        where: { sampleId: { in: sampleIds } },
      });
      await tx.bin.deleteMany({
        where: { sampleId: { in: sampleIds } },
      });
    }

    let ticketLinksCleared = 0;
    if (studyIds.length > 0) {
      const result = await tx.ticket.updateMany({
        where: { studyId: { in: studyIds } },
        data: { studyId: null },
      });
      ticketLinksCleared += result.count;
    }
    if (orderIds.length > 0) {
      const result = await tx.ticket.updateMany({
        where: { orderId: { in: orderIds } },
        data: { orderId: null },
      });
      ticketLinksCleared += result.count;
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (studyIds.length > 0) {
      await tx.study.deleteMany({ where: { id: { in: studyIds } } });
    }
    return {
      ordersDeleted: orders.length,
      ticketLinksCleared,
    };
  }, DUMMY_SEED_TRANSACTION_OPTIONS);

  // Database cleanup is authoritative and commits before filesystem removal.
  // Re-acquire the owner lock for the filesystem phase and verify a concurrent
  // reinstall did not win the gap. Holding the lock through rm prevents a
  // second remover from deleting files created by a fresh install.
  let filesRemoved = false;
  if (seedFolder) {
    filesRemoved = await db.$transaction(async (tx) => {
      await lockDummySeedOwner(tx, ownerUserId);
      const [replacementOrders, replacementStudies] = await Promise.all([
        tx.order.count({
          where: {
            userId: ownerUserId,
            customFields: {
              contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
            },
          },
        }),
        tx.study.count({
          where: {
            userId: ownerUserId,
            studyMetadata: {
              contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
            },
          },
        }),
      ]);
      if (replacementOrders > 0 || replacementStudies > 0) {
        return false;
      }
      try {
        await removeFolder(seedFolder);
        await lockSiteSettingsExtraSettings(tx);
        await setDummyDataCleanupPath(ownerUserId, null, tx);
        return true;
      } catch (error) {
        console.error(
          "[Seed Dummy Data] Failed to remove seeded folder:",
          error
        );
        return false;
      }
    }, DUMMY_SEED_TRANSACTION_OPTIONS);
  }

  try {
    const [remainingSeededOrders, remainingSeededStudies] =
      await Promise.all([
        db.order.count({
          where: {
            customFields: {
              contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
            },
          },
        }),
        db.study.count({
          where: {
            studyMetadata: {
              contains: `"seedSource":"${SEED_DUMMY_MARKER}"`,
            },
          },
        }),
      ]);
    await setDummyDataEnabledFlag(
      remainingSeededOrders > 0 || remainingSeededStudies > 0
    );
  } catch (error) {
    console.warn(
      "[Seed Dummy Data] Failed to update dummyDataEnabled flag:",
      error
    );
  }

  return {
    ...databaseCleanup,
    filesRemoved,
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
  const inspection = await inspectDataStoragePath(path.resolve(basePath));
  return inspection.valid && inspection.writable
    ? inspection.configuredPath ?? null
    : null;
}
