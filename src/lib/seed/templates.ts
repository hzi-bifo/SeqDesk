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

// ── IBD gut-metagenome case-control cohort (fully synthetic demo data) ──
// A fictitious inflammatory-bowel-disease microbiome study: Crohn's disease + ulcerative
// colitis cases vs matched healthy controls, with a week-12 follow-up timepoint and a
// planned long-read validation batch. Sample metadata is deliberately TECHNICAL and
// environmental (sample collection, processing, sequencing) plus a coarse study_cohort
// label — NO patient clinical records (no demographics, diagnoses, lab values,
// medications, or disease staging), to keep clear that SeqDesk is not for private patient
// data. checklistData keys are verbatim human-gut MIxS registry names (ERC000015,
// mixs-humangut.json) so they render in the per-sample MIxS grid.
export const STUDY_IBD_COHORT: StudyTemplate = {
  titleBase: "IBD Gut Metagenome Cohort",
  aliasSlug: "ibd-gut-cohort",
  description:
    "Synthetic shotgun-metagenomics case-control cohort of the inflammatory-bowel-disease (IBD) gut microbiome, contrasting Crohn's disease and ulcerative colitis against matched healthy controls across faecal and colonic-biopsy specimens, annotated with technical sequencing and sample-processing metadata. Demo data only — no private patient information.",
  checklistType: "human-gut",
  principalInvestigator: "Dr. Hannah Weiss",
  abstract:
    "A fully synthetic demonstration cohort profiling the gut metagenome across an IBD case-control design (Crohn's disease, ulcerative colitis, and matched healthy controls) with a week-12 follow-up timepoint. Samples are annotated with technical sequencing, library-preparation and QC metadata plus standard environmental and sample-collection descriptors — deliberately no patient clinical records (no demographics, diagnoses, lab values, medications, or disease staging). All identifiers, accessions, and values are fictitious and for demonstration only.",
};

const IBD_COHORT_MIXS = {
  project_name: "Synthetic IBD gut metagenome case-control cohort 2025",
  geographic_location_country_and_or_sea: "Germany",
  geographic_location_latitude: "52.39",
  geographic_location_longitude: "9.71",
  geographic_location_region_and_locality: "Lower Saxony, Hannover",
  broad_scale_environmental_context: "human-associated habitat [ENVO:00009003]",
  sample_storage_temperature: "-80",
  oxygenation_status_of_sample: "anaerobic",
  sequencing_method: "Illumina NovaSeq 6000",
  sequence_quality_check: "software",
  library_construction_method: "Illumina DNA Prep (tagmentation)",
};

const IBD_GUT_BASE = { scientificName: "human gut metagenome", taxId: "408170" };

export const SAMPLE_IBD_CD_01: SampleTemplate = {
  sampleAlias: "IBD-CD-01",
  sampleTitle: "Crohn's disease gut metagenome (subject IBD-0042, stool, baseline)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-02-11",
    local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
    environmental_medium: "feces [ENVO:00002003]",
    host_subject_id: "IBD-0042",
    host_body_site: "feces [UBERON:0001988]",
    host_body_product: "feces",
    sample_collection_method: "self-collected stool, OMNIgene-GUT collection tube",
    sample_material_processing: "snap-frozen at collection; DNA extracted with QIAamp PowerFecal Pro",
    nucleic_acid_extraction: "QIAamp PowerFecal Pro DNA Kit",
  },
  customFields: {
    sample_volume: "50",
    sample_concentration: "24",
    study_cohort: "Crohn's disease (case)",
    specimen_type: "stool",
    timepoint: "baseline",
  },
};

