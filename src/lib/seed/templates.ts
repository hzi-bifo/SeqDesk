/**
 * Shared vocabulary for realistic seed datasets.
 * Used by both the admin "seed dummy data" feature and the public demo workspace
 * so naming, species attribution, and metadata stay in sync between them.
 */
import type {
  SequencingPlatformFamily,
  SequencingReadLengthClass,
  SequencingReadLayout,
  SequencingTechSelection,
} from "@/types/sequencing-technology";

export interface StudyTemplate {
  titleBase: string;
  aliasSlug: string;
  description: string;
  checklistType: string;
  principalInvestigator: string;
  abstract: string;
}

export interface SampleTemplate {
  sampleAlias: string;
  sampleTitle: string;
  scientificName: string;
  taxId: string;
  checklistData: Record<string, string>;
  customFields: Record<string, string>;
}

export interface PlatformProfile {
  platform: string;
  technologyId: string;
  technologyName: string;
  platformFamily: SequencingPlatformFamily;
  readLengthClass: SequencingReadLengthClass;
  supportedReadLayouts: SequencingReadLayout[];
  deviceId?: string;
  deviceName?: string;
  instrumentModel: string;
  libraryStrategy: string;
  librarySource: string;
  /** True for paired-end (Illumina); false for long-read single-end (ONT / PacBio). */
  pairedEnd: boolean;
}

export const STUDY_GUT_RECOVERY: StudyTemplate = {
  titleBase: "Gut Recovery Cohort",
  aliasSlug: "gut-recovery",
  description:
    "Longitudinal metagenome study tracking recovery after treatment.",
  checklistType: "Human Gut",
  principalInvestigator: "Dr. Lena Hartmann",
  abstract:
    "Longitudinal study following gut microbiome recovery after antibiotic treatment.",
};

export const STUDY_SURFACE_RESISTOME: StudyTemplate = {
  titleBase: "Surface Resistome Pilot",
  aliasSlug: "surface-pilot",
  description:
    "Pilot study comparing resistome profiles from surface swab collections.",
  checklistType: "Built Environment",
  principalInvestigator: "Dr. Maya Nguyen",
  abstract:
    "Pilot screen of resistome markers across public-touch surface samples.",
};

export const PLATFORM_ILLUMINA_NOVASEQ_WGS: PlatformProfile = {
  platform: "ILLUMINA",
  technologyId: "illumina-novaseq",
  technologyName: "NovaSeq 6000/X",
  platformFamily: "illumina",
  readLengthClass: "short",
  supportedReadLayouts: ["single", "paired"],
  instrumentModel: "NovaSeq 6000",
  libraryStrategy: "WGS",
  librarySource: "METAGENOMIC",
  pairedEnd: true,
};

export const PLATFORM_ILLUMINA_MISEQ_AMPLICON: PlatformProfile = {
  platform: "ILLUMINA",
  technologyId: "illumina-miseq",
  technologyName: "MiSeq",
  platformFamily: "illumina",
  readLengthClass: "short",
  supportedReadLayouts: ["single", "paired"],
  instrumentModel: "MiSeq",
  libraryStrategy: "AMPLICON",
  librarySource: "METAGENOMIC",
  pairedEnd: true,
};

export const PLATFORM_ILLUMINA_NEXTSEQ_WGS: PlatformProfile = {
  platform: "ILLUMINA",
  technologyId: "illumina-nextseq",
  technologyName: "NextSeq 2000",
  platformFamily: "illumina",
  readLengthClass: "short",
  supportedReadLayouts: ["single", "paired"],
  instrumentModel: "NextSeq 2000",
  libraryStrategy: "WGS",
  librarySource: "METAGENOMIC",
  pairedEnd: true,
};

export const PLATFORM_ONT_MINION_WGS: PlatformProfile = {
  platform: "OXFORD_NANOPORE",
  technologyId: "ont-minion",
  technologyName: "MinION",
  platformFamily: "oxford-nanopore",
  readLengthClass: "long",
  supportedReadLayouts: ["single"],
  instrumentModel: "MinION",
  libraryStrategy: "WGS",
  librarySource: "METAGENOMIC",
  pairedEnd: false,
};

