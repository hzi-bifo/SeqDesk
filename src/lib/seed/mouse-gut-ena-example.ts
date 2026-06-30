import { promises as fsp, readFileSync } from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";

import { db } from "@/lib/db";
import { MOUSE_GUT_READS, MOUSE_GUT_BASE } from "@/lib/seed/templates";

// A real, public, paired-end example dataset sourced from ENA BioProject PRJDB6165 (mouse gut
// metagenome, Tokyo Medical and Dental University). The eight runs (DRR099973..DRR099980) are
// public 16S-region Illumina MiSeq read pairs (~90k reads each), so the source URLs are declared
// here in the repo. It is provisioned as a real order/study/8 samples by reusing the exact, tested
// install-profile fixture machinery (the mag-smoke pattern): pre-stage a downloadedFastqBundle
// archive (manifest.json + the 16 reads) at the path the extractor expects, then call
// applyProfileSeedData — which sees the archive already present with a matching SHA256 and skips
// the download, then extracts it and creates the order/study/samples. No shared seed change needed.
//
// This is the CI/runner counterpart to the demo's real mouse-gut study: the live demo carries the
// rich MIxS metadata, while this dataset exists only to put the eight REAL FASTQ pairs on disk so
// the public pipelines (fastqc, reads-qc, study-demo-report, fastq-checksum) run on real data and
// produce real reports — which are then bundled into the demo viewer.

export const MOUSE_GUT_PROFILE_ID = "dev";
export const MOUSE_GUT_FIXTURE_ID = "mouse-gut-prjdb6165";
export const MOUSE_GUT_ORDER_NUMBER = "DEV-MOUSE-PRJDB6165-001";
export const MOUSE_GUT_STUDY_ALIAS = "mouse-gut-prjdb6165-ci";
export const MOUSE_GUT_BIOPROJECT = "PRJDB6165";
const MOUSE_GUT_READ_PREFIX = `fixtures/${MOUSE_GUT_PROFILE_ID}/${MOUSE_GUT_FIXTURE_ID}/reads/`;

// ENA hosts each run's FASTQs at a deterministic path keyed by the run accession; the
// six-character accession prefix is the first directory level (confirmed against the
// PRJDB6165 filereport). Derive both URLs from the run accession alone.
function enaFastqUrls(run: string): { r1: string; r2: string } {
  const base = `https://ftp.sra.ebi.ac.uk/vol1/fastq/${run.slice(0, 6)}/${run}`;
  return { r1: `${base}/${run}_1.fastq.gz`, r2: `${base}/${run}_2.fastq.gz` };
}

// The eight runs, derived from the shared MOUSE_GUT_READS map (single source of truth) so the CI
// dataset can never drift from the demo study's accessions. Exported for unit testing.
export const MOUSE_GUT_RUNS = Object.entries(MOUSE_GUT_READS).map(([sampleAlias, info]) => ({
  sampleAlias,
  run: info.run,
  experiment: info.experiment,
  readCount: info.readCount,
  ...enaFastqUrls(info.run),
}));

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

