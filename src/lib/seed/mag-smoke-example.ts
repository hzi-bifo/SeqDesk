import { promises as fsp, readFileSync } from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";

import { db } from "@/lib/db";

// A tiny, public, paired-end metagenome example dataset for the MAG pipeline. Unlike the Gemma
// MetaxPath dataset (whose source URL lives only in the gated hosted profile), nf-core/mag's
// test reads are PUBLIC, so the source is declared here in the repo. It is provisioned as a real
// order/study/sample/read (so it appears like a normal dataset) by reusing the exact, tested
// install-profile fixture machinery: we pre-stage a downloadedFastqBundle archive (manifest.json
// + the two reads) at the path the extractor expects, then call applyProfileSeedData — which sees
// the archive already present with a matching SHA256 and skips the download, then extracts it and
// creates the order/study/samples. No change to the shared seed code is required.

export const MAG_SMOKE_PROFILE_ID = "dev";
export const MAG_SMOKE_FIXTURE_ID = "mag-smoke-minigut";
export const MAG_SMOKE_ORDER_NUMBER = "DEV-MAG-ILMN-001";
export const MAG_SMOKE_STUDY_ALIAS = "mag-smoke-minigut";
const MAG_SMOKE_READ_PREFIX = `fixtures/${MAG_SMOKE_PROFILE_ID}/${MAG_SMOKE_FIXTURE_ID}/reads/`;

// nf-core/mag 3.0.0 test reads (tiny minigut paired-end metagenome, a few MB).
const MAG_SMOKE_READS = {
  r1: "https://github.com/nf-core/test-datasets/raw/mag/test_data/test_minigut_R1.fastq.gz",
  r2: "https://github.com/nf-core/test-datasets/raw/mag/test_data/test_minigut_R2.fastq.gz",
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

export interface MagSmokeExampleStatus {
  seeded: boolean;
  orderNumber: string;
  orderId: string | null;
  orderStatus: string | null;
  studyId: string | null;
  samplesCount: number;
  readsCount: number;
  sourceUrls: string[];
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`Downloaded 0 bytes from ${url}`);
  }
  await fsp.writeFile(dest, bytes);
}

function sha256OfFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function buildManifest() {
  return {
    dataset: {
      name: "nf-core/mag minigut smoke",
      description: "Tiny public paired-end metagenome for proving MAG assembly on the CI runner.",
    },
    order: {
      orderNumber: MAG_SMOKE_ORDER_NUMBER,
      name: "MAG MEGAHIT smoke (nf-core minigut)",
      status: "SUBMITTED",
      instrumentModel: "Illumina NovaSeq 6000",
      libraryStrategy: "WGS",
      librarySource: "METAGENOMIC",
      // Override the bundle seeder's ONT default: MAG needs short paired-end Illumina reads.
      sequencingTech: {
        technologyId: "illumina-novaseq-6000",
        technologyName: "Illumina NovaSeq 6000",
        platformFamily: "illumina",
        readLengthClass: "short",
        supportedReadLayouts: ["paired"],
        deviceId: "illumina-novaseq-6000",
        deviceName: "Illumina NovaSeq 6000",
      },
      customFields: { run_type: "metagenomics", platform: "illumina" },
    },
    study: {
      alias: MAG_SMOKE_STUDY_ALIAS,
      title: "MAG MEGAHIT smoke (nf-core minigut)",
      description: "Tiny paired-end metagenome example dataset for the MAG assembly pipeline.",
      principalInvestigator: "SeqDesk CI",
      abstract: "Proves MAG can assemble paired short reads on the hosted runner.",
      checklistType: "Miscellaneous natural or artificial environment",
    },
    samples: [
      {
        sampleId: "test_minigut",
        sampleAlias: "test_minigut",
        sampleTitle: "minigut paired-end",
        scientificName: "human gut metagenome",
        taxId: "408170",
        materialBodySite: "gut",
        file1: "reads/test_minigut_R1.fastq.gz",
        file2: "reads/test_minigut_R2.fastq.gz",
        dataClass: "raw",
        dataClassSource: "example_dataset",
        classificationNote: "nf-core/mag public test reads.",
      },
    ],
  };
}

/**
 * Provision the MAG smoke example dataset: download nf-core/mag's tiny paired-end test reads,
 * pack them with a manifest into the fixture archive, and create a real order/study/sample/read
 * via the shared install-profile fixture machinery (download is skipped — archive is pre-staged).
 */
