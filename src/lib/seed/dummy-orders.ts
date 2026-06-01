import * as path from "path";
import {
  buildSequencingTechSelection,
  PLATFORM_ILLUMINA_MISEQ_AMPLICON,
  PLATFORM_ILLUMINA_NOVASEQ_WGS,
  PLATFORM_ONT_MINION_AMPLICON,
  PLATFORM_ONT_MINION_WGS,
  SAMPLE_GR_01,
  SAMPLE_GR_02,
  SAMPLE_GR_03,
  SAMPLE_HS_01,
  SAMPLE_HS_02,
  SAMPLE_SR_01,
  SAMPLE_SR_02,
  STUDY_GUT_RECOVERY,
  STUDY_SURFACE_RESISTOME,
  type PlatformProfile,
  type SampleTemplate,
} from "./templates";
import type { SequencingTechSelection } from "@/types/sequencing-technology";

export const SEED_DUMMY_MARKER = "admin-dummy";
export const SEED_DUMMY_ORDER_PREFIX = "SEED-DUMMY";
export const SEED_DUMMY_FOLDER_ROOT = "seed-dummy";
/** SiteSettings.extraSettings JSON key for the persisted "dummy data enabled" flag. */
export const SEED_DUMMY_ENABLED_KEY = "dummyDataEnabled";

/** A single Read row to create for a seeded sample. */
export interface DummyReadSpec {
  file1Relative: string;
  /** Null for single-end (long-read ONT/PacBio); set for paired-end (Illumina). */
  file2Relative: string | null;
  /** Read.dataClass — "raw" / "cleaned" / "unknown". Defaults to "cleaned" in the DB. */
  dataClass: "raw" | "cleaned" | "unknown";
  /** Read.dataClassSource — provenance marker for the classification. */
  dataClassSource: string;
  /** Read.isActive — inactive rows model superseded/historical reads. */
  isActive: boolean;
}

export interface DummySampleSpec {
  sampleId: string;
  sampleAlias: string;
  sampleTitle: string;
  scientificName: string;
  taxId: string;
  checklistData: Record<string, string>;
  customFields: Record<string, string>;
  /** Zero or more Read rows. Empty for samples without on-disk FASTQ. */
  reads: DummyReadSpec[];
}

export interface DummyStudySpec {
  title: string;
  alias: string;
  description: string;
  checklistType: string;
  principalInvestigator: string;
  abstract: string;
  readyForSubmission: boolean;
}

export interface DummyOrderSpec {
  orderNumber: string;
  name: string;
  status: "DRAFT" | "SUBMITTED";
  numberOfSamples: number;
  platform?: string | null;
  sequencingTechSelection: SequencingTechSelection;
  instrumentModel: string;
  libraryStrategy: string;
  librarySource: string;
  samples: DummySampleSpec[];
  linkSamplesToStudy: boolean;
}

/** Which study a seeded order should link its samples to. */
export type DummyStudyLink = "primary" | "study" | null;

export interface DummyOrderSpecWithLink extends Omit<DummyOrderSpec, "linkSamplesToStudy"> {
  /**
   * Which seeded study (if any) this order's samples connect to.
   * - "primary": the main longitudinal gut-recovery study (dataset.study)
   * - "study": the dedicated study-scoped dataset (dataset.studyScoped)
   * - null: no study link (draft / standalone orders)
   */
  studyLink: DummyStudyLink;
}

/** One FASTQ file pair (or single file) that must be materialised on disk. */
export interface DummyFastqTarget {
  sampleId: string;
  /** Deterministic per-sample index that seeds the synthetic generator. */
  sampleIndex: number;
  pairedEnd: boolean;
  file1Relative: string;
  file1Absolute: string;
  /** Null for single-end (long-read ONT/PacBio). */
  file2Relative: string | null;
  file2Absolute: string | null;
}