export interface MouseGutExampleStatus {
  seeded: boolean;
  orderNumber: string;
  orderId: string | null;
  orderStatus: string | null;
  studyId: string | null;
  samplesCount: number;
  readsCount: number;
  bioproject: string;
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

// Local FASTQ filenames are keyed by the (genericized) sample alias, NOT the real run
// accession — so the pipelines (and the FastQC reports they emit, named after the FASTQ
// basename) come out demo-labelled (e.g. MGB-01_R1_fastqc.html) and match the bundled
// demo reports. The download URL still uses the real run accession (enaFastqUrls).
function r1Name(sampleAlias: string): string {
  return `${sampleAlias}_R1.fastq.gz`;
}
function r2Name(sampleAlias: string): string {
  return `${sampleAlias}_R2.fastq.gz`;
}

export function buildMouseGutManifest() {
  return {
    dataset: {
      name: `Mouse gut 16S metagenome (ENA ${MOUSE_GUT_BIOPROJECT})`,
      description:
        "Real public mouse-gut paired-end Illumina MiSeq reads from ENA BioProject PRJDB6165, " +
        "for running the public SeqDesk pipelines on genuine data on the CI runner.",
    },
    order: {
      orderNumber: MOUSE_GUT_ORDER_NUMBER,
      name: `Mouse gut 16S (${MOUSE_GUT_BIOPROJECT}, real ENA)`,
      status: "SUBMITTED",
      instrumentModel: "Illumina MiSeq",
      libraryStrategy: "WGS",
      librarySource: "METAGENOMIC",
      // Override the bundle seeder's ONT default: these are short paired-end Illumina reads.
      sequencingTech: {
        technologyId: "illumina-miseq",
        technologyName: "Illumina MiSeq",
        platformFamily: "illumina",
        readLengthClass: "short",
        supportedReadLayouts: ["paired"],
        deviceId: "illumina-miseq",
        deviceName: "Illumina MiSeq",
      },
      customFields: { run_type: "metagenomics", platform: "illumina", bioproject: MOUSE_GUT_BIOPROJECT },
    },
    study: {
      alias: MOUSE_GUT_STUDY_ALIAS,
      title: `Mouse Gut Metagenome (${MOUSE_GUT_BIOPROJECT}) — CI`,
      description:
        "Real mouse-gut paired-end example dataset (ENA PRJDB6165) for running the public " +
        "pipelines on the hosted runner.",
      principalInvestigator: "Tokyo Medical and Dental University",
      abstract:
        "Eight real public mouse fecal Illumina MiSeq read pairs (PRJDB6165), used to produce " +
        "genuine pipeline reports for the SeqDesk demo viewer.",
      checklistType: "host-associated",
    },
    samples: MOUSE_GUT_RUNS.map((r) => ({
      // Use the (genericized) sample alias as the sample id so pipeline outputs name files
      // by it (FastQC derives report names from the FASTQ basename, e.g. MGB-01_R1_fastqc.html),
      // keeping the CI reports demo-labelled and matching the bundled demo reports.
      sampleId: r.sampleAlias,
      sampleAlias: r.sampleAlias,
      sampleTitle: `Mouse faecal sample ${r.sampleAlias}`,
      scientificName: MOUSE_GUT_BASE.scientificName,
      taxId: MOUSE_GUT_BASE.taxId,
      materialBodySite: "gut",
      file1: `reads/${r1Name(r.sampleAlias)}`,
      file2: `reads/${r2Name(r.sampleAlias)}`,
      dataClass: "raw",
      dataClassSource: "example_dataset",
      classificationNote: `Demo mouse-gut sample ${r.sampleAlias}.`,
    })),
  };
}

/**
 * Provision the mouse-gut PRJDB6165 example dataset: download the eight real ENA MiSeq read pairs,
 * pack them with a manifest into the fixture archive, and create a real order/study/8 samples via
 * the shared install-profile fixture machinery (download is skipped — the archive is pre-staged).
 */
export async function seedMouseGutExampleDataset({
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
    id: MOUSE_GUT_PROFILE_ID,
    seedData: {
      enabled: true,
      fixtures: [
        {
          id: MOUSE_GUT_FIXTURE_ID,
          kind: "exampleDataset",
          orderNumber: MOUSE_GUT_ORDER_NUMBER,
          source: {
            type: "downloadedFastqBundle",
            url: MOUSE_GUT_RUNS[0].r1,
            sha256: "", // filled in below from the pre-staged archive
          },
        },
      ],
    },
  };

  // Resolve the data base path EXACTLY as the extractor will, so the archive we pre-stage is found
  // there (otherwise the extractor re-downloads source.url and fails the SHA256 check). They use
  // the raw settings.dataBasePath, NOT the normalised path, so we must too. (mag-smoke pattern.)
  const { dataBasePath } = await seedModule.resolveProfilePipelineAssetSettings(prisma, profile);
  if (!dataBasePath) {
    throw new Error("Data base path is not configured");
  }

  const fixtureDir = path.join(dataBasePath, "fixtures", MOUSE_GUT_PROFILE_ID, MOUSE_GUT_FIXTURE_ID);
  const stageDir = path.join(fixtureDir, ".stage");
  const stageReadsDir = path.join(stageDir, "reads");
  // extractVerifiedFastqBundle reads the cached archive from the PROFILE-level .downloads dir.
  const downloadsDir = path.join(dataBasePath, "fixtures", MOUSE_GUT_PROFILE_ID, ".downloads");

  await fsp.rm(stageDir, { recursive: true, force: true });
  await fsp.mkdir(stageReadsDir, { recursive: true });
  await fsp.mkdir(downloadsDir, { recursive: true });

  await activity?.update?.({ phase: "downloading", targetPath: stageReadsDir });
  logger.log?.(
    `[mouse-gut] Downloading ${MOUSE_GUT_RUNS.length} ENA ${MOUSE_GUT_BIOPROJECT} read pairs to ${stageReadsDir}`,
  );
  for (const r of MOUSE_GUT_RUNS) {
    await downloadTo(r.r1, path.join(stageReadsDir, r1Name(r.sampleAlias)));
    await downloadTo(r.r2, path.join(stageReadsDir, r2Name(r.sampleAlias)));
    logger.log?.(`[mouse-gut] fetched ${r.run} (${r.sampleAlias})`);
  }

  await fsp.writeFile(
    path.join(stageDir, "manifest.json"),
    `${JSON.stringify(buildMouseGutManifest(), null, 2)}\n`,
  );

  // Pack { manifest.json, reads/ } into the archive the extractor expects, so its SHA256 check
  // matches and the download is skipped.
  const archivePath = path.join(downloadsDir, `${MOUSE_GUT_FIXTURE_ID}.tar.gz`);
  await fsp.rm(archivePath, { force: true });
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", stageDir, "manifest.json", "reads"], {
    encoding: "utf8",
  });
  if (tar.status !== 0) {
    throw new Error(`Failed to build mouse-gut bundle: ${tar.stderr || `tar exit ${tar.status}`}`);
  }
  profile.seedData.fixtures[0].source.sha256 = sha256OfFile(archivePath);

  await activity?.update?.({ phase: "seeding", targetPath: fixtureDir });
  return seedModule.applyProfileSeedData({ prisma, profile, rootDir, logger, activity });
}

export async function getMouseGutExampleStatus(
  prisma: PrismaLike = db,
): Promise<MouseGutExampleStatus> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: MOUSE_GUT_ORDER_NUMBER },
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
    (total, sample) => total + sample.reads.filter((r) => r.file1?.startsWith(MOUSE_GUT_READ_PREFIX)).length,
    0,
  );
  const studyId = samples.find((sample) => sample.studyId)?.studyId ?? null;

  return {
    seeded: Boolean(order) && samples.length > 0 && readsCount > 0,
    orderNumber: MOUSE_GUT_ORDER_NUMBER,
    orderId: order?.id ?? null,
    orderStatus: order?.status ?? null,
    studyId,
    samplesCount: samples.length,
    readsCount,
    bioproject: MOUSE_GUT_BIOPROJECT,
    sourceUrls: MOUSE_GUT_RUNS.flatMap((r) => [r.r1, r.r2]),
  };
}
