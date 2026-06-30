import type { FormFieldDefinition } from "@/types/form-config";
import { STUDY_INFORMATION_SECTION_ID } from "@/lib/studies/fixed-sections";

// Technical per-study questionnaire for the mouse gut-microbiome DEMO study, showcasing the
// dynamic-studies module with SEQUENCING / LIBRARY / QC fields (not subject characteristics).
// Study-level answers persist in Study.studyMetadata keyed by field name (see
// MOUSE_STUDY_FORM_ANSWERS); the demo seed merges those into the study's metadata.
export const MOUSE_STUDY_FORM_FIELDS: FormFieldDefinition[] = [
  {
    id: "field_mgb_sample_association",
    type: "text",
    label: "Sample Association",
    name: "_sample_association",
    required: false,
    visible: true,
    helpText: "Interface to associate samples from orders to this study",
    order: 0,
  },
  {
    id: "field_mgb_pi",
    type: "text",
    label: "Principal Investigator",
    name: "principal_investigator",
    required: false,
    visible: true,
    helpText: "Lead researcher responsible for this study",
    order: 1,
    groupId: STUDY_INFORMATION_SECTION_ID,
    perSample: false,
  },
  {
    id: "field_mgb_abstract",
    type: "textarea",
    label: "Study Abstract",
    name: "study_abstract",
    required: false,
    visible: true,
    helpText: "Brief description of the study",
    order: 2,
    groupId: STUDY_INFORMATION_SECTION_ID,
    perSample: false,
  },
  {
    id: "field_mgb_amplicon_region",
    type: "select",
    label: "Amplicon Target Region",
    name: "amplicon_target_region",
    required: false,
    visible: true,
    helpText: "Marker-gene region amplified for this study.",
    order: 3,
    groupId: STUDY_INFORMATION_SECTION_ID,
    perSample: false,
    options: [
      { value: "16S rRNA V3-V4", label: "16S rRNA V3-V4" },
      { value: "16S rRNA V4", label: "16S rRNA V4" },
      { value: "ITS", label: "ITS" },
    ],
  },
  {
    id: "field_mgb_library_kit",
    type: "select",
    label: "Library Prep Kit",
    name: "library_prep_kit",
    required: false,
    visible: true,
    helpText: "Library preparation chemistry used across this study's samples.",
    order: 4,
    groupId: STUDY_INFORMATION_SECTION_ID,
    perSample: false,
    options: [
      {
        value: "Illumina 16S Metagenomic Sequencing Library Prep",
        label: "Illumina 16S Metagenomic Sequencing Library Prep",
      },
      { value: "Nextera XT", label: "Nextera XT" },
    ],
  },
  {
    id: "field_mgb_platform",
    type: "select",
    label: "Sequencing Platform",
    name: "sequencing_platform",
    required: false,
    visible: true,
    helpText: "Instrument and run configuration used for this study.",
    order: 5,
    groupId: STUDY_INFORMATION_SECTION_ID,
    perSample: false,
    options: [
      {
        value: "Illumina MiSeq (2x300 bp paired-end)",
        label: "Illumina MiSeq (2x300 bp paired-end)",
      },
      { value: "Illumina NovaSeq 6000", label: "Illumina NovaSeq 6000" },
    ],
  },
  {
    id: "field_mgb_target_depth",
    type: "text",
    label: "Target Sequencing Depth",
    name: "target_sequencing_depth",
    required: false,
    visible: true,
    helpText: "Planned read pairs per library (run-planning metadata).",
    order: 6,
    groupId: STUDY_INFORMATION_SECTION_ID,
    perSample: false,
  },
  {
    id: "field_mgb_qc_pipeline",
    type: "textarea",
    label: "QC / Bioinformatics Pipeline",
    name: "qc_pipeline_version",
    required: false,
    visible: true,
    helpText: "QC and reporting pipeline applied to this study's libraries.",
    order: 7,
    groupId: STUDY_INFORMATION_SECTION_ID,
    perSample: false,
  },
  {
    id: "field_mgb_demux",
    type: "text",
    label: "Demultiplexing Strategy",
    name: "demultiplexing_strategy",
    required: false,
    visible: true,
    helpText: "How libraries were indexed and demultiplexed.",
    order: 8,
    groupId: STUDY_INFORMATION_SECTION_ID,
    perSample: false,
  },
];

// Dummy answers for the study-level dynamic fields, merged into Study.studyMetadata so the
// dynamic form renders fully populated. principal_investigator + study_abstract come from
// getStudyMetadata; these are the additional technical fields.
export const MOUSE_STUDY_FORM_ANSWERS: Record<string, string> = {
  amplicon_target_region: "16S rRNA V3-V4",
  library_prep_kit: "Illumina 16S Metagenomic Sequencing Library Prep",
  sequencing_platform: "Illumina MiSeq (2x300 bp paired-end)",
  target_sequencing_depth: "~50,000 read pairs per sample",
  qc_pipeline_version: "reads-qc v1.2 -> FastQC v0.12 -> MultiQC summary",
  demultiplexing_strategy: "Dual-index barcodes, demultiplexed on-instrument (bcl2fastq)",
};
