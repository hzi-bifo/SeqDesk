import * as path from "path";
import {
  PLATFORM_ILLUMINA_MISEQ_AMPLICON,
  PLATFORM_ILLUMINA_NOVASEQ_WGS,
  PLATFORM_ONT_MINION_AMPLICON,
  SAMPLE_GR_01,
  SAMPLE_GR_02,
  SAMPLE_GR_03,
  SAMPLE_HS_01,
  SAMPLE_HS_02,
  STUDY_GUT_RECOVERY,
  type PlatformProfile,
  type SampleTemplate,
} from "./templates";

export const SEED_DUMMY_MARKER = "admin-dummy";
export const SEED_DUMMY_ORDER_PREFIX = "SEED-DUMMY";
export const SEED_DUMMY_FOLDER_ROOT = "seed-dummy";
/** SiteSettings.extraSettings JSON key for the persisted "dummy data enabled" flag. */
export const SEED_DUMMY_ENABLED_KEY = "dummyDataEnabled";

export interface DummySampleSpec {
  sampleId: string;
  sampleAlias: string;
  sampleTitle: string;
  scientificName: string;
  taxId: string;
  checklistData: Record<string, string>;
  customFields: Record<string, string>;
  reads?: {
    file1Relative: string;
    /** Null for single-end (long-read ONT/PacBio); set for paired-end (Illumina). */
    file2Relative: string | null;
  };
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
  platform: string;
  instrumentModel: string;
  libraryStrategy: string;
  librarySource: string;
  samples: DummySampleSpec[];
  linkSamplesToStudy: boolean;
}

export interface DummySeedDataset {
  ownerUserId: string;
  fastqRelativeFolder: string;
  fastqAbsoluteFolder: string;
  study: DummyStudySpec;
  orders: DummyOrderSpec[];
  /** Sample read targets that need on-disk FASTQ files generated. */
  sampleFastqTargets: Array<{
    sampleId: string;
    sampleIndex: number;
    pairedEnd: boolean;
    file1Relative: string;
    file1Absolute: string;
    /** Null for single-end (long-read ONT/PacBio). */
    file2Relative: string | null;
    file2Absolute: string | null;
  }>;
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

  const readPaths = (alias: string, pairedEnd: boolean) => {
    if (pairedEnd) {
      return {
        file1Relative: path.posix.join(fastqRelativeFolder, `${alias}_R1.fastq.gz`),
        file2Relative: path.posix.join(fastqRelativeFolder, `${alias}_R2.fastq.gz`),
      };
    }
    return {
      file1Relative: path.posix.join(fastqRelativeFolder, `${alias}.fastq.gz`),
      file2Relative: null as string | null,
    };
  };

  const fromTemplate = (
    template: SampleTemplate,
    orderIndex: number,
    sampleIndex: number,
    pairedEnd: boolean | null
  ): DummySampleSpec => ({
    sampleId: sampleId(prefix, orderIndex, sampleIndex),
    sampleAlias: template.sampleAlias,
    sampleTitle: template.sampleTitle,
    scientificName: template.scientificName,
    taxId: template.taxId,
    checklistData: { ...template.checklistData },
    customFields: { ...template.customFields },
    ...(pairedEnd !== null
      ? { reads: readPaths(template.sampleAlias, pairedEnd) }
      : {}),
  });

  const submittedSamples: DummySampleSpec[] = [
    fromTemplate(SAMPLE_GR_01, 1, 1, primaryPlatform.pairedEnd),
    fromTemplate(SAMPLE_GR_02, 1, 2, primaryPlatform.pairedEnd),
    fromTemplate(SAMPLE_GR_03, 1, 3, primaryPlatform.pairedEnd),
  ];

  const draftSamples: DummySampleSpec[] = [
    fromTemplate(SAMPLE_HS_01, 2, 1, null),
    fromTemplate(SAMPLE_HS_02, 2, 2, null),
  ];

  const orders: DummyOrderSpec[] = [
    {
      orderNumber: orderNumber(prefix, 1),
      name: `Gut recovery metagenome cohort (seeded, ${primaryPlatform.instrumentModel})`,
      status: "SUBMITTED",
      numberOfSamples: submittedSamples.length,
      platform: primaryPlatform.platform,
      instrumentModel: primaryPlatform.instrumentModel,
      libraryStrategy: primaryPlatform.libraryStrategy,
      librarySource: primaryPlatform.librarySource,
      samples: submittedSamples,
      linkSamplesToStudy: true,
    },
    {
      orderNumber: orderNumber(prefix, 2),
      name: `Draft host-associated screening batch (seeded, ${draftPlatform.instrumentModel})`,
      status: "DRAFT",
      numberOfSamples: draftSamples.length,
      platform: draftPlatform.platform,
      instrumentModel: draftPlatform.instrumentModel,
      libraryStrategy: draftPlatform.libraryStrategy,
      librarySource: draftPlatform.librarySource,
      samples: draftSamples,
      linkSamplesToStudy: false,
    },
  ];

  const sampleFastqTargets = submittedSamples.map((sample, index) => ({
    sampleId: sample.sampleId,
    sampleIndex: index,
    pairedEnd: primaryPlatform.pairedEnd,
    file1Relative: sample.reads!.file1Relative,
    file2Relative: sample.reads!.file2Relative,
    file1Absolute: path.resolve(options.dataBasePath, sample.reads!.file1Relative),
    file2Absolute: sample.reads!.file2Relative
      ? path.resolve(options.dataBasePath, sample.reads!.file2Relative)
      : null,
  }));

  return {
    ownerUserId: options.ownerUserId,
    fastqRelativeFolder,
    fastqAbsoluteFolder,
    study,
    orders,
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