export interface DummySeedDataset {
  ownerUserId: string;
  fastqRelativeFolder: string;
  fastqAbsoluteFolder: string;
  /** Primary study linked from the SUBMITTED gut-recovery order. */
  study: DummyStudySpec;
  /** Dedicated study-scoped dataset whose samples carry on-disk reads. */
  studyScoped: DummyStudySpec;
  orders: DummyOrderSpecWithLink[];
  /** Configured synthetic read count applied to every generated FASTQ. */
  syntheticReadCount: number;
  /** Configured synthetic read length applied to every generated FASTQ. */
  syntheticReadLength: number;
  /** Distinct FASTQ files that need to be generated on disk (deduplicated). */
  sampleFastqTargets: DummyFastqTarget[];
}

export interface BuildDummySeedOptions {
  ownerUserId: string;
  /** Resolved absolute base path under which FASTQ files will be written. */
  dataBasePath: string;
  /**
   * Platform profile for the SUBMITTED order. If omitted, defaults to Illumina NovaSeq.
   * For ONT/PacBio platforms, reads are generated single-end (no R2 file).
   */
  primaryPlatform?: PlatformProfile;
  /**
   * Platform profile for the DRAFT order. If omitted, defaults to Illumina MiSeq amplicon
   * (when primary is Illumina) or ONT MinION amplicon (when primary is long-read).
   */
  draftPlatform?: PlatformProfile;
  /**
   * Platform profile for the dedicated single-end long-read order. If omitted, defaults to
   * ONT MinION WGS. Always single-end so single-end pipeline paths get exercised even when
   * the primary/draft orders are paired-end Illumina.
   */
  longReadPlatform?: PlatformProfile;
  /**
   * Platform profile for the study-scoped dataset. If omitted, defaults to Illumina NovaSeq
   * (paired-end), independent of the order platforms above.
   */
  studyPlatform?: PlatformProfile;
  /** Synthetic reads per FASTQ. Defaults to {@link DEFAULT_SYNTHETIC_READ_COUNT}. */
  syntheticReadCount?: number;
  /** Synthetic read length. Defaults to {@link DEFAULT_SYNTHETIC_READ_LENGTH}. */
  syntheticReadLength?: number;
}

/** Default synthetic reads per generated FASTQ (matches the historical hard-coded value). */
export const DEFAULT_SYNTHETIC_READ_COUNT = 1000;
/** Default synthetic read length (matches the historical hard-coded value). */
export const DEFAULT_SYNTHETIC_READ_LENGTH = 150;

/**
 * Resolves the synthetic read count/length, honouring (in order) explicit options,
 * then the SEQDESK_SEED_READ_COUNT / SEQDESK_SEED_READ_LENGTH env vars, then defaults.
 * Invalid / non-positive values fall back to the next source.
 */
export function resolveSyntheticReadSize(options?: {
  syntheticReadCount?: number;
  syntheticReadLength?: number;
  env?: Record<string, string | undefined>;
}): { readCount: number; readLength: number } {
  const env = options?.env ?? process.env;
  const pick = (
    explicit: number | undefined,
    envValue: string | undefined,
    fallback: number
  ): number => {
    if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
      return Math.floor(explicit);
    }
    if (envValue !== undefined) {
      const parsed = Number(envValue);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return fallback;
  };

  return {
    readCount: pick(
      options?.syntheticReadCount,
      env.SEQDESK_SEED_READ_COUNT,
      DEFAULT_SYNTHETIC_READ_COUNT
    ),
    readLength: pick(
      options?.syntheticReadLength,
      env.SEQDESK_SEED_READ_LENGTH,
      DEFAULT_SYNTHETIC_READ_LENGTH
    ),
  };
}

function userPrefix(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() || "USER";
}

function orderNumber(prefix: string, index: number): string {
  return `${SEED_DUMMY_ORDER_PREFIX}-${prefix}-${String(index).padStart(3, "0")}`;
}

function sampleId(prefix: string, orderIndex: number, sampleIndex: number): string {
  return `${prefix}-${orderIndex}${String(sampleIndex).padStart(2, "0")}`;
}

/**
 * Builds a deterministic dataset descriptor for the admin "seed dummy data" action.
 * Pure function: returns specs only, performs no DB or filesystem writes.
 */