export const SAMPLE_IBD_CD_02: SampleTemplate = {
  sampleAlias: "IBD-CD-02",
  sampleTitle: "Crohn's disease gut metagenome (subject IBD-0057, mucosal biopsy, baseline)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-02-19",
    local_environmental_context: "colon [UBERON:0001155]",
    environmental_medium: "intestinal mucosa [UBERON:0004515]",
    host_subject_id: "IBD-0057",
    host_body_site: "colonic mucosa [UBERON:0000317]",
    host_body_product: "mucosal biopsy",
    sample_collection_method: "endoscopic forceps biopsy during colonoscopy",
    sample_material_processing: "biopsy snap-frozen in liquid nitrogen; DNA extracted with QIAamp DNA Microbiome Kit",
    nucleic_acid_extraction: "QIAamp DNA Microbiome Kit",
  },
  customFields: {
    sample_volume: "30",
    sample_concentration: "12",
    study_cohort: "Crohn's disease (case)",
    specimen_type: "mucosal_biopsy",
    biopsy_site: "descending colon",
    timepoint: "baseline",
  },
};

export const SAMPLE_IBD_UC_01: SampleTemplate = {
  sampleAlias: "IBD-UC-01",
  sampleTitle: "Ulcerative colitis gut metagenome (subject IBD-0061, stool, baseline)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-03-04",
    local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
    environmental_medium: "feces [ENVO:00002003]",
    host_subject_id: "IBD-0061",
    host_body_site: "feces [UBERON:0001988]",
    host_body_product: "feces",
    sample_collection_method: "self-collected stool, OMNIgene-GUT collection tube",
    sample_material_processing: "snap-frozen at collection; DNA extracted with QIAamp PowerFecal Pro",
    nucleic_acid_extraction: "QIAamp PowerFecal Pro DNA Kit",
  },
  customFields: {
    sample_volume: "48",
    sample_concentration: "22",
    study_cohort: "ulcerative colitis (case)",
    specimen_type: "stool",
    timepoint: "baseline",
  },
};

export const SAMPLE_IBD_UC_02: SampleTemplate = {
  sampleAlias: "IBD-UC-02",
  sampleTitle: "Ulcerative colitis gut metagenome (subject IBD-0073, stool, baseline)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-03-12",
    local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
    environmental_medium: "feces [ENVO:00002003]",
    host_subject_id: "IBD-0073",
    host_body_site: "feces [UBERON:0001988]",
    host_body_product: "feces",
    sample_collection_method: "self-collected stool, OMNIgene-GUT collection tube",
    sample_material_processing: "snap-frozen at collection; DNA extracted with QIAamp PowerFecal Pro",
    nucleic_acid_extraction: "QIAamp PowerFecal Pro DNA Kit",
  },
  customFields: {
    sample_volume: "46",
    sample_concentration: "21",
    study_cohort: "ulcerative colitis (case)",
    specimen_type: "stool",
    timepoint: "baseline",
  },
};

export const SAMPLE_IBD_HC_01: SampleTemplate = {
  sampleAlias: "IBD-HC-01",
  sampleTitle: "Healthy control gut metagenome (subject CTRL-0008, stool, baseline)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-03-18",
    local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
    environmental_medium: "feces [ENVO:00002003]",
    host_subject_id: "CTRL-0008",
    host_body_site: "feces [UBERON:0001988]",
    host_body_product: "feces",
    sample_collection_method: "self-collected stool, OMNIgene-GUT collection tube",
    sample_material_processing: "snap-frozen at collection; DNA extracted with QIAamp PowerFecal Pro",
    nucleic_acid_extraction: "QIAamp PowerFecal Pro DNA Kit",
  },
  customFields: {
    sample_volume: "52",
    sample_concentration: "25",
    study_cohort: "healthy control",
    specimen_type: "stool",
    timepoint: "baseline",
  },
};

export const SAMPLE_IBD_HC_02: SampleTemplate = {
  sampleAlias: "IBD-HC-02",
  sampleTitle: "Healthy control gut metagenome (subject CTRL-0015, stool, baseline)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-03-25",
    local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
    environmental_medium: "feces [ENVO:00002003]",
    host_subject_id: "CTRL-0015",
    host_body_site: "feces [UBERON:0001988]",
    host_body_product: "feces",
    sample_collection_method: "self-collected stool, OMNIgene-GUT collection tube",
    sample_material_processing: "snap-frozen at collection; DNA extracted with QIAamp PowerFecal Pro",
    nucleic_acid_extraction: "QIAamp PowerFecal Pro DNA Kit",
  },
  customFields: {
    sample_volume: "49",
    sample_concentration: "23",
    study_cohort: "healthy control",
    specimen_type: "stool",
    timepoint: "baseline",
  },
};

