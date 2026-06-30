import { promises as fsp, readFileSync } from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";

import { db } from "@/lib/db";
import { HUMAN_GUT_READS, HUMAN_GUT_BASE } from "@/lib/seed/templates";

// A real, public, paired-end example dataset sourced from ENA BioProject PRJEB54724 (human gut
// shotgun metagenome, Netherlands). The twelve runs (ERR100095xx/ERR100096xx) are
// public Illumina WGS shotgun read pairs (~0.5-0.8M reads each), so the source URLs are declared
// here in the repo. It is provisioned as a real order/study/12 samples by reusing the exact, tested
// install-profile fixture machinery (the mag-smoke pattern): pre-stage a downloadedFastqBundle
// archive (manifest.json + the 24 reads) at the path the extractor expects, then call
// applyProfileSeedData — which sees the archive already present with a matching SHA256 and skips
// the download, then extracts it and creates the order/study/samples. No shared seed change needed.
//
// This is the CI/runner counterpart to the demo's real human-gut study: the live demo carries the
// rich MIxS metadata, while this dataset exists only to put the twelve REAL FASTQ pairs on disk so
// the MAG pipeline can assemble them and submg can submit reads + assembly to ENA.

export const HUMAN_GUT_PROFILE_ID = "dev";
export const HUMAN_GUT_FIXTURE_ID = "human-gut-prjeb54724";
export const HUMAN_GUT_ORDER_NUMBER = "DEV-HUMAN-PRJEB54724-001";
export const HUMAN_GUT_STUDY_ALIAS = "human-gut-shotgun-prjeb54724-ci";
export const HUMAN_GUT_BIOPROJECT = "PRJEB54724";
const HUMAN_GUT_READ_PREFIX = `fixtures/${HUMAN_GUT_PROFILE_ID}/${HUMAN_GUT_FIXTURE_ID}/reads/`;

// ENA hosts each run's FASTQs at a deterministic path. For accessions with more than six
// digits there is a sub-directory level: vol1/fastq/<PREFIX+first3>/<0-padded last digits>/
// <run>/<run>_{1,2}.fastq.gz (verified against the PRJEB54724 filereport, e.g. ERR10009592 ->
// .../ERR100/092/ERR10009592/...). Six-digit accessions have no sub-directory.
function enaFastqUrls(run: string): { r1: string; r2: string } {
  const m = run.match(/^([A-Za-z]+)(\d+)$/);
  const prefix = m ? m[1] : run.slice(0, 3);
  const digits = m ? m[2] : run.slice(3);
  const first = `${prefix}${digits.slice(0, 3)}`;
  const sub = digits.length > 6 ? `/${digits.slice(6).padStart(3, "0")}` : "";
  const base = `https://ftp.sra.ebi.ac.uk/vol1/fastq/${first}${sub}/${run}`;
  return { r1: `${base}/${run}_1.fastq.gz`, r2: `${base}/${run}_2.fastq.gz` };
}