export async function seedMagSmokeExampleDataset({
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
    resolveProfilePipelineAssetSettings: (
      prisma: PrismaLike,
      profile: unknown,
    ) => Promise<{ dataBasePath?: string | null }>;
  };

  const profile = {
    id: MAG_SMOKE_PROFILE_ID,
    seedData: {
      enabled: true,
      fixtures: [
        {
          id: MAG_SMOKE_FIXTURE_ID,
          kind: "exampleDataset",
          orderNumber: MAG_SMOKE_ORDER_NUMBER,
          source: {
            type: "downloadedFastqBundle",
            url: MAG_SMOKE_READS.r1,
            sha256: "", // filled in below from the pre-staged archive
          },
        },
      ],
    },
  };

  // Resolve the data base path EXACTLY as applyProfileSeedData/extractVerifiedFastqBundle will,
  // so the archive we pre-stage is found there (otherwise the extractor re-downloads source.url —
  // a single fastq — and fails the SHA256 check). They use the raw settings.dataBasePath, NOT the
  // resolveDataBasePathFromStoredValue-normalised path, so we must too.
  const { dataBasePath } = await seedModule.resolveProfilePipelineAssetSettings(prisma, profile);
  if (!dataBasePath) {
    throw new Error("Data base path is not configured");
  }

  const fixtureDir = path.join(dataBasePath, "fixtures", MAG_SMOKE_PROFILE_ID, MAG_SMOKE_FIXTURE_ID);
  const stageDir = path.join(fixtureDir, ".stage");
  const stageReadsDir = path.join(stageDir, "reads");
  // extractVerifiedFastqBundle reads the cached archive from the PROFILE-level .downloads dir —
  // dataBasePath/fixtures/<profileId>/.downloads/<fixtureId>.tar.gz — NOT a fixture-level one.
  // Staging it a level too deep (under <fixtureId>/.downloads) made the extractor miss it and
  // fall through to downloading source.url (a single R1 fastq, sha a90f4d48…), whose SHA can
  // never match the bundle's — the recurring "expected … got …" 500. Match the extractor exactly.
  const downloadsDir = path.join(dataBasePath, "fixtures", MAG_SMOKE_PROFILE_ID, ".downloads");

  await fsp.rm(stageDir, { recursive: true, force: true });
  await fsp.mkdir(stageReadsDir, { recursive: true });
  await fsp.mkdir(downloadsDir, { recursive: true });

  await activity?.update?.({ phase: "downloading", targetPath: stageReadsDir });
  logger.log?.(`[MAG smoke] Downloading nf-core/mag test reads to ${stageReadsDir}`);
  await downloadTo(MAG_SMOKE_READS.r1, path.join(stageReadsDir, "test_minigut_R1.fastq.gz"));
  await downloadTo(MAG_SMOKE_READS.r2, path.join(stageReadsDir, "test_minigut_R2.fastq.gz"));

  await fsp.writeFile(
    path.join(stageDir, "manifest.json"),
    `${JSON.stringify(buildManifest(), null, 2)}\n`,
  );

  // Pack { manifest.json, reads/ } into the archive the extractor expects, so its SHA256 check
  // matches and the download is skipped.
  const archivePath = path.join(downloadsDir, `${MAG_SMOKE_FIXTURE_ID}.tar.gz`);
  await fsp.rm(archivePath, { force: true });
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", stageDir, "manifest.json", "reads"], {
    encoding: "utf8",
  });
  if (tar.status !== 0) {
    throw new Error(`Failed to build MAG smoke bundle: ${tar.stderr || `tar exit ${tar.status}`}`);
  }
  profile.seedData.fixtures[0].source.sha256 = sha256OfFile(archivePath);

  await activity?.update?.({ phase: "seeding", targetPath: fixtureDir });
  return seedModule.applyProfileSeedData({ prisma, profile, rootDir, logger, activity });
}

export async function getMagSmokeExampleStatus(
  prisma: PrismaLike = db,
): Promise<MagSmokeExampleStatus> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: MAG_SMOKE_ORDER_NUMBER },
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
    (total, sample) => total + sample.reads.filter((r) => r.file1?.startsWith(MAG_SMOKE_READ_PREFIX)).length,
    0,
  );
  const studyId = samples.find((sample) => sample.studyId)?.studyId ?? null;

  return {
    seeded: Boolean(order) && samples.length > 0 && readsCount > 0,
    orderNumber: MAG_SMOKE_ORDER_NUMBER,
    orderId: order?.id ?? null,
    orderStatus: order?.status ?? null,
    studyId,
    samplesCount: samples.length,
    readsCount,
    sourceUrls: [MAG_SMOKE_READS.r1, MAG_SMOKE_READS.r2],
  };
}