// Week-12 longitudinal follow-up specimens — the same subjects re-sequenced at a later timepoint.
export const SAMPLE_IBD_CD_01_W12: SampleTemplate = {
  sampleAlias: "IBD-CD-01-W12",
  sampleTitle: "Crohn's disease gut metagenome (subject IBD-0042, stool, week 12 follow-up)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-05-13",
    local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
    environmental_medium: "feces [ENVO:00002003]",
    host_subject_id: "IBD-0042",
    host_body_site: "feces [UBERON:0001988]",
    host_body_product: "feces",
    sample_collection_method: "self-collected stool, OMNIgene-GUT collection tube",
    sample_material_processing: "snap-frozen at collection; DNA extracted with QIAamp PowerFecal Pro",
    nucleic_acid_extraction: "QIAamp PowerFecal Pro DNA Kit",
  },
  customFields: {
    sample_volume: "50",
    sample_concentration: "24",
    study_cohort: "Crohn's disease (case)",
    specimen_type: "stool",
    timepoint: "week 12",
  },
};

export const SAMPLE_IBD_UC_01_W12: SampleTemplate = {
  sampleAlias: "IBD-UC-01-W12",
  sampleTitle: "Ulcerative colitis gut metagenome (subject IBD-0061, stool, week 12 follow-up)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-05-27",
    local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
    environmental_medium: "feces [ENVO:00002003]",
    host_subject_id: "IBD-0061",
    host_body_site: "feces [UBERON:0001988]",
    host_body_product: "feces",
    sample_collection_method: "self-collected stool, OMNIgene-GUT collection tube",
    sample_material_processing: "snap-frozen at collection; DNA extracted with QIAamp PowerFecal Pro",
    nucleic_acid_extraction: "QIAamp PowerFecal Pro DNA Kit",
  },
  customFields: {
    sample_volume: "48",
    sample_concentration: "22",
    study_cohort: "ulcerative colitis (case)",
    specimen_type: "stool",
    timepoint: "week 12",
  },
};

// Planned long-read confirmation specimens — DRAFT order, not yet sequenced (no reads attached).
export const SAMPLE_IBD_CD_01_LR: SampleTemplate = {
  sampleAlias: "IBD-CD-01-LR",
  sampleTitle: "Crohn's disease gut metagenome — long-read validation (subject IBD-0042, planned)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-06-02",
    local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
    environmental_medium: "feces [ENVO:00002003]",
    host_subject_id: "IBD-0042",
    host_body_site: "feces [UBERON:0001988]",
    host_body_product: "feces",
    sample_collection_method: "self-collected stool, OMNIgene-GUT collection tube",
    sample_material_processing: "snap-frozen at collection; DNA extracted with QIAamp PowerFecal Pro",
    nucleic_acid_extraction: "QIAamp PowerFecal Pro DNA Kit",
    sequencing_method: "Oxford Nanopore PromethION",
    library_construction_method: "Nanopore ligation sequencing (SQK-LSK114)",
  },
  customFields: {
    sample_volume: "50",
    sample_concentration: "24",
    study_cohort: "Crohn's disease (case)",
    specimen_type: "stool",
    timepoint: "validation (long-read)",
    sequencing_plan: "ONT PromethION confirmation",
  },
};