// The twelve runs, derived from the shared HUMAN_GUT_READS map (single source of truth) so the
// CI dataset can never drift from the demo study's accessions. Exported for unit testing.
export const HUMAN_GUT_RUNS = Object.entries(HUMAN_GUT_READS).map(([sampleAlias, info]) => ({
  sampleAlias,
  run: info.run,
  biosample: info.biosample,
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

export interface HumanGutExampleStatus {
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
// basename) come out demo-labelled (e.g. HGM-01_R1.fastq.gz) and match the bundled
// demo reports. The download URL still uses the real run accession (enaFastqUrls).
function r1Name(sampleAlias: string): string {
  return `${sampleAlias}_R1.fastq.gz`;
}
function r2Name(sampleAlias: string): string {
  return `${sampleAlias}_R2.fastq.gz`;
}

export function buildHumanGutManifest() {
  return {
    dataset: {
      name: `Human gut shotgun metagenome (ENA ${HUMAN_GUT_BIOPROJECT})`,
      description:
        "Real public human faecal shotgun-metagenome read pairs (Illumina WGS) from ENA " +
        `${HUMAN_GUT_BIOPROJECT}, for running MAG assembly + ENA submission on the CI runner.`,
    },
    order: {
      orderNumber: HUMAN_GUT_ORDER_NUMBER,
      name: `Human gut shotgun metagenomes (${HUMAN_GUT_BIOPROJECT}, real ENA)`,
      status: "SUBMITTED",
      // ENA-valid instrument string EXACTLY (Webin-CLI rejects anything else; NextSeq models
      // are listed WITHOUT the "Illumina " prefix, so "Illumina NextSeq 550" normalizes to
      // "unspecified" and fails the read submission).
      instrumentModel: "NextSeq 550",
      libraryStrategy: "WGS",
      librarySource: "METAGENOMIC",
      // Short paired-end Illumina WGS reads — what the MAG pipeline assembles.
      sequencingTech: {
        technologyId: "illumina-nextseq-550",
        technologyName: "NextSeq 550",
        platformFamily: "illumina",
        readLengthClass: "short",
        supportedReadLayouts: ["paired"],
        deviceId: "illumina-nextseq-550",
        deviceName: "NextSeq 550",
      },
      customFields: { run_type: "metagenomics", platform: "illumina", bioproject: HUMAN_GUT_BIOPROJECT },
    },
    study: {
      alias: HUMAN_GUT_STUDY_ALIAS,
      title: `Human Gut Shotgun Metagenomes (${HUMAN_GUT_BIOPROJECT}) — CI`,
      description:
        `Real human faecal shotgun-metagenome example dataset (ENA ${HUMAN_GUT_BIOPROJECT}) for ` +
        "running MAG assembly and ENA reads+assembly submission on the hosted runner.",
      principalInvestigator: "ENA PRJEB54724 (public)",
      abstract:
        "Twelve real public human gut shotgun-metagenome read pairs (Illumina paired-end WGS, " +
        `ENA ${HUMAN_GUT_BIOPROJECT}), used to exercise the MAG pipeline and ENA submission.`,
      checklistType: "host-associated",
    },
    samples: HUMAN_GUT_RUNS.map((r) => ({
      // Use the sample alias as the sample id so pipeline outputs name files by it (e.g.
      // HGM-01) — keeping CI reports demo-labelled and consistent with the demo study.
      sampleId: r.sampleAlias,
      sampleAlias: r.sampleAlias,
      sampleTitle: `Human faecal shotgun metagenome ${r.sampleAlias}`,
      scientificName: HUMAN_GUT_BASE.scientificName,
      taxId: HUMAN_GUT_BASE.taxId,
      materialBodySite: "gut",
      file1: `reads/${r1Name(r.sampleAlias)}`,
      file2: `reads/${r2Name(r.sampleAlias)}`,
      dataClass: "raw",
      dataClassSource: "example_dataset",
      classificationNote: `Real ENA ${HUMAN_GUT_BIOPROJECT} run ${r.run} (sample ${r.sampleAlias}).`,
    })),
  };
}

/**
 * Provision the human-gut PRJEB54724 example dataset: download the twelve real ENA WGS read pairs,
 * pack them with a manifest into the fixture archive, and create a real order/study/12 samples via
 * the shared install-profile fixture machinery (download is skipped — the archive is pre-staged).
 */
export async function seedHumanGutExampleDataset({
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
    id: HUMAN_GUT_PROFILE_ID,
    seedData: {
      enabled: true,
      fixtures: [
        {
          id: HUMAN_GUT_FIXTURE_ID,
          kind: "exampleDataset",
          orderNumber: HUMAN_GUT_ORDER_NUMBER,
          source: {
            type: "downloadedFastqBundle",
            url: HUMAN_GUT_RUNS[0].r1,
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

  const fixtureDir = path.join(dataBasePath, "fixtures", HUMAN_GUT_PROFILE_ID, HUMAN_GUT_FIXTURE_ID);
  const stageDir = path.join(fixtureDir, ".stage");
  const stageReadsDir = path.join(stageDir, "reads");
  // extractVerifiedFastqBundle reads the cached archive from the PROFILE-level .downloads dir.
  const downloadsDir = path.join(dataBasePath, "fixtures", HUMAN_GUT_PROFILE_ID, ".downloads");

  await fsp.rm(stageDir, { recursive: true, force: true });
  await fsp.mkdir(stageReadsDir, { recursive: true });
  await fsp.mkdir(downloadsDir, { recursive: true });

  await activity?.update?.({ phase: "downloading", targetPath: stageReadsDir });
  logger.log?.(
    `[human-gut] Downloading ${HUMAN_GUT_RUNS.length} ENA ${HUMAN_GUT_BIOPROJECT} read pairs to ${stageReadsDir}`,
  );
  for (const r of HUMAN_GUT_RUNS) {
    await downloadTo(r.r1, path.join(stageReadsDir, r1Name(r.sampleAlias)));
    await downloadTo(r.r2, path.join(stageReadsDir, r2Name(r.sampleAlias)));
    logger.log?.(`[human-gut] fetched ${r.run} (${r.sampleAlias})`);
  }

  await fsp.writeFile(
    path.join(stageDir, "manifest.json"),
    `${JSON.stringify(buildHumanGutManifest(), null, 2)}\n`,
  );

  // Pack { manifest.json, reads/ } into the archive the extractor expects, so its SHA256 check
  // matches and the download is skipped.
  const archivePath = path.join(downloadsDir, `${HUMAN_GUT_FIXTURE_ID}.tar.gz`);
  await fsp.rm(archivePath, { force: true });
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", stageDir, "manifest.json", "reads"], {
    encoding: "utf8",
  });
  if (tar.status !== 0) {
    throw new Error(`Failed to build human-gut bundle: ${tar.stderr || `tar exit ${tar.status}`}`);
  }
  profile.seedData.fixtures[0].source.sha256 = sha256OfFile(archivePath);

  await activity?.update?.({ phase: "seeding", targetPath: fixtureDir });
  return seedModule.applyProfileSeedData({ prisma, profile, rootDir, logger, activity });
}

export async function getHumanGutExampleStatus(
  prisma: PrismaLike = db,
): Promise<HumanGutExampleStatus> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: HUMAN_GUT_ORDER_NUMBER },
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
    (total, sample) => total + sample.reads.filter((r) => r.file1?.startsWith(HUMAN_GUT_READ_PREFIX)).length,
    0,
  );
  const studyId = samples.find((sample) => sample.studyId)?.studyId ?? null;

  return {
    seeded: Boolean(order) && samples.length > 0 && readsCount > 0,
    orderNumber: HUMAN_GUT_ORDER_NUMBER,
    orderId: order?.id ?? null,
    orderStatus: order?.status ?? null,
    studyId,
    samplesCount: samples.length,
    readsCount,
    bioproject: HUMAN_GUT_BIOPROJECT,
    sourceUrls: HUMAN_GUT_RUNS.flatMap((r) => [r.r1, r.r2]),
  };
}