export const PLATFORM_ONT_MINION_AMPLICON: PlatformProfile = {
  platform: "OXFORD_NANOPORE",
  technologyId: "ont-minion",
  technologyName: "MinION",
  platformFamily: "oxford-nanopore",
  readLengthClass: "long",
  supportedReadLayouts: ["single"],
  instrumentModel: "MinION",
  libraryStrategy: "AMPLICON",
  librarySource: "METAGENOMIC",
  pairedEnd: false,
};

export const PLATFORM_ONT_PROMETHION_WGS: PlatformProfile = {
  platform: "OXFORD_NANOPORE",
  technologyId: "ont-promethion",
  technologyName: "PromethION",
  platformFamily: "oxford-nanopore",
  readLengthClass: "long",
  supportedReadLayouts: ["single"],
  instrumentModel: "PromethION",
  libraryStrategy: "WGS",
  librarySource: "METAGENOMIC",
  pairedEnd: false,
};

export const PLATFORM_PACBIO_REVIO_WGS: PlatformProfile = {
  platform: "PACBIO_SMRT",
  technologyId: "pacbio-revio",
  technologyName: "Revio",
  platformFamily: "pacbio",
  readLengthClass: "long",
  supportedReadLayouts: ["single"],
  instrumentModel: "Revio",
  libraryStrategy: "WGS",
  librarySource: "METAGENOMIC",
  pairedEnd: false,
};

export const PLATFORM_PACBIO_SEQUEL2_WGS: PlatformProfile = {
  platform: "PACBIO_SMRT",
  technologyId: "pacbio-sequel2",
  technologyName: "Sequel IIe",
  platformFamily: "pacbio",
  readLengthClass: "long",
  supportedReadLayouts: ["single"],
  instrumentModel: "Sequel IIe",
  libraryStrategy: "WGS",
  librarySource: "METAGENOMIC",
  pairedEnd: false,
};

export const PLATFORM_MGI_DNBSEQ_T7_WGS: PlatformProfile = {
  platform: "DNBSEQ",
  technologyId: "mgi-dnbseq-t7",
  technologyName: "DNBSEQ-T7",
  platformFamily: "mgi",
  readLengthClass: "short",
  supportedReadLayouts: ["single", "paired"],
  instrumentModel: "DNBSEQ-T7",
  libraryStrategy: "WGS",
  librarySource: "METAGENOMIC",
  pairedEnd: true,
};

export function buildSequencingTechSelection(
  profile: PlatformProfile
): SequencingTechSelection {
  return {
    technologyId: profile.technologyId,
    technologyName: profile.technologyName,
    platformFamily: profile.platformFamily,
    readLengthClass: profile.readLengthClass,
    supportedReadLayouts: profile.supportedReadLayouts,
    deviceId: profile.deviceId,
    deviceName: profile.deviceName,
  };
}

/**
 * Maps a sequencing-technology id (as used in data/sequencing-technologies/defaults.json
 * and SiteSettings.extraSettings.sequencingTechConfig) to a default platform profile.
 * Used by the seed factory to pick a platform that matches what the install has configured.
 */
export const PLATFORM_BY_TECH_ID: Record<string, PlatformProfile> = {
  "illumina-novaseq": PLATFORM_ILLUMINA_NOVASEQ_WGS,
  "illumina-miseq": PLATFORM_ILLUMINA_MISEQ_AMPLICON,
  "illumina-nextseq": PLATFORM_ILLUMINA_NEXTSEQ_WGS,
  "ont-minion": PLATFORM_ONT_MINION_WGS,
  "ont-promethion": PLATFORM_ONT_PROMETHION_WGS,
  "pacbio-revio": PLATFORM_PACBIO_REVIO_WGS,
  "pacbio-sequel2": PLATFORM_PACBIO_SEQUEL2_WGS,
  "mgi-dnbseq-t7": PLATFORM_MGI_DNBSEQ_T7_WGS,
};