export const SAMPLE_IBD_CD_02_LR: SampleTemplate = {
  sampleAlias: "IBD-CD-02-LR",
  sampleTitle: "Crohn's disease gut metagenome — long-read validation (subject IBD-0057, planned)",
  scientificName: IBD_GUT_BASE.scientificName,
  taxId: IBD_GUT_BASE.taxId,
  checklistData: {
    ...IBD_COHORT_MIXS,
    collection_date: "2025-06-02",
    local_environmental_context: "colon [UBERON:0001155]",
    environmental_medium: "intestinal mucosa [UBERON:0004515]",
    host_subject_id: "IBD-0057",
    host_body_site: "colonic mucosa [UBERON:0000317]",
    host_body_product: "mucosal biopsy",
    sample_collection_method: "endoscopic forceps biopsy during colonoscopy",
    sample_material_processing: "biopsy snap-frozen in liquid nitrogen; DNA extracted with QIAamp DNA Microbiome Kit",
    nucleic_acid_extraction: "QIAamp DNA Microbiome Kit",
    sequencing_method: "Oxford Nanopore PromethION",
    library_construction_method: "Nanopore ligation sequencing (SQK-LSK114)",
  },
  customFields: {
    sample_volume: "30",
    sample_concentration: "12",
    study_cohort: "Crohn's disease (case)",
    specimen_type: "mucosal_biopsy",
    biopsy_site: "descending colon",
    timepoint: "validation (long-read)",
    sequencing_plan: "ONT PromethION confirmation",
  },
};

// ── Mouse gut microbiome DEMO study ──────────────────────────────────────────
// Presented in the demo as illustrative/made-up data: sample IDs (MGB-0x), subject
// codes (Subject-0x), study title/PI and accession fields are genericized demo
// values, NOT real database identifiers. Provenance (maintainers only): the
// underlying FASTQs and pipeline reports are representative REAL sequencing — the
// per-read md5 checksums and read counts in MOUSE_GUT_READS are the real values
// needed for the CI download/verification of those reads. checklistType is the
// host-associated checklist.
export const STUDY_MOUSE_GUT_PRJDB6165: StudyTemplate = {
  titleBase: "Mouse Gut Microbiome (Demo)",
  aliasSlug: "mouse-gut-microbiome",
  description:
    "Demonstration study of mouse faecal microbiota under a high-fat diet, comparing a control group with a treatment group. Sample identifiers and metadata are illustrative demo values; the sequencing reads and pipeline reports are representative real data.",
  checklistType: "host-associated",
  principalInvestigator: "SeqDesk Demo Facility",
  abstract:
    "A demonstration mouse gut-microbiome study used to showcase SeqDesk. Eight faecal 16S rRNA libraries (Illumina MiSeq): four high-fat-diet controls and four high-fat-diet treatment-group animals. Sample IDs, subject codes and lab values are illustrative demo data; the reads and pipeline outputs are wired from representative real sequencing.",
};

const MOUSE_GUT_MIXS = {
  project_name: "Mouse gut microbiome under a high-fat diet (demo study)",
  geographic_location_country_and_or_sea: "Japan",
  geographic_location_region_and_locality: "Tokyo",
  geographic_location_latitude: "35.70",
  geographic_location_longitude: "139.76",
  collection_date: "2016",
  broad_scale_environmental_context: "host-associated habitat [ENVO:00009003]",
  local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
  environmental_medium: "feces [ENVO:00002003]",
  host_body_site: "gastrointestinal tract [UBERON:0001555]",
  host_scientific_name: "Mus musculus",
  host_common_name: "house mouse",
  host_taxid: "10090",
  host_diet: "high-fat diet",
};

export const MOUSE_GUT_BASE = { scientificName: "mouse gut metagenome", taxId: "410661" };

