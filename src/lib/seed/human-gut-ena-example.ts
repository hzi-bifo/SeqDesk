import { promises as fsp, readFileSync } from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";

import { db } from "@/lib/db";
import { downloadEnaFile } from "@/lib/seed/ena-download";
import { HUMAN_GUT_READS, HUMAN_GUT_BASE } from "@/lib/seed/templates";

// A real, public, paired-end example dataset sourced from ENA BioProject PRJEB54724 (human gut
// shotgun metagenome, Netherlands). The twelve runs (ERR100095xx/ERR100096xx) are
// public Illumina WGS shotgun read pairs (~0.5-0.8M reads each), so the source URLs are declared
// here in the repo. It is provisioned as two instrument-homogeneous orders under one study by
// reusing the exact, tested
// install-profile fixture machinery (the mag-smoke pattern): pre-stage a downloadedFastqBundle
// archives (manifest.json + each order's reads) at the paths the extractor expects, then call
// applyProfileSeedData — which sees the archive already present with a matching SHA256 and skips
// the download, then extracts it and creates the order/study/samples. No shared seed change needed.
//
// This is the CI/runner counterpart to the demo's real human-gut study: the live demo carries the
// rich MIxS metadata, while this dataset exists only to put the twelve REAL FASTQ pairs on disk so
// the MAG pipeline can assemble them and submg can submit reads + assembly to ENA.

export const HUMAN_GUT_PROFILE_ID = "dev";
export const HUMAN_GUT_FIXTURE_ID = "human-gut-prjeb54724";
export const HUMAN_GUT_NEXTSEQ_FIXTURE_ID = "human-gut-prjeb54724-nextseq-550";
// Keep the original number as the primary/compatibility order. The ENA subset actually spans
// two instruments, so it is represented as two homogeneous orders under one study.
export const HUMAN_GUT_ORDER_NUMBER = "DEV-HUMAN-PRJEB54724-001";
export const HUMAN_GUT_NEXTSEQ_ORDER_NUMBER = "DEV-HUMAN-PRJEB54724-002";
export const HUMAN_GUT_STUDY_ALIAS = "human-gut-shotgun-prjeb54724-ci";
export const HUMAN_GUT_BIOPROJECT = "PRJEB54724";
export const HUMAN_GUT_ORDER_NUMBERS = [
  HUMAN_GUT_ORDER_NUMBER,
  HUMAN_GUT_NEXTSEQ_ORDER_NUMBER,
] as const;
const HUMAN_GUT_FIXTURE_IDS = [
  HUMAN_GUT_FIXTURE_ID,
  HUMAN_GUT_NEXTSEQ_FIXTURE_ID,
] as const;
const HUMAN_GUT_READ_PREFIXES = HUMAN_GUT_FIXTURE_IDS.map(
  (fixtureId) => `fixtures/${HUMAN_GUT_PROFILE_ID}/${fixtureId}/reads/`,
);

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
  experiment: info.experiment,
  biosample: info.biosample,
  instrumentModel: info.instrumentModel,
  checksum1: info.checksum1,
  checksum2: info.checksum2,
  readCount: info.readCount,
  ...enaFastqUrls(info.run),
}));

export type HumanGutInstrumentModel = (typeof HUMAN_GUT_RUNS)[number]["instrumentModel"];

export const HUMAN_GUT_ORDER_DEFINITIONS = [
  {
    fixtureId: HUMAN_GUT_FIXTURE_ID,
    orderNumber: HUMAN_GUT_ORDER_NUMBER,
    instrumentModel: "Illumina MiSeq" as const,
    technologyId: "illumina-miseq",
    technologyName: "MiSeq",
  },
  {
    fixtureId: HUMAN_GUT_NEXTSEQ_FIXTURE_ID,
    orderNumber: HUMAN_GUT_NEXTSEQ_ORDER_NUMBER,
    instrumentModel: "NextSeq 550" as const,
    technologyId: "illumina-nextseq-550",
    technologyName: "NextSeq 550",
  },
] as const;

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
  orderNumbers: string[];
  orderId: string | null;
  orderIds: string[];
  orderStatus: string | null;
  ordersCount: number;
  studyId: string | null;
  samplesCount: number;
  readsCount: number;
  bioproject: string;
  sourceUrls: string[];
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

