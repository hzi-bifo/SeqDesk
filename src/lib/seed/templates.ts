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
  checklistType: "human-gut",
  principalInvestigator: "Dr. Lena Hartmann",
  abstract:
    "Longitudinal study following gut microbiome recovery after antibiotic treatment.",
};

export const STUDY_SURFACE_RESISTOME: StudyTemplate = {
  titleBase: "Surface Resistome Pilot",
  aliasSlug: "surface-pilot",
  description:
    "Pilot study comparing resistome profiles from surface swab collections.",
  checklistType: "misc-environment",
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

// Checklist field VALUES use the canonical MIxS registry field names (matching the
// data/field-templates/mixs-full/*.json `name`s exactly) so they render in the per-sample
// questionnaire for the study's resolved checklist. Geographic + environmental-context
// triples are the MIxS-required ENVO/UBERON-annotated terms.
const GUT_MIXS = {
  geographic_location_country_and_or_sea: "Germany",
  geographic_location_latitude: "52.27",
  geographic_location_longitude: "10.52",
  geographic_location_region_and_locality: "Lower Saxony, Braunschweig",
  broad_scale_environmental_context: "human-associated habitat [ENVO:00009003]",
  local_environmental_context: "gastrointestinal tract [UBERON:0001555]",
  environmental_medium: "feces [UBERON:0001988]",
  host_body_site: "gastrointestinal tract [UBERON:0001555]",
  host_disease_status: "recovering",
};

const GUT_BASE = {
  scientificName: "human gut metagenome",
  taxId: "408170",
};

export const SAMPLE_GR_01: SampleTemplate = {
  sampleAlias: "GR-01",
  sampleTitle: "Gut recovery day 0",
  scientificName: GUT_BASE.scientificName,
  taxId: GUT_BASE.taxId,
  checklistData: {
    ...GUT_MIXS,
    collection_date: "2026-02-01",
    host_subject_id: "DONOR-001",
    host_age: "42",
  },
  customFields: { sample_volume: "50", sample_concentration: "24" },
};

export const SAMPLE_GR_02: SampleTemplate = {
  sampleAlias: "GR-02",
  sampleTitle: "Gut recovery day 14",
  scientificName: GUT_BASE.scientificName,
  taxId: GUT_BASE.taxId,
  checklistData: {
    ...GUT_MIXS,
    collection_date: "2026-02-14",
    host_subject_id: "DONOR-001",
    host_age: "42",
  },
  customFields: { sample_volume: "48", sample_concentration: "22" },
};

export const SAMPLE_GR_03: SampleTemplate = {
  sampleAlias: "GR-03",
  sampleTitle: "Gut recovery day 28",
  scientificName: GUT_BASE.scientificName,
  taxId: GUT_BASE.taxId,
  checklistData: {
    ...GUT_MIXS,
    collection_date: "2026-02-28",
    host_subject_id: "DONOR-001",
    host_age: "42",
  },
  customFields: { sample_volume: "52", sample_concentration: "25" },
};

const HOST_MIXS = {
  geographic_location_country_and_or_sea: "Germany",
  geographic_location_latitude: "52.27",
  geographic_location_longitude: "10.52",
  broad_scale_environmental_context: "host-associated habitat [ENVO:00009003]",
  local_environmental_context: "skin [UBERON:0002097]",
  environmental_medium: "skin swab [ENVO:01001442]",
  host_common_name: "human",
  host_disease_status: "healthy",
};

export const SAMPLE_HS_01: SampleTemplate = {
  sampleAlias: "HS-01",
  sampleTitle: "Host-associated skin swab 01",
  scientificName: "human skin metagenome",
  taxId: "539655",
  checklistData: {
    ...HOST_MIXS,
    collection_date: "2026-01-22",
    host_subject_id: "VOL-014",
    host_age: "29",
  },
  customFields: { sample_volume: "40", sample_concentration: "18" },
};

export const SAMPLE_HS_02: SampleTemplate = {
  sampleAlias: "HS-02",
  sampleTitle: "Host-associated skin swab 02",
  scientificName: "human skin metagenome",
  taxId: "539655",
  checklistData: {
    ...HOST_MIXS,
    collection_date: "2026-01-22",
    host_subject_id: "VOL-015",
    host_age: "34",
  },
  customFields: { sample_volume: "45", sample_concentration: "20" },
};

const SURFACE_MIXS = {
  geographic_location_country_and_or_sea: "Germany",
  geographic_location_latitude: "52.27",
  geographic_location_longitude: "10.52",
  geographic_location_region_and_locality: "Lower Saxony, Braunschweig",
  broad_scale_environmental_context: "built environment [ENVO:00000073]",
  local_environmental_context: "transit station [ENVO:03600013]",
  environmental_medium: "surface swab [ENVO:01001442]",
};

export const SAMPLE_SR_01: SampleTemplate = {
  sampleAlias: "SR-01",
  sampleTitle: "Surface swab entry rail",
  scientificName: "metagenome",
  taxId: "256318",
  checklistData: { ...SURFACE_MIXS, collection_date: "2026-01-19" },
  customFields: { sample_volume: "35", sample_concentration: "15" },
};

export const SAMPLE_SR_02: SampleTemplate = {
  sampleAlias: "SR-02",
  sampleTitle: "Surface swab door handle",
  scientificName: "metagenome",
  taxId: "256318",
  checklistData: { ...SURFACE_MIXS, collection_date: "2026-01-19" },
  customFields: { sample_volume: "38", sample_concentration: "17" },
};

// ── Additional demo studies across environment packages (soil + freshwater) ──
export const STUDY_SOIL_RESILIENCE: StudyTemplate = {
  titleBase: "Soil Resilience Survey",
  aliasSlug: "soil-resilience",
  description:
    "Agricultural soil metagenomes profiling microbial resilience across a tillage gradient.",
  checklistType: "soil",
  principalInvestigator: "Dr. Aisha Okonkwo",
  abstract:
    "Shotgun metagenomes of arable topsoil sampled along a reduced-tillage management gradient.",
};

export const STUDY_RIVER_WATER: StudyTemplate = {
  titleBase: "River Water Microbiome",
  aliasSlug: "river-water",
  description:
    "Freshwater metagenomes tracking the river microbiome across an urban-to-rural transect.",
  checklistType: "water",
  principalInvestigator: "Dr. Tomas Eriksson",
  abstract:
    "Time-series shotgun metagenomes of surface river water along an urbanisation gradient.",
};

const SOIL_MIXS = {
  geographic_location_country_and_or_sea: "Germany",
  geographic_location_latitude: "51.83",
  geographic_location_longitude: "10.05",
  geographic_location_region_and_locality: "Lower Saxony, Harz foreland",
  broad_scale_environmental_context: "terrestrial biome [ENVO:00000446]",
  local_environmental_context: "agricultural field [ENVO:00000114]",
  environmental_medium: "agricultural soil [ENVO:00002259]",
  depth: "0-10 cm",
  elevation: "182 m",
};

export const SAMPLE_SOIL_01: SampleTemplate = {
  sampleAlias: "SOIL-01",
  sampleTitle: "Topsoil — conventional tillage",
  scientificName: "soil metagenome",
  taxId: "410658",
  checklistData: { ...SOIL_MIXS, collection_date: "2026-04-08" },
  customFields: { sample_volume: "30", sample_concentration: "31" },
};

export const SAMPLE_SOIL_02: SampleTemplate = {
  sampleAlias: "SOIL-02",
  sampleTitle: "Topsoil — reduced tillage",
  scientificName: "soil metagenome",
  taxId: "410658",
  checklistData: { ...SOIL_MIXS, collection_date: "2026-04-08" },
  customFields: { sample_volume: "30", sample_concentration: "28" },
};

const WATER_MIXS = {
  geographic_location_country_and_or_sea: "Germany",
  geographic_location_latitude: "52.13",
  geographic_location_longitude: "10.78",
  geographic_location_region_and_locality: "Oker river, Lower Saxony",
  broad_scale_environmental_context: "freshwater biome [ENVO:00000873]",
  local_environmental_context: "river [ENVO:00000022]",
  environmental_medium: "river water [ENVO:01000599]",
  depth: "0.5 m",
};

export const SAMPLE_WATER_01: SampleTemplate = {
  sampleAlias: "WATER-01",
  sampleTitle: "River water — upstream rural",
  scientificName: "freshwater metagenome",
  taxId: "449393",
  checklistData: { ...WATER_MIXS, collection_date: "2026-05-12" },
  customFields: { sample_volume: "1000", sample_concentration: "9" },
};

export const SAMPLE_WATER_02: SampleTemplate = {
  sampleAlias: "WATER-02",
  sampleTitle: "River water — downstream urban",
  scientificName: "freshwater metagenome",
  taxId: "449393",
  checklistData: { ...WATER_MIXS, collection_date: "2026-05-12" },
  customFields: { sample_volume: "1000", sample_concentration: "12" },
};