export const SAMPLE_MOUSE_01: SampleTemplate = {
  sampleAlias: "MGB-01",
  sampleTitle: "16S rRNA from mouse faecal sample Subject-01",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "Subject-01",
  },
  customFields: {
    sample_name: "Subject-01",
    treatment: "high-fat diet (control group)",
    read_count: "91795",
    sample_volume: "45",
    sample_concentration: "28.4",
    a260_280_ratio: "1.92",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    concentration_device: "Qubit 4 Fluorometer",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_MOUSE_02: SampleTemplate = {
  sampleAlias: "MGB-02",
  sampleTitle: "16S rRNA from mouse faecal sample Subject-02",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "Subject-02",
  },
  customFields: {
    sample_name: "Subject-02",
    treatment: "high-fat diet (control group)",
    read_count: "90723",
    sample_volume: "48",
    sample_concentration: "31.2",
    a260_280_ratio: "1.95",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    concentration_device: "Qubit 4 Fluorometer",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_MOUSE_03: SampleTemplate = {
  sampleAlias: "MGB-03",
  sampleTitle: "16S rRNA from mouse faecal sample Subject-03",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "Subject-03",
  },
  customFields: {
    sample_name: "Subject-03",
    treatment: "high-fat diet (control group)",
    read_count: "107329",
    sample_volume: "42",
    sample_concentration: "24.7",
    a260_280_ratio: "1.88",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    concentration_device: "Qubit 4 Fluorometer",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_MOUSE_04: SampleTemplate = {
  sampleAlias: "MGB-04",
  sampleTitle: "16S rRNA from mouse faecal sample Subject-04",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "Subject-04",
  },
  customFields: {
    sample_name: "Subject-04",
    treatment: "high-fat diet (control group)",
    read_count: "82174",
    sample_volume: "50",
    sample_concentration: "33.5",
    a260_280_ratio: "1.97",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    concentration_device: "Qubit 4 Fluorometer",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_MOUSE_05: SampleTemplate = {
  sampleAlias: "MGB-05",
  sampleTitle: "16S rRNA from mouse faecal sample Subject-05",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "Subject-05",
  },
  customFields: {
    sample_name: "Subject-05",
    treatment: "high-fat diet (treatment group)",
    read_count: "99093",
    sample_volume: "38",
    sample_concentration: "19.8",
    a260_280_ratio: "1.83",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    concentration_device: "Qubit 4 Fluorometer",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_MOUSE_06: SampleTemplate = {
  sampleAlias: "MGB-06",
  sampleTitle: "16S rRNA from mouse faecal sample Subject-06",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "Subject-06",
  },
  customFields: {
    sample_name: "Subject-06",
    treatment: "high-fat diet (treatment group)",
    read_count: "117186",
    sample_volume: "52",
    sample_concentration: "34.1",
    a260_280_ratio: "1.96",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    concentration_device: "Qubit 4 Fluorometer",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_MOUSE_07: SampleTemplate = {
  sampleAlias: "MGB-07",
  sampleTitle: "16S rRNA from mouse faecal sample Subject-07",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "Subject-07",
  },
  customFields: {
    sample_name: "Subject-07",
    treatment: "high-fat diet (treatment group)",
    read_count: "99911",
    sample_volume: "40",
    sample_concentration: "22.6",
    a260_280_ratio: "1.86",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    concentration_device: "Qubit 4 Fluorometer",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_MOUSE_08: SampleTemplate = {
  sampleAlias: "MGB-08",
  sampleTitle: "16S rRNA from mouse faecal sample Subject-08",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "Subject-08",
  },
  customFields: {
    sample_name: "Subject-08",
    treatment: "high-fat diet (treatment group)",
    read_count: "90527",
    sample_volume: "36",
    sample_concentration: "17.9",
    a260_280_ratio: "1.80",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    concentration_device: "Qubit 4 Fluorometer",
    storage_temperature: "-80 °C",
  },
};

// Real run-level data per sample (accessions, md5 checksums, read counts) for
// wiring Read rows in the demo seed.
export const MOUSE_GUT_READS: Record<string, { run: string; experiment: string; checksum1: string; checksum2: string; readCount: number }> = {
  "MGB-01": { run: "DRR099973", experiment: "DRX093417", checksum1: "ad0c526823c70b5ad1c7c0dc150cbce4", checksum2: "4a280d9f9bd29622055cdf778f6aad67", readCount: 91795 },
  "MGB-02": { run: "DRR099974", experiment: "DRX093418", checksum1: "7bd36e4429524093b980c90ea7f3fc26", checksum2: "d93de56b3da3d0afba44c639bc2e25d6", readCount: 90723 },
  "MGB-03": { run: "DRR099975", experiment: "DRX093419", checksum1: "213e4d5e0fe792008acaa1372ecff93a", checksum2: "570d628b2704ef2b61165d5bf4de0cec", readCount: 107329 },
  "MGB-04": { run: "DRR099976", experiment: "DRX093420", checksum1: "cca1086517bd206e8b2f2cd93cabf997", checksum2: "ed69bf76113a90c3a30a7eb4c6ec18b0", readCount: 82174 },
  "MGB-05": { run: "DRR099977", experiment: "DRX093421", checksum1: "a6db63ae65c8e28619acbe98d94eacc6", checksum2: "c4f7f96e033d70f2fcadde83daec7f5a", readCount: 99093 },
  "MGB-06": { run: "DRR099978", experiment: "DRX093422", checksum1: "b2e00d8d2526545765966bdfccca64af", checksum2: "20a05817e94e2a2f96bfd184796c2d04", readCount: 117186 },
  "MGB-07": { run: "DRR099979", experiment: "DRX093423", checksum1: "589fe5ca3a652e576767bfb23c719c7e", checksum2: "6a6de694afc521f28cec2cd1421b90f2", readCount: 99911 },
  "MGB-08": { run: "DRR099980", experiment: "DRX093424", checksum1: "91527786815d17d5486b2289aac63389", checksum2: "b4e0fa748c8befdfc9dca2322c73495c", readCount: 90527 },
};
// ── Human gut shotgun metagenome DEMO study ──────────────────────────────────
// Presented in the demo as illustrative data: the study title/PI/description and
// the project accession are genericized demo values, NOT real database identifiers.
// Provenance (maintainers only): the underlying FASTQs are representative REAL
// public human faecal shotgun-metagenome libraries (Illumina paired-end WGS); the
// per-run md5 checksums and read counts in HUMAN_GUT_READS are the real values
// needed for the CI download/verification of those reads. A shotgun metagenome so
// the MAG pipeline (assembly + binning) is meaningful; submission-ready (taxId +
// collection date + geographic location present on every sample).
export const STUDY_HUMAN_GUT_PRJEB54724: StudyTemplate = {
  titleBase: "Human Gut Shotgun Metagenomes (Demo)",
  aliasSlug: "human-gut-shotgun",
  description:
    "Demonstration human faecal shotgun-metagenome study: twelve Illumina paired-end WGS libraries suitable for metagenome assembly (MAG). Sample identifiers and metadata are illustrative demo values; the sequencing reads and pipeline outputs are representative real data.",
  checklistType: "host-associated",
  principalInvestigator: "SeqDesk Demo Facility",
  abstract:
    "A demonstration human gut shotgun-metagenome study used to showcase SeqDesk's MAG assembly and taxonomic-profiling pipelines. Twelve Illumina paired-end WGS libraries; sample IDs, subject codes and lab values are illustrative demo data, while the reads and pipeline outputs are wired from representative real sequencing.",
};

export const HUMAN_GUT_MIXS = {
  project_name: "Human gut shotgun metagenome (demo)",
  geographic_location_country_and_or_sea: "Netherlands",
  broad_scale_environmental_context: "host-associated habitat [ENVO:00009003]",
  local_environmental_context: "gastrointestinal tract environment [ENVO:2100002]",
  environmental_medium: "feces [ENVO:00002003]",
  host_body_site: "gastrointestinal tract [UBERON:0001555]",
  host_scientific_name: "Homo sapiens",
  host_common_name: "human",
  host_taxid: "9606",
};

export const HUMAN_GUT_BASE = { scientificName: "human gut metagenome", taxId: "408170" };

export const SAMPLE_HGUT_01: SampleTemplate = {
  sampleAlias: "HGM-01",
  sampleTitle: "Human faecal shotgun metagenome Subject-01",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2016-05-12",
    host_subject_id: "Subject-01",
  },
  customFields: {
    sample_name: "Subject-01",
    collection_date: "2016-05-12",
    read_count: "466252",
    sample_volume: "42",
    sample_concentration: "24.1",
    a260_280_ratio: "1.88",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_02: SampleTemplate = {
  sampleAlias: "HGM-02",
  sampleTitle: "Human faecal shotgun metagenome Subject-02",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2016-02-16",
    host_subject_id: "Subject-02",
  },
  customFields: {
    sample_name: "Subject-02",
    collection_date: "2016-02-16",
    read_count: "672698",
    sample_volume: "38",
    sample_concentration: "19.8",
    a260_280_ratio: "1.82",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_03: SampleTemplate = {
  sampleAlias: "HGM-03",
  sampleTitle: "Human faecal shotgun metagenome Subject-03",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2016-08-16",
    host_subject_id: "Subject-03",
  },
  customFields: {
    sample_name: "Subject-03",
    collection_date: "2016-08-16",
    read_count: "707104",
    sample_volume: "55",
    sample_concentration: "31.5",
    a260_280_ratio: "1.95",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_04: SampleTemplate = {
  sampleAlias: "HGM-04",
  sampleTitle: "Human faecal shotgun metagenome Subject-04",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2017-02-16",
    host_subject_id: "Subject-04",
  },
  customFields: {
    sample_name: "Subject-04",
    collection_date: "2017-02-16",
    read_count: "659122",
    sample_volume: "47",
    sample_concentration: "27.2",
    a260_280_ratio: "1.90",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_05: SampleTemplate = {
  sampleAlias: "HGM-05",
  sampleTitle: "Human faecal shotgun metagenome Subject-05",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2016-03-01",
    host_subject_id: "Subject-05",
  },
  customFields: {
    sample_name: "Subject-05",
    collection_date: "2016-03-01",
    read_count: "492946",
    sample_volume: "40",
    sample_concentration: "21.0",
    a260_280_ratio: "1.84",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_06: SampleTemplate = {
  sampleAlias: "HGM-06",
  sampleTitle: "Human faecal shotgun metagenome Subject-06",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2018-09-28",
    host_subject_id: "Subject-06",
  },
  customFields: {
    sample_name: "Subject-06",
    collection_date: "2018-09-28",
    read_count: "608262",
    sample_volume: "52",
    sample_concentration: "29.8",
    a260_280_ratio: "1.94",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_07: SampleTemplate = {
  sampleAlias: "HGM-07",
  sampleTitle: "Human faecal shotgun metagenome Subject-07",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2018-09-11",
    host_subject_id: "Subject-07",
  },
  customFields: {
    sample_name: "Subject-07",
    collection_date: "2018-09-11",
    read_count: "806454",
    sample_volume: "36",
    sample_concentration: "17.4",
    a260_280_ratio: "1.79",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_08: SampleTemplate = {
  sampleAlias: "HGM-08",
  sampleTitle: "Human faecal shotgun metagenome Subject-08",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2016-04-08",
    host_subject_id: "Subject-08",
  },
  customFields: {
    sample_name: "Subject-08",
    collection_date: "2016-04-08",
    read_count: "662668",
    sample_volume: "49",
    sample_concentration: "26.6",
    a260_280_ratio: "1.91",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_09: SampleTemplate = {
  sampleAlias: "HGM-09",
  sampleTitle: "Human faecal shotgun metagenome Subject-09",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2016-05-12",
    host_subject_id: "Subject-09",
  },
  customFields: {
    sample_name: "Subject-09",
    collection_date: "2016-05-12",
    read_count: "739040",
    sample_volume: "44",
    sample_concentration: "23.3",
    a260_280_ratio: "1.87",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_10: SampleTemplate = {
  sampleAlias: "HGM-10",
  sampleTitle: "Human faecal shotgun metagenome Subject-10",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2016-01-13",
    host_subject_id: "Subject-10",
  },
  customFields: {
    sample_name: "Subject-10",
    collection_date: "2016-01-13",
    read_count: "749034",
    sample_volume: "58",
    sample_concentration: "33.1",
    a260_280_ratio: "1.96",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_11: SampleTemplate = {
  sampleAlias: "HGM-11",
  sampleTitle: "Human faecal shotgun metagenome Subject-11",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2016-11-28",
    host_subject_id: "Subject-11",
  },
  customFields: {
    sample_name: "Subject-11",
    collection_date: "2016-11-28",
    read_count: "559950",
    sample_volume: "41",
    sample_concentration: "20.5",
    a260_280_ratio: "1.83",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const SAMPLE_HGUT_12: SampleTemplate = {
  sampleAlias: "HGM-12",
  sampleTitle: "Human faecal shotgun metagenome Subject-12",
  scientificName: HUMAN_GUT_BASE.scientificName,
  taxId: HUMAN_GUT_BASE.taxId,
  checklistData: {
    ...HUMAN_GUT_MIXS,
    collection_date: "2018-11-23",
    host_subject_id: "Subject-12",
  },
  customFields: {
    sample_name: "Subject-12",
    collection_date: "2018-11-23",
    read_count: "464714",
    sample_volume: "46",
    sample_concentration: "25.4",
    a260_280_ratio: "1.89",
    extraction_kit: "QIAamp PowerFecal Pro DNA Kit",
    library_prep_kit: "Illumina DNA Prep",
    storage_temperature: "-80 °C",
  },
};

export const HUMAN_GUT_READS: Record<string, { run: string; biosample: string; checksum1: string; checksum2: string; readCount: number }> = {
  "HGM-01": { run: "ERR10009592", biosample: "SAMEA110434724", checksum1: "7ec2d63183160ab6ae024dc799629c46", checksum2: "207f0b084d11939df17296b8769a4d75", readCount: 466252 },
  "HGM-02": { run: "ERR10009593", biosample: "SAMEA110434725", checksum1: "686552e04ff6a76d85d0e60848e9a569", checksum2: "c0b9d743afc092df927b03e592bb2000", readCount: 672698 },
  "HGM-03": { run: "ERR10009594", biosample: "SAMEA110434726", checksum1: "7dd01c174d33e1be849cd37f57062867", checksum2: "3a7928536c630d0acb84b0e41842fba5", readCount: 707104 },
  "HGM-04": { run: "ERR10009610", biosample: "SAMEA110434742", checksum1: "7554c89b7ef075fdd99597a0a06c001a", checksum2: "e0479b1afbf0f09830f7f1d60900d025", readCount: 659122 },
  "HGM-05": { run: "ERR10009595", biosample: "SAMEA110434727", checksum1: "d195fff6eeda52b5208a10bebb8b8b9e", checksum2: "c12354b303b08c7857013f78fcf1dfb1", readCount: 492946 },
  "HGM-06": { run: "ERR10009623", biosample: "SAMEA110434755", checksum1: "e73f25f74dcbb9149df2793b18493f85", checksum2: "e26a79b3ebd648389aa7ad9b4b1ca1b4", readCount: 608262 },
  "HGM-07": { run: "ERR10009639", biosample: "SAMEA110434771", checksum1: "854b9aebc90bcb16af7f6e47fb1299b0", checksum2: "74560f8054f53ee1b1a2cfe482c13aca", readCount: 806454 },
  "HGM-08": { run: "ERR10009590", biosample: "SAMEA110434722", checksum1: "09739d13f5a0d0a2d0e1e3ce3ff2ab44", checksum2: "263cc89ea4be05837f903977481afe1d", readCount: 662668 },
  "HGM-09": { run: "ERR10009591", biosample: "SAMEA110434723", checksum1: "75b6595cd53941a5343450a10d689edb", checksum2: "18dcf6341bbcf9ee2037b465804c5dae", readCount: 739040 },
  "HGM-10": { run: "ERR10009596", biosample: "SAMEA110434728", checksum1: "d9063a14cb7f82236add03767bae88ac", checksum2: "45fc752249628d69ca161e17e92e8e7f", readCount: 749034 },
  "HGM-11": { run: "ERR10009608", biosample: "SAMEA110434740", checksum1: "3a7a2ea17c939b278c1db877cc671b18", checksum2: "aa74381314e272adfe041a161ab51054", readCount: 559950 },
  "HGM-12": { run: "ERR10009632", biosample: "SAMEA110434764", checksum1: "59813bc3514e35e7855225225d2cbb74", checksum2: "43babbddd2f836e30ce00681058e6635", readCount: 464714 },
};