export function buildHumanGutManifest(instrumentModel: HumanGutInstrumentModel = "Illumina MiSeq") {
  const orderDefinition = HUMAN_GUT_ORDER_DEFINITIONS.find(
    (definition) => definition.instrumentModel === instrumentModel,
  );
  if (!orderDefinition) {
    throw new Error(`Unsupported human-gut instrument: ${instrumentModel}`);
  }
  const runs = HUMAN_GUT_RUNS.filter((run) => run.instrumentModel === instrumentModel);

  return {
    dataset: {
      name: `Human gut shotgun metagenome (${instrumentModel}; ENA ${HUMAN_GUT_BIOPROJECT})`,
      description:
        "Real public human faecal shotgun-metagenome read pairs (Illumina WGS) from ENA " +
        `${HUMAN_GUT_BIOPROJECT}. This homogeneous ${instrumentModel} order is one part of the ` +
        "12-run example study used for extended, opt-in pipeline testing.",
    },
    order: {
      orderNumber: orderDefinition.orderNumber,
      name: `Human gut shotgun metagenomes — ${instrumentModel} (${HUMAN_GUT_BIOPROJECT})`,
      status: "SUBMITTED",
      // Exact ENA instrument strings. In particular, NextSeq models omit the "Illumina " prefix.
      instrumentModel,
      libraryStrategy: "WGS",
      librarySource: "METAGENOMIC",
      librarySelection: "other",
      // Short paired-end Illumina WGS reads — what the MAG pipeline assembles.
      sequencingTech: {
        technologyId: orderDefinition.technologyId,
        technologyName: orderDefinition.technologyName,
        platformFamily: "illumina",
        readLengthClass: "short",
        supportedReadLayouts: ["paired"],
        deviceId: orderDefinition.technologyId,
        deviceName: orderDefinition.technologyName,
      },
      customFields: {
        run_type: "metagenomics",
        platform: "illumina",
        bioproject: HUMAN_GUT_BIOPROJECT,
        sourceProvenance: {
          archive: "ENA",
          bioproject: HUMAN_GUT_BIOPROJECT,
          instrumentModel,
          libraryStrategy: "WGS",
          librarySource: "METAGENOMIC",
          librarySelection: "other",
        },
      },
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
    samples: runs.map((r) => ({
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
      checksum1: r.checksum1,
      checksum2: r.checksum2,
      readCount1: r.readCount,
      readCount2: r.readCount,
      runAccessionNumber: r.run,
      experimentAccessionNumber: r.experiment,
      customFields: {
        source_archive: "ENA",
        source_bioproject: HUMAN_GUT_BIOPROJECT,
        source_biosample_accession: r.biosample,
        source_run_accession: r.run,
        source_experiment_accession: r.experiment,
        source_instrument_model: r.instrumentModel,
        source_library_strategy: "WGS",
        source_library_source: "METAGENOMIC",
        source_library_selection: "other",
      },
      sequencingRun: {
        runId: r.run,
        runName: `${r.run} (${r.sampleAlias})`,
        platform: "ILLUMINA",
        instrument: r.instrumentModel,
        totalReads: r.readCount,
        runParameters: {
          sourceArchive: "ENA",
          sourceBioproject: HUMAN_GUT_BIOPROJECT,
          sourceExperimentAccession: r.experiment,
          sourceBiosampleAccession: r.biosample,
          libraryStrategy: "WGS",
          librarySource: "METAGENOMIC",
          librarySelection: "other",
        },
      },
    })),
  };
}

export function buildHumanGutManifests() {
  return HUMAN_GUT_ORDER_DEFINITIONS.map((definition) =>
    buildHumanGutManifest(definition.instrumentModel),
  );
}

/**
 * Provision the human-gut PRJEB54724 example dataset: download the twelve real ENA WGS read pairs,
 * pack them into two instrument-homogeneous fixture archives, and create one study with two orders
 * and 12 samples via
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
      fixtures: HUMAN_GUT_ORDER_DEFINITIONS.map((definition) => {
        const firstRun = HUMAN_GUT_RUNS.find(
          (run) => run.instrumentModel === definition.instrumentModel,
        );
        if (!firstRun) {
          throw new Error(`No human-gut runs found for ${definition.instrumentModel}`);
        }
        return {
          id: definition.fixtureId,
          kind: "exampleDataset",
          orderNumber: definition.orderNumber,
          source: {
            type: "downloadedFastqBundle",
            url: firstRun.r1,
            sha256: "", // filled in below from the pre-staged archive
          },
        };
      }),
    },
  };

  // Resolve the data base path EXACTLY as the extractor will, so the archive we pre-stage is found
  // there (otherwise the extractor re-downloads source.url and fails the SHA256 check). They use
  // the raw settings.dataBasePath, NOT the normalised path, so we must too. (mag-smoke pattern.)
  const { dataBasePath } = await seedModule.resolveProfilePipelineAssetSettings(prisma, profile);
  if (!dataBasePath) {
    throw new Error("Data base path is not configured");
  }

  // extractVerifiedFastqBundle reads the cached archive from the PROFILE-level .downloads dir.
  const downloadsDir = path.join(dataBasePath, "fixtures", HUMAN_GUT_PROFILE_ID, ".downloads");
  await fsp.mkdir(downloadsDir, { recursive: true });

  for (const [index, definition] of HUMAN_GUT_ORDER_DEFINITIONS.entries()) {
    const runs = HUMAN_GUT_RUNS.filter(
      (run) => run.instrumentModel === definition.instrumentModel,
    );
    const fixtureDir = path.join(
      dataBasePath,
      "fixtures",
      HUMAN_GUT_PROFILE_ID,
      definition.fixtureId,
    );
    const stageDir = path.join(fixtureDir, ".stage");
    const stageReadsDir = path.join(stageDir, "reads");

    await fsp.rm(stageDir, { recursive: true, force: true });
    await fsp.mkdir(stageReadsDir, { recursive: true });
    await activity?.update?.({ phase: "downloading", targetPath: stageReadsDir });
    logger.log?.(
      `[human-gut] Downloading ${runs.length} ${definition.instrumentModel} ENA ` +
        `${HUMAN_GUT_BIOPROJECT} read pairs to ${stageReadsDir}`,
    );
    for (const run of runs) {
      await downloadEnaFile({
        url: run.r1,
        destination: path.join(stageReadsDir, r1Name(run.sampleAlias)),
        expectedMd5: run.checksum1,
      });
      await downloadEnaFile({
        url: run.r2,
        destination: path.join(stageReadsDir, r2Name(run.sampleAlias)),
        expectedMd5: run.checksum2,
      });
      logger.log?.(`[human-gut] fetched ${run.run} (${run.sampleAlias})`);
    }

    await fsp.writeFile(
      path.join(stageDir, "manifest.json"),
      `${JSON.stringify(buildHumanGutManifest(definition.instrumentModel), null, 2)}\n`,
    );

    // Each homogeneous order is packed separately so the shared fixture seeder can retain its
    // order-level instrument semantics while attaching both orders to the same study alias.
    const archivePath = path.join(downloadsDir, `${definition.fixtureId}.tar.gz`);
    await fsp.rm(archivePath, { force: true });
    const tar = spawnSync(
      "tar",
      ["-czf", archivePath, "-C", stageDir, "manifest.json", "reads"],
      { encoding: "utf8" },
    );
    if (tar.status !== 0) {
      throw new Error(
        `Failed to build human-gut ${definition.instrumentModel} bundle: ` +
          `${tar.stderr || `tar exit ${tar.status}`}`,
      );
    }
    profile.seedData.fixtures[index].source.sha256 = sha256OfFile(archivePath);
    await activity?.update?.({ phase: "seeding", targetPath: fixtureDir });
  }

  return seedModule.applyProfileSeedData({ prisma, profile, rootDir, logger, activity });
}

export async function getHumanGutExampleStatus(
  prisma: PrismaLike = db,
): Promise<HumanGutExampleStatus> {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: [...HUMAN_GUT_ORDER_NUMBERS] } },
    select: {
      id: true,
      orderNumber: true,
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

  const orderedOrders = HUMAN_GUT_ORDER_NUMBERS.flatMap((orderNumber) => {
    const order = orders.find((candidate) => candidate.orderNumber === orderNumber);
    return order ? [order] : [];
  });
  const primaryOrder = orderedOrders[0];
  const samples = orderedOrders.flatMap((order) => order.samples);
  const readsCount = samples.reduce(
    (total, sample) =>
      total +
      sample.reads.filter((read) =>
        HUMAN_GUT_READ_PREFIXES.some((prefix) => read.file1?.startsWith(prefix)),
      ).length,
    0,
  );
  const studyId = samples.find((sample) => sample.studyId)?.studyId ?? null;

  return {
    seeded:
      orderedOrders.length === HUMAN_GUT_ORDER_NUMBERS.length &&
      samples.length === HUMAN_GUT_RUNS.length &&
      readsCount === HUMAN_GUT_RUNS.length,
    orderNumber: HUMAN_GUT_ORDER_NUMBER,
    orderNumbers: [...HUMAN_GUT_ORDER_NUMBERS],
    orderId: primaryOrder?.id ?? null,
    orderIds: orderedOrders.map((order) => order.id),
    orderStatus: primaryOrder?.status ?? null,
    ordersCount: orderedOrders.length,
    studyId,
    samplesCount: samples.length,
    readsCount,
    bioproject: HUMAN_GUT_BIOPROJECT,
    sourceUrls: HUMAN_GUT_RUNS.flatMap((r) => [r.r1, r.r2]),
  };
}
