import { db } from "@/lib/db";

// A small, deterministic SPIKED example dataset for the read-cleaning pipeline. Each
// sample mixes synthetic human-mitochondrial reads (host contamination, expected
// REMOVED by nf-core/detaxizer + kraken2) with E. coli reads (retained), so the E2E
// can make a deterministic contamination-removal assertion: after cleaning, each
// sample keeps ~the microbial reads and the human reads are gone.
//
// The bundle is produced by scripts/build-read-cleaning-fixture.mjs as a single hosted
// `downloadedFastqBundle` tar.gz (manifest.json + reads/<sampleId>.fastq.gz). Unlike the
// MAG smoke dataset (which downloads two separate public fastqs and re-packs them), this
// source.url IS the bundle archive, so we just declare {url, sha256} and let the shared
// install-profile fixture machinery download + verify + extract + create the
// order/study/samples/reads. The manifest marks every sample dataClass:"raw" so
// read-cleaning is eligible (it requires raw/unknown reads).

export const READ_CLEANING_SPIKE_PROFILE_ID = "dev";
export const READ_CLEANING_SPIKE_FIXTURE_ID = "read-cleaning-spiked-ont-3sample";
export const READ_CLEANING_SPIKE_ORDER_NUMBER = "DEV-RC-SPIKE-001";
export const READ_CLEANING_SPIKE_STUDY_ALIAS = "read-cleaning-spike";
const READ_CLEANING_SPIKE_READ_PREFIX = `fixtures/${READ_CLEANING_SPIKE_PROFILE_ID}/${READ_CLEANING_SPIKE_FIXTURE_ID}/reads/`;

// The hosted spiked bundle. Host the EXACT tar.gz that build-read-cleaning-fixture.mjs
// emits; its sha256 is pinned here so the download is integrity-checked. The URL is
// env-overridable (SEQDESK_READ_CLEANING_SPIKE_URL) so CI / a staging host can point at
// the archive without a code change.
const READ_CLEANING_SPIKE_BUNDLE = {
  url:
    process.env.SEQDESK_READ_CLEANING_SPIKE_URL ||
    "https://seqdesk.org/example-datasets/read-cleaning-spiked-ont-3sample.tar.gz",
  sha256:
    process.env.SEQDESK_READ_CLEANING_SPIKE_SHA256 ||
    "602e404a4db708d4deb7a6c134db85fcb941435e05616fa5338377be25895fd9",
};

type PrismaLike = typeof db;

interface SeedLogger {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

interface SeedActivity {
  update?: (update: Record<string, unknown>) => Promise<void> | void;
}

interface ApplyProfileSeedDataResult {
  skipped?: boolean;
  seeded: number;
  results?: Array<{ fixtureId?: string; orderNumber?: string; samples?: number; sha256?: string }>;
}

export interface ReadCleaningSpikeExampleStatus {
  seeded: boolean;
  orderNumber: string;
  orderId: string | null;
  orderStatus: string | null;
  studyId: string | null;
  samplesCount: number;
  readsCount: number;
  sourceUrl: string;
}

/**
 * Provision the read-cleaning spiked example dataset: download the hosted bundle tar.gz,
 * verify its SHA256, extract it, and create a real order/study/sample/read via the shared
 * install-profile fixture machinery (the same path the hosted-profile fixtures use).
 */
export async function seedReadCleaningSpikeExampleDataset({
  prisma = db,
  rootDir = process.cwd(),
  logger = console,
  activity,
}: {
  prisma?: PrismaLike;
  rootDir?: string;
  logger?: SeedLogger;
  activity?: SeedActivity;
} = {}): Promise<ApplyProfileSeedDataResult> {
  const seedModule = (await import("../../../scripts/lib/install-profile-assets.mjs")) as {
    applyProfileSeedData: (input: {
      prisma: PrismaLike;
      profile: unknown;
      rootDir?: string;
      logger?: SeedLogger;
      activity?: SeedActivity;
    }) => Promise<ApplyProfileSeedDataResult>;
  };

  const profile = {
    id: READ_CLEANING_SPIKE_PROFILE_ID,
    seedData: {
      enabled: true,
      fixtures: [
        {
          id: READ_CLEANING_SPIKE_FIXTURE_ID,
          kind: "exampleDataset",
          orderNumber: READ_CLEANING_SPIKE_ORDER_NUMBER,
          source: {
            type: "downloadedFastqBundle",
            url: READ_CLEANING_SPIKE_BUNDLE.url,
            sha256: READ_CLEANING_SPIKE_BUNDLE.sha256,
          },
        },
      ],
    },
  };

  await activity?.update?.({ phase: "seeding", targetPath: READ_CLEANING_SPIKE_FIXTURE_ID });
  return seedModule.applyProfileSeedData({ prisma, profile, rootDir, logger, activity });
}

export async function getReadCleaningSpikeExampleStatus(
  prisma: PrismaLike = db,
): Promise<ReadCleaningSpikeExampleStatus> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: READ_CLEANING_SPIKE_ORDER_NUMBER },
    select: {
      id: true,
      status: true,
      samples: {
        select: {
          id: true,
          studyId: true,
          reads: { select: { id: true, file1: true } },
        },
      },
    },
  });

  const samples = order?.samples ?? [];
  const readsCount = samples.reduce(
    (total, sample) =>
      total + sample.reads.filter((r) => r.file1?.startsWith(READ_CLEANING_SPIKE_READ_PREFIX)).length,
    0,
  );
  const studyId = samples.find((sample) => sample.studyId)?.studyId ?? null;

  return {
    seeded: Boolean(order) && samples.length > 0 && readsCount > 0,
    orderNumber: READ_CLEANING_SPIKE_ORDER_NUMBER,
    orderId: order?.id ?? null,
    orderStatus: order?.status ?? null,
    studyId,
    samplesCount: samples.length,
    readsCount,
    sourceUrl: READ_CLEANING_SPIKE_BUNDLE.url,
  };
}
