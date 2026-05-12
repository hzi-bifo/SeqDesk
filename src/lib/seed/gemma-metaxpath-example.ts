import { db } from "@/lib/db";

export const GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID =
  "gemma-nanopore-metaxpath-5sample";
export const GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER = "DEV-GEMMA-ONT-001";
export const GEMMA_METAXPATH_EXAMPLE_STUDY_ALIAS =
  "gemma-nanopore-metaxpath";
export const GEMMA_METAXPATH_EXAMPLE_BUNDLE_URL =
  "https://research.bifo.helmholtz-hzi.de/downloads/genomenet/gemma_nanopore_metaxpath_5sample_seqdesk.tar.gz";
export const GEMMA_METAXPATH_EXAMPLE_BUNDLE_SHA256 =
  "a05363abca66b4012caf9953a4a5beb6062e668334860efb4276718e8143e2ad";

type PrismaLike = typeof db;

interface SeedLogger {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
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
  orderNumber: string;
  orderId: string | null;
  orderStatus: string | null;
  studyId: string | null;
  samplesCount: number;
  readsCount: number;
  sourceUrl: string;
  sha256: string;
}

export function getGemmaMetaxPathExampleProfile() {
  return {
    id: "dev",
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
        samples: {
          select: {
            id: true,
            reads: { select: { id: true } },
          },
        },
      },
    }),
    prisma.study.findFirst({
      where: { alias: GEMMA_METAXPATH_EXAMPLE_STUDY_ALIAS },
      select: { id: true },
    }),
  ]);

  return {
    seeded: Boolean(order),
    orderNumber: GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER,
    orderId: order?.id ?? null,
    orderStatus: order?.status ?? null,
    studyId: study?.id ?? null,
    samplesCount: order?.samples.length ?? 0,
    readsCount:
      order?.samples.reduce((count, sample) => count + sample.reads.length, 0) ??
      0,
    sourceUrl: GEMMA_METAXPATH_EXAMPLE_BUNDLE_URL,
    sha256: GEMMA_METAXPATH_EXAMPLE_BUNDLE_SHA256,
  };
}

export async function seedGemmaMetaxPathExampleDataset({
  prisma = db,
  rootDir = process.cwd(),
  logger = console,
}: {
  prisma?: PrismaLike;
  rootDir?: string;
  logger?: SeedLogger;
} = {}): Promise<ApplyProfileSeedDataResult> {
  const module = (await import(
    "../../../scripts/lib/install-profile-assets.mjs"
  )) as {
    applyProfileSeedData: (input: {
      prisma: PrismaLike;
      profile: ReturnType<typeof getGemmaMetaxPathExampleProfile>;
      rootDir?: string;
      logger?: SeedLogger;
    }) => Promise<ApplyProfileSeedDataResult>;
  };

  return module.applyProfileSeedData({
    prisma,
    profile: getGemmaMetaxPathExampleProfile(),
    rootDir,
    logger,
  });
}