export function buildDummySeedDataset(
  options: BuildDummySeedOptions
): DummySeedDataset {
  const prefix = userPrefix(options.ownerUserId);
  const fastqRelativeFolder = path.posix.join(
    SEED_DUMMY_FOLDER_ROOT,
    options.ownerUserId
  );
  const fastqAbsoluteFolder = path.resolve(
    options.dataBasePath,
    fastqRelativeFolder
  );

  const primaryPlatform = options.primaryPlatform ?? PLATFORM_ILLUMINA_NOVASEQ_WGS;
  const draftPlatform =
    options.draftPlatform ??
    (primaryPlatform.pairedEnd
      ? PLATFORM_ILLUMINA_MISEQ_AMPLICON
      : PLATFORM_ONT_MINION_AMPLICON);
  // Always include a single-end long-read order so single-end pipeline paths are
  // exercised even when both primary/draft orders happen to be paired-end Illumina.
  const longReadPlatform = options.longReadPlatform ?? PLATFORM_ONT_MINION_WGS;
  // The study-scoped dataset is paired-end Illumina by default so study-level pipelines
  // (mag, study-demo-report) always have a studyId target with real paired reads.
  const studyPlatform = options.studyPlatform ?? PLATFORM_ILLUMINA_NOVASEQ_WGS;

  const { readCount, readLength } = resolveSyntheticReadSize({
    syntheticReadCount: options.syntheticReadCount,
    syntheticReadLength: options.syntheticReadLength,
  });

  const study: DummyStudySpec = {
    title: `${STUDY_GUT_RECOVERY.titleBase} (${prefix})`,
    alias: `${STUDY_GUT_RECOVERY.aliasSlug}-seed-${prefix.toLowerCase()}`,
    description:
      "Sample dataset showcasing a longitudinal gut microbiome cohort. Seeded for demo/onboarding purposes.",
    checklistType: STUDY_GUT_RECOVERY.checklistType,
    principalInvestigator: STUDY_GUT_RECOVERY.principalInvestigator,
    abstract: STUDY_GUT_RECOVERY.abstract,
    readyForSubmission: true,
  };

  const studyScoped: DummyStudySpec = {
    title: `${STUDY_SURFACE_RESISTOME.titleBase} (${prefix})`,
    alias: `${STUDY_SURFACE_RESISTOME.aliasSlug}-seed-${prefix.toLowerCase()}`,
    description:
      "Study-scoped dataset with on-disk reads so study-level pipelines have a real target. Seeded for pipeline CI.",
    checklistType: STUDY_SURFACE_RESISTOME.checklistType,
    principalInvestigator: STUDY_SURFACE_RESISTOME.principalInvestigator,
    abstract: STUDY_SURFACE_RESISTOME.abstract,
    readyForSubmission: true,
  };

  // Distinct FASTQ files to materialise on disk. Keyed by file1Relative so two read
  // rows that reference the same on-disk file (e.g. raw + cleaned pointing at the
  // same fixture) only generate it once. Each distinct file gets its own deterministic
  // sampleIndex seed.
  const fastqTargetsByFile = new Map<string, DummyFastqTarget>();

  /**
   * Registers a FASTQ file (pair) on disk, returning the relative paths to embed in a
   * Read row. The `slug` becomes the on-disk file name and must be unique per distinct
   * fixture; reusing a slug returns the already-registered target.
   */
  const registerReadFiles = (
    sampleIdValue: string,
    slug: string,
    pairedEnd: boolean
  ): { file1Relative: string; file2Relative: string | null } => {
    const file1Relative = path.posix.join(
      fastqRelativeFolder,
      pairedEnd ? `${slug}_R1.fastq.gz` : `${slug}.fastq.gz`
    );
    const existing = fastqTargetsByFile.get(file1Relative);
    if (existing) {
      return {
        file1Relative: existing.file1Relative,
        file2Relative: existing.file2Relative,
      };
    }
    const file2Relative = pairedEnd
      ? path.posix.join(fastqRelativeFolder, `${slug}_R2.fastq.gz`)
      : null;
    const target: DummyFastqTarget = {
      sampleId: sampleIdValue,
      sampleIndex: fastqTargetsByFile.size,
      pairedEnd,
      file1Relative,
      file2Relative,
      file1Absolute: path.resolve(options.dataBasePath, file1Relative),
      file2Absolute: file2Relative
        ? path.resolve(options.dataBasePath, file2Relative)
        : null,
    };
    fastqTargetsByFile.set(file1Relative, target);
    return { file1Relative, file2Relative };
  };

  /** Builds one Read spec, registering its on-disk FASTQ file(s). */
  const buildRead = (
    sampleIdValue: string,
    slug: string,
    pairedEnd: boolean,
    classification: {
      dataClass: DummyReadSpec["dataClass"];
      dataClassSource: string;
      isActive: boolean;
    }
  ): DummyReadSpec => {
    const { file1Relative, file2Relative } = registerReadFiles(
      sampleIdValue,
      slug,
      pairedEnd
    );
    return { file1Relative, file2Relative, ...classification };
  };

  const fromTemplate = (
    template: SampleTemplate,
    orderIndex: number,
    sampleIndex: number,
    reads: (sampleIdValue: string) => DummyReadSpec[]
  ): DummySampleSpec => {
    const sampleIdValue = sampleId(prefix, orderIndex, sampleIndex);
    return {
      sampleId: sampleIdValue,
      sampleAlias: template.sampleAlias,
      sampleTitle: template.sampleTitle,
      scientificName: template.scientificName,
      taxId: template.taxId,
      checklistData: { ...template.checklistData },
      customFields: { ...template.customFields },
      reads: reads(sampleIdValue),
    };
  };

  // Order 1 — SUBMITTED gut-recovery cohort linked to the primary study.
  // GR-01 carries dataClass variety: an active "cleaned" read (preferred by selectRead),
  // an active "raw" read, plus an inactive superseded "raw" read. GR-02/03 carry a single
  // active "raw" read each (read-cleaning input candidates).
  const submittedSamples: DummySampleSpec[] = [
    fromTemplate(SAMPLE_GR_01, 1, 1, (id) => [
      buildRead(id, `${id}_cleaned`, primaryPlatform.pairedEnd, {
        dataClass: "cleaned",
        dataClassSource: "pipeline",
        isActive: true,
      }),
      buildRead(id, `${id}_raw`, primaryPlatform.pairedEnd, {
        dataClass: "raw",
        dataClassSource: "upload",
        isActive: true,
      }),
      buildRead(id, `${id}_raw_superseded`, primaryPlatform.pairedEnd, {
        dataClass: "raw",
        dataClassSource: "upload",
        isActive: false,
      }),
    ]),
    fromTemplate(SAMPLE_GR_02, 1, 2, (id) => [
      buildRead(id, id, primaryPlatform.pairedEnd, {
        dataClass: "raw",
        dataClassSource: "upload",
        isActive: true,
      }),
    ]),
    fromTemplate(SAMPLE_GR_03, 1, 3, (id) => [
      buildRead(id, id, primaryPlatform.pairedEnd, {
        dataClass: "raw",
        dataClassSource: "upload",
        isActive: true,
      }),
    ]),
  ];

  // Order 2 — DRAFT host-screening batch. Previously had no on-disk reads; now each
  // sample gets a generated FASTQ so draft-order pipelines can run too.
  const draftSamples: DummySampleSpec[] = [
    fromTemplate(SAMPLE_HS_01, 2, 1, (id) => [
      buildRead(id, id, draftPlatform.pairedEnd, {
        dataClass: "raw",
        dataClassSource: "upload",
        isActive: true,
      }),
    ]),
    fromTemplate(SAMPLE_HS_02, 2, 2, (id) => [
      buildRead(id, id, draftPlatform.pairedEnd, {
        dataClass: "cleaned",
        dataClassSource: "pipeline",
        isActive: true,
      }),
    ]),
  ];

  // Order 3 — dedicated single-end long-read order (always single-end).
  const longReadSamples: DummySampleSpec[] = [
    fromTemplate(SAMPLE_SR_01, 3, 1, (id) => [
      buildRead(id, id, false, {
        dataClass: "raw",
        dataClassSource: "sequencer_ingest",
        isActive: true,
      }),
    ]),
    fromTemplate(SAMPLE_SR_02, 3, 2, (id) => [
      buildRead(id, id, false, {
        dataClass: "raw",
        dataClassSource: "sequencer_ingest",
        isActive: true,
      }),
    ]),
  ];

  // Order 4 — study-scoped order whose samples connect to the dedicated study so
  // study-level pipelines (mag, study-demo-report) have a studyId target with reads.
  const studySamples: DummySampleSpec[] = [
    fromTemplate(SAMPLE_GR_01, 4, 1, (id) => [
      buildRead(id, id, studyPlatform.pairedEnd, {
        dataClass: "cleaned",
        dataClassSource: "pipeline",
        isActive: true,
      }),
    ]),
    fromTemplate(SAMPLE_GR_02, 4, 2, (id) => [
      buildRead(id, id, studyPlatform.pairedEnd, {
        dataClass: "cleaned",
        dataClassSource: "pipeline",
        isActive: true,
      }),
    ]),
    fromTemplate(SAMPLE_GR_03, 4, 3, (id) => [
      buildRead(id, id, studyPlatform.pairedEnd, {
        dataClass: "cleaned",
        dataClassSource: "pipeline",
        isActive: true,
      }),
    ]),
  ];

  const orders: DummyOrderSpecWithLink[] = [
    {
      orderNumber: orderNumber(prefix, 1),
      name: `Gut recovery metagenome cohort (seeded, ${primaryPlatform.instrumentModel})`,
      status: "SUBMITTED",
      numberOfSamples: submittedSamples.length,
      platform: null,
      sequencingTechSelection: buildSequencingTechSelection(primaryPlatform),
      instrumentModel: primaryPlatform.instrumentModel,
      libraryStrategy: primaryPlatform.libraryStrategy,
      librarySource: primaryPlatform.librarySource,
      samples: submittedSamples,
      studyLink: "primary",
    },
    {
      orderNumber: orderNumber(prefix, 2),
      name: `Draft host-associated screening batch (seeded, ${draftPlatform.instrumentModel})`,
      status: "DRAFT",
      numberOfSamples: draftSamples.length,
      platform: null,
      sequencingTechSelection: buildSequencingTechSelection(draftPlatform),
      instrumentModel: draftPlatform.instrumentModel,
      libraryStrategy: draftPlatform.libraryStrategy,
      librarySource: draftPlatform.librarySource,
      samples: draftSamples,
      studyLink: null,
    },
    {
      orderNumber: orderNumber(prefix, 3),
      name: `Long-read single-end batch (seeded, ${longReadPlatform.instrumentModel})`,
      status: "SUBMITTED",
      numberOfSamples: longReadSamples.length,
      platform: null,
      sequencingTechSelection: buildSequencingTechSelection(longReadPlatform),
      instrumentModel: longReadPlatform.instrumentModel,
      libraryStrategy: longReadPlatform.libraryStrategy,
      librarySource: longReadPlatform.librarySource,
      samples: longReadSamples,
      studyLink: null,
    },
    {
      orderNumber: orderNumber(prefix, 4),
      name: `Study-scoped metagenome batch (seeded, ${studyPlatform.instrumentModel})`,
      status: "SUBMITTED",
      numberOfSamples: studySamples.length,
      platform: null,
      sequencingTechSelection: buildSequencingTechSelection(studyPlatform),
      instrumentModel: studyPlatform.instrumentModel,
      libraryStrategy: studyPlatform.libraryStrategy,
      librarySource: studyPlatform.librarySource,
      samples: studySamples,
      studyLink: "study",
    },
  ];

  const sampleFastqTargets = Array.from(fastqTargetsByFile.values());

  return {
    ownerUserId: options.ownerUserId,
    fastqRelativeFolder,
    fastqAbsoluteFolder,
    study,
    studyScoped,
    orders,
    syntheticReadCount: readCount,
    syntheticReadLength: readLength,
    sampleFastqTargets,
  };
}

/**
 * Returns the orderNumber prefix that identifies seeded orders for a given user.
 * Used by the wipe action to scope deletes to this admin's seeded data only.
 */
export function getSeedDummyOrderNumberPrefix(ownerUserId: string): string {
  return `${SEED_DUMMY_ORDER_PREFIX}-${userPrefix(ownerUserId)}-`;
}