/** Long-read single-end fallback when ONT/PacBio is configured but no specific match. */
export const PLATFORM_LONG_READ_FALLBACK: PlatformProfile = PLATFORM_ONT_MINION_WGS;

/** Short-read paired-end fallback when nothing is configured. */
export const PLATFORM_SHORT_READ_FALLBACK: PlatformProfile = PLATFORM_ILLUMINA_NOVASEQ_WGS;

const GUT_BASE = {
  scientificName: "human gut metagenome",
  taxId: "408170",
  geographic_location: "Germany:Lower Saxony:Braunschweig",
  host_body_site: "stool",
};

export const SAMPLE_GR_01: SampleTemplate = {
  sampleAlias: "GR-01",
  sampleTitle: "Gut recovery day 0",
  scientificName: GUT_BASE.scientificName,
  taxId: GUT_BASE.taxId,
  checklistData: {
    collection_date: "2026-02-01",
    geographic_location: GUT_BASE.geographic_location,
    host_body_site: GUT_BASE.host_body_site,
  },
  customFields: { sample_volume: "50", sample_concentration: "24" },
};

export const SAMPLE_GR_02: SampleTemplate = {
  sampleAlias: "GR-02",
  sampleTitle: "Gut recovery day 14",
  scientificName: GUT_BASE.scientificName,
  taxId: GUT_BASE.taxId,
  checklistData: {
    collection_date: "2026-02-14",
    geographic_location: GUT_BASE.geographic_location,
    host_body_site: GUT_BASE.host_body_site,
  },
  customFields: { sample_volume: "48", sample_concentration: "22" },
};

export const SAMPLE_GR_03: SampleTemplate = {
  sampleAlias: "GR-03",
  sampleTitle: "Gut recovery day 28",
  scientificName: GUT_BASE.scientificName,
  taxId: GUT_BASE.taxId,
  checklistData: {
    collection_date: "2026-02-28",
    geographic_location: GUT_BASE.geographic_location,
    host_body_site: GUT_BASE.host_body_site,
  },
  customFields: { sample_volume: "52", sample_concentration: "25" },
};

export const SAMPLE_HS_01: SampleTemplate = {
  sampleAlias: "HS-01",
  sampleTitle: "Host sample 01",
  scientificName: GUT_BASE.scientificName,
  taxId: GUT_BASE.taxId,
  checklistData: {},
  customFields: { sample_volume: "40", sample_concentration: "18" },
};

export const SAMPLE_HS_02: SampleTemplate = {
  sampleAlias: "HS-02",
  sampleTitle: "Host sample 02",
  scientificName: GUT_BASE.scientificName,
  taxId: GUT_BASE.taxId,
  checklistData: {},
  customFields: { sample_volume: "45", sample_concentration: "20" },
};

const SURFACE_BASE = {
  scientificName: "metagenome",
  taxId: "256318",
  collection_date: "2026-01-19",
  geographic_location: "Germany:Lower Saxony:Braunschweig",
  env_broad_scale: "built environment",
};

export const SAMPLE_SR_01: SampleTemplate = {
  sampleAlias: "SR-01",
  sampleTitle: "Surface swab entry rail",
  scientificName: SURFACE_BASE.scientificName,
  taxId: SURFACE_BASE.taxId,
  checklistData: {
    collection_date: SURFACE_BASE.collection_date,
    geographic_location: SURFACE_BASE.geographic_location,
    env_broad_scale: SURFACE_BASE.env_broad_scale,
  },
  customFields: { sample_volume: "35", sample_concentration: "15" },
};

export const SAMPLE_SR_02: SampleTemplate = {
  sampleAlias: "SR-02",
  sampleTitle: "Surface swab door handle",
  scientificName: SURFACE_BASE.scientificName,
  taxId: SURFACE_BASE.taxId,
  checklistData: {
    collection_date: SURFACE_BASE.collection_date,
    geographic_location: SURFACE_BASE.geographic_location,
    env_broad_scale: SURFACE_BASE.env_broad_scale,
  },
  customFields: { sample_volume: "38", sample_concentration: "17" },
};
