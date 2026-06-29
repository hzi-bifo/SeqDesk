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

// ── REAL data: ENA mouse gut metagenome study PRJDB6165 ──────────────────────
// Real public dataset (Tokyo Medical and Dental University): gut microbiota of
// high-fat-diet mice, control vs Aggregatibacter actinomycetemcomitans infection.
// Accessions, md5 checksums, read counts, sample names, geography and collection
// year are the REAL ENA values; host/environment context fields are filled with
// MIxS-valid values to render well. checklistType is the host-associated checklist.
export const STUDY_MOUSE_GUT_PRJDB6165: StudyTemplate = {
  titleBase: "Mouse Gut Metagenome (PRJDB6165)",
  aliasSlug: "mouse-gut-prjdb6165",
  description:
    "Real public ENA study PRJDB6165 — shotgun metagenomes of mouse faecal microbiota under a high-fat diet, contrasting controls with Aggregatibacter actinomycetemcomitans infection. Accessions, checksums and core metadata are the real ENA values.",
  checklistType: "host-associated",
  principalInvestigator: "Tokyo Medical and Dental University",
  abstract:
    "Aggregatibacter actinomycetemcomitans and the gut microbiota of mice eating a high-fat diet (ENA PRJDB6165). Eight faecal shotgun-metagenome libraries (Illumina MiSeq): four high-fat-diet controls (HFco1-4) and four high-fat-diet + A. actinomycetemcomitans (HFAa1-4). Loaded into the demo from the real ENA submission; reads and pipeline outputs are wired from the real data.",
};

const MOUSE_GUT_MIXS = {
  project_name: "Aggregatibacter actinomycetemcomitans, gut microbiota in mice eating a high-fat diet",
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
  sampleAlias: "SAMD00089915",
  sampleTitle: "16S rRNA isolated from mice fecal in HFco1",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "HFco1",
  },
  customFields: {
    sample_name: "HFco1",
    treatment: "control (high-fat diet)",
    biosample_accession: "SAMD00089915",
    bioproject_accession: "PRJDB6165",
    run_accession: "DRR099973",
    experiment_accession: "DRX093417",
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
  sampleAlias: "SAMD00089916",
  sampleTitle: "16S rRNA isolated from mice fecal in HFco2",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "HFco2",
  },
  customFields: {
    sample_name: "HFco2",
    treatment: "control (high-fat diet)",
    biosample_accession: "SAMD00089916",
    bioproject_accession: "PRJDB6165",
    run_accession: "DRR099974",
    experiment_accession: "DRX093418",
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
  sampleAlias: "SAMD00089917",
  sampleTitle: "16S rRNA isolated from mice fecal in HFco3",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "HFco3",
  },
  customFields: {
    sample_name: "HFco3",
    treatment: "control (high-fat diet)",
    biosample_accession: "SAMD00089917",
    bioproject_accession: "PRJDB6165",
    run_accession: "DRR099975",
    experiment_accession: "DRX093419",
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
  sampleAlias: "SAMD00089918",
  sampleTitle: "16S rRNA isolated from mice fecal in HFco4",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "HFco4",
  },
  customFields: {
    sample_name: "HFco4",
    treatment: "control (high-fat diet)",
    biosample_accession: "SAMD00089918",
    bioproject_accession: "PRJDB6165",
    run_accession: "DRR099976",
    experiment_accession: "DRX093420",
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
  sampleAlias: "SAMD00089919",
  sampleTitle: "16S rRNA isolated from mice fecal in HFAa1",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "HFAa1",
  },
  customFields: {
    sample_name: "HFAa1",
    treatment: "high-fat diet + A. actinomycetemcomitans",
    biosample_accession: "SAMD00089919",
    bioproject_accession: "PRJDB6165",
    run_accession: "DRR099977",
    experiment_accession: "DRX093421",
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
  sampleAlias: "SAMD00089920",
  sampleTitle: "16S rRNA isolated from mice fecal in HFAa2",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "HFAa2",
  },
  customFields: {
    sample_name: "HFAa2",
    treatment: "high-fat diet + A. actinomycetemcomitans",
    biosample_accession: "SAMD00089920",
    bioproject_accession: "PRJDB6165",
    run_accession: "DRR099978",
    experiment_accession: "DRX093422",
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
  sampleAlias: "SAMD00089921",
  sampleTitle: "16S rRNA isolated from mice fecal in HFAa3",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "HFAa3",
  },
  customFields: {
    sample_name: "HFAa3",
    treatment: "high-fat diet + A. actinomycetemcomitans",
    biosample_accession: "SAMD00089921",
    bioproject_accession: "PRJDB6165",
    run_accession: "DRR099979",
    experiment_accession: "DRX093423",
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
  sampleAlias: "SAMD00089922",
  sampleTitle: "16S rRNA isolated from mice fecal in HFAa4",
  scientificName: MOUSE_GUT_BASE.scientificName,
  taxId: MOUSE_GUT_BASE.taxId,
  checklistData: {
    ...MOUSE_GUT_MIXS,
    host_subject_id: "HFAa4",
  },
  customFields: {
    sample_name: "HFAa4",
    treatment: "high-fat diet + A. actinomycetemcomitans",
    biosample_accession: "SAMD00089922",
    bioproject_accession: "PRJDB6165",
    run_accession: "DRR099980",
    experiment_accession: "DRX093424",
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
  "SAMD00089915": { run: "DRR099973", experiment: "DRX093417", checksum1: "ad0c526823c70b5ad1c7c0dc150cbce4", checksum2: "4a280d9f9bd29622055cdf778f6aad67", readCount: 91795 },
  "SAMD00089916": { run: "DRR099974", experiment: "DRX093418", checksum1: "7bd36e4429524093b980c90ea7f3fc26", checksum2: "d93de56b3da3d0afba44c639bc2e25d6", readCount: 90723 },
  "SAMD00089917": { run: "DRR099975", experiment: "DRX093419", checksum1: "213e4d5e0fe792008acaa1372ecff93a", checksum2: "570d628b2704ef2b61165d5bf4de0cec", readCount: 107329 },
  "SAMD00089918": { run: "DRR099976", experiment: "DRX093420", checksum1: "cca1086517bd206e8b2f2cd93cabf997", checksum2: "ed69bf76113a90c3a30a7eb4c6ec18b0", readCount: 82174 },
  "SAMD00089919": { run: "DRR099977", experiment: "DRX093421", checksum1: "a6db63ae65c8e28619acbe98d94eacc6", checksum2: "c4f7f96e033d70f2fcadde83daec7f5a", readCount: 99093 },
  "SAMD00089920": { run: "DRR099978", experiment: "DRX093422", checksum1: "b2e00d8d2526545765966bdfccca64af", checksum2: "20a05817e94e2a2f96bfd184796c2d04", readCount: 117186 },
  "SAMD00089921": { run: "DRR099979", experiment: "DRX093423", checksum1: "589fe5ca3a652e576767bfb23c719c7e", checksum2: "6a6de694afc521f28cec2cd1421b90f2", readCount: 99911 },
  "SAMD00089922": { run: "DRR099980", experiment: "DRX093424", checksum1: "91527786815d17d5486b2289aac63389", checksum2: "b4e0fa748c8befdfc9dca2322c73495c", readCount: 90527 },
};