import { db } from "@/lib/db";

export const GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID =
  "gemma-nanopore-metaxpath-5sample";
export const GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER = "DEV-GEMMA-ONT-001";
export const GEMMA_METAXPATH_EXAMPLE_STUDY_ALIAS =
  "gemma-nanopore-metaxpath";
export const GEMMA_METAXPATH_EXAMPLE_PROFILE_ID = "dev";
export const GEMMA_METAXPATH_EXAMPLE_BUNDLE_URL =
  "https://research.bifo.helmholtz-hzi.de/downloads/genomenet/gemma_nanopore_metaxpath_5sample_seqdesk.tar.gz";
export const GEMMA_METAXPATH_EXAMPLE_BUNDLE_SHA256 =
  "a05363abca66b4012caf9953a4a5beb6062e668334860efb4276718e8143e2ad";
const GEMMA_METAXPATH_EXAMPLE_EXPECTED_SAMPLES = 5;
const GEMMA_METAXPATH_EXAMPLE_EXPECTED_READS = 5;
const GEMMA_METAXPATH_EXAMPLE_READ_PREFIX = `fixtures/${GEMMA_METAXPATH_EXAMPLE_PROFILE_ID}/${GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID}/reads/`;

type PrismaLike = typeof db;
export type GemmaMetaxPathFixtureState = "missing" | "applied" | "changed";

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
  results?: Array<{
    fixtureId?: string;
    orderNumber?: string;
    samples?: number;
    sourceUrl?: string;
    archivePath?: string;
    sha256?: string;
  }>;
}

export interface GemmaMetaxPathExampleStatus {
  seeded: boolean;
  fixtureState: GemmaMetaxPathFixtureState;
  fixtureIssues: string[];
  orderNumber: string;
  orderId: string | null;
  orderStatus: string | null;
  studyId: string | null;
  samplesCount: number;
  readsCount: number;
  sourceUrl: string;
  sha256: string;
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function hasExpectedFixtureMarker(value: string | null | undefined): boolean {
  const marker = parseJsonRecord(value)._installProfileFixture;
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
    return false;
  }
  const record = marker as Record<string, unknown>;
  return (
    record.profileId === GEMMA_METAXPATH_EXAMPLE_PROFILE_ID &&
    record.fixtureId === GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID
  );
}

function readLinkIsFromFixture(filePath: string | null | undefined): boolean {
  return typeof filePath === "string" && filePath.startsWith(GEMMA_METAXPATH_EXAMPLE_READ_PREFIX);
}

export function getGemmaMetaxPathExampleProfile() {
  return {
    id: GEMMA_METAXPATH_EXAMPLE_PROFILE_ID,
    seedData: {
      enabled: true,
      fixtures: [
        {
          id: GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID,
          kind: "exampleDataset",
          orderNumber: GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER,
          source: {
            type: "downloadedFastqBundle",
            url: GEMMA_METAXPATH_EXAMPLE_BUNDLE_URL,
            sha256: GEMMA_METAXPATH_EXAMPLE_BUNDLE_SHA256,
          },
        },
      ],
    },
  };
}

export async function getGemmaMetaxPathExampleStatus(
  prisma: PrismaLike = db
): Promise<GemmaMetaxPathExampleStatus> {
  const [order, study] = await Promise.all([
    prisma.order.findUnique({
      where: { orderNumber: GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER },
      select: {
        id: true,
        status: true,
        customFields: true,
        samples: {
          select: {
            id: true,
            customFields: true,
            reads: { select: { id: true, file1: true, file2: true } },
          },
        },
      },
    }),
    prisma.study.findFirst({
      where: { alias: GEMMA_METAXPATH_EXAMPLE_STUDY_ALIAS },
      select: { id: true, studyMetadata: true },
    }),
  ]);

  const samplesCount = order?.samples.length ?? 0;
  const readsCount =
    order?.samples.reduce((count, sample) => count + sample.reads.length, 0) ??
    0;
  const fixtureIssues: string[] = [];

  if (!order && !study) {
    return {
      seeded: false,
      fixtureState: "missing",
      fixtureIssues,
      orderNumber: GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER,
      orderId: null,
      orderStatus: null,
      studyId: null,
      samplesCount: 0,
      readsCount: 0,
      sourceUrl: GEMMA_METAXPATH_EXAMPLE_BUNDLE_URL,
      sha256: GEMMA_METAXPATH_EXAMPLE_BUNDLE_SHA256,
    };
  }

  if (!order) {
    fixtureIssues.push(
      `Seed order ${GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER} is missing.`
    );
  } else {
    if (order.status !== "SUBMITTED") {
      fixtureIssues.push(
        `Expected order status SUBMITTED, found ${order.status || "unknown"}.`
      );
    }
    if (samplesCount !== GEMMA_METAXPATH_EXAMPLE_EXPECTED_SAMPLES) {
      fixtureIssues.push(
        `Expected ${GEMMA_METAXPATH_EXAMPLE_EXPECTED_SAMPLES} samples, found ${samplesCount}.`
      );
    }
    if (readsCount !== GEMMA_METAXPATH_EXAMPLE_EXPECTED_READS) {
      fixtureIssues.push(
        `Expected ${GEMMA_METAXPATH_EXAMPLE_EXPECTED_READS} read sets, found ${readsCount}.`
      );
    }
    if (!hasExpectedFixtureMarker(order.customFields)) {
      fixtureIssues.push("Order fixture marker is missing or does not match.");
    }
    if (
      order.samples.some(
        (sample) => !hasExpectedFixtureMarker(sample.customFields)
      )
    ) {
      fixtureIssues.push("One or more sample fixture markers are missing or changed.");
    }
    if (
      order.samples.some((sample) =>
        sample.reads.some(
          (read) =>
            !readLinkIsFromFixture(read.file1) ||
            (read.file2 !== null && !readLinkIsFromFixture(read.file2))
        )
      )
    ) {
      fixtureIssues.push(
        "One or more read file links no longer point to the fixture reads folder."
      );
    }
  }

  if (!study) {
    fixtureIssues.push(
      `Seed study ${GEMMA_METAXPATH_EXAMPLE_STUDY_ALIAS} is missing.`
    );
  } else if (!hasExpectedFixtureMarker(study.studyMetadata)) {
    fixtureIssues.push("Study fixture marker is missing or does not match.");
  }

  return {
    seeded: Boolean(order),
    fixtureState: fixtureIssues.length === 0 ? "applied" : "changed",
    fixtureIssues,
    orderNumber: GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER,
    orderId: order?.id ?? null,
    orderStatus: order?.status ?? null,
    studyId: study?.id ?? null,
    samplesCount,
    readsCount,
    sourceUrl: GEMMA_METAXPATH_EXAMPLE_BUNDLE_URL,
    sha256: GEMMA_METAXPATH_EXAMPLE_BUNDLE_SHA256,
  };
}

export async function seedGemmaMetaxPathExampleDataset({
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
  const seedModule = (await import(
    "../../../scripts/lib/install-profile-assets.mjs"
  )) as {
    applyProfileSeedData: (input: {
      prisma: PrismaLike;
      profile: ReturnType<typeof getGemmaMetaxPathExampleProfile>;
      rootDir?: string;
      logger?: SeedLogger;
      activity?: SeedActivity;
    }) => Promise<ApplyProfileSeedDataResult>;
  };

  return seedModule.applyProfileSeedData({
    prisma,
    profile: getGemmaMetaxPathExampleProfile(),
    rootDir,
    logger,
    activity,
  });
}
