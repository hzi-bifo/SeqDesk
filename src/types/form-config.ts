// Field types supported by the form builder
export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "multiselect"
  | "checkbox"
  | "number"
  | "date"
  | "mixs" // Special type for MIxS metadata selector
  | "funding" // Special type for funding/grant information
  | "billing" // Special type for billing/cost center information
  | "sequencing-tech" // Special type for sequencing technology selector
  | "organism" // Special type for NCBI taxonomy lookup (ENA required)
  | "barcode"; // Special type for per-sample barcode assignment (from sequencing-tech module)

// Simple validation settings
export interface SimpleValidation {
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  pattern?: string; // Regex pattern
  patternPreset?: "email" | "url" | "phone" | "alphanumeric" | "custom";
  patternMessage?: string; // Custom error message for pattern
}

// AI validation settings
export interface AIValidation {
  enabled: boolean;
  prompt: string; // Human language description of what valid input looks like
  strictness?: "lenient" | "moderate" | "strict"; // How strict the AI should be
}

// Option for select/multiselect fields
export interface SelectOption {
  value: string;
  label: string;
}

// Form field group - represents a step/section in the order wizard
export interface FormFieldGroup {
  id: string;
  name: string;
  description?: string;
  icon?: string; // Icon name from lucide-react (e.g., "Settings", "FileText")
  order: number;
}

// Default groups for the form
export const DEFAULT_GROUPS: FormFieldGroup[] = [
  {
    id: "group_details",
    name: "Order Details",
    description: "Basic information about your order",
    icon: "FileText",
    order: 0,
  },
  {
    id: "group_sequencing",
    name: "Sequencing Parameters",
    description: "Sequencing technology and library settings",
    icon: "Settings",
    order: 1,
  },
];

// Unit option for MIxS fields
export interface UnitOption {
  value: string;
  label: string;
}

// Individual field definition
export interface FormFieldDefinition {
  id: string; // Unique identifier (cuid)
  type: FieldType;
  label: string;
  name: string; // Field key in customFields JSON (or Order column for system fields)
  required: boolean;
  visible: boolean; // Whether field is shown on the form
  helpText?: string; // Help text shown below the field
  example?: string; // Example value shown as hint
  placeholder?: string;
  defaultValue?: string | number | boolean | string[];
  options?: SelectOption[]; // For select/multiselect
  units?: UnitOption[]; // For MIxS fields with units (e.g., temperature in Celsius)
  simpleValidation?: SimpleValidation; // Min/max, patterns
  aiValidation?: AIValidation; // AI-powered validation
  order: number; // Display order within group
  groupId?: string; // Which group this field belongs to
  isSystem?: boolean; // True for pre-seeded system fields (platform, library, etc.)
  systemKey?: string; // Maps to Order model column (e.g., "platform", "libraryStrategy")
  mixsChecklists?: string[]; // For mixs type: which checklists are enabled
  perSample?: boolean; // If true, field is collected per sample (table view); if false, once per order/study
  group?: string; // MIxS field group/category (e.g., "geography", "chemistry")
  moduleSource?: string; // Which module added this field (e.g., "ena-sample-fields", "mixs-metadata")
  adminOnly?: boolean; // If true, field is only visible to FACILITY_ADMIN users (facility-internal fields)
}

// Pattern presets with their regex and descriptions
export const PATTERN_PRESETS: Record<string, { pattern: string; description: string; message: string }> = {
  email: {
    pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
    description: "Email address",
    message: "Please enter a valid email address",
  },
  url: {
    pattern: "^https?://[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}.*$",
    description: "URL (http/https)",
    message: "Please enter a valid URL starting with http:// or https://",
  },
  phone: {
    pattern: "^[+]?[0-9\\s\\-().]{7,20}$",
    description: "Phone number",
    message: "Please enter a valid phone number",
  },
  alphanumeric: {
    pattern: "^[a-zA-Z0-9]+$",
    description: "Letters and numbers only",
    message: "Only letters and numbers are allowed",
  },
};

// Full form config schema
export interface OrderFormSchema {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  version: number;
  // MIxS checklists enabled for users to select during order creation
  enabledMixsChecklists?: string[];
}

// Platform options for the system field
export const PLATFORM_OPTIONS: SelectOption[] = [
  { value: "ILLUMINA", label: "Illumina" },
  { value: "OXFORD_NANOPORE", label: "Oxford Nanopore" },
  { value: "PACBIO", label: "PacBio" },
  { value: "ION_TORRENT", label: "Ion Torrent" },
  { value: "BGI", label: "BGI" },
];

export const LIBRARY_STRATEGY_OPTIONS: SelectOption[] = [
  { value: "WGS", label: "WGS (Whole Genome Sequencing)" },
  { value: "WXS", label: "WXS (Whole Exome Sequencing)" },
  { value: "RNA-Seq", label: "RNA-Seq" },
  { value: "AMPLICON", label: "Amplicon" },
  { value: "Bisulfite-Seq", label: "Bisulfite-Seq" },
  { value: "ChIP-Seq", label: "ChIP-Seq" },
  { value: "ATAC-seq", label: "ATAC-seq" },
  { value: "OTHER", label: "Other" },
];

export const LIBRARY_SOURCE_OPTIONS: SelectOption[] = [
  { value: "GENOMIC", label: "Genomic DNA" },
  { value: "METAGENOMIC", label: "Metagenomic" },
  { value: "TRANSCRIPTOMIC", label: "Transcriptomic" },
  { value: "METATRANSCRIPTOMIC", label: "Metatranscriptomic" },
  { value: "SYNTHETIC", label: "Synthetic" },
  { value: "VIRAL_RNA", label: "Viral RNA" },
  { value: "OTHER", label: "Other" },
];

export const LIBRARY_SELECTION_OPTIONS: SelectOption[] = [
  { value: "RANDOM", label: "Random" },
  { value: "PCR", label: "PCR" },
  { value: "RANDOM_PCR", label: "Random PCR" },
  { value: "RT-PCR", label: "RT-PCR" },
  { value: "size_fractionation", label: "Size Fractionation" },
  { value: "cDNA", label: "cDNA" },
  { value: "PolyA", label: "PolyA" },
  { value: "Oligo-dT", label: "Oligo-dT" },
  { value: "UNSPECIFIED", label: "Unspecified" },
];

// Default system fields - pre-seeded on new installations
export const DEFAULT_SYSTEM_FIELDS: FormFieldDefinition[] = [
  {
    id: "system_name",
    type: "text",
    label: "Order Name",
    name: "name",
    required: false,
    visible: true,
    placeholder: "e.g., Soil microbiome study - Batch 1",
    helpText: "Optional descriptive name (Order ID is auto-generated)",
    order: 0,
    groupId: "group_details",
    isSystem: true,
    systemKey: "name",
  },
  {
    id: "system_numberOfSamples",
    type: "number",
    label: "Number of Samples",
    name: "numberOfSamples",
    required: false,
    visible: true,
    placeholder: "e.g., 10",
    helpText: "Expected number of samples. This will pre-fill the samples table.",
    simpleValidation: {
      minValue: 1,
      maxValue: 500,
    },
    order: 1,
    groupId: "group_details",
    isSystem: true,
    systemKey: "numberOfSamples",
  },
  {
    id: "system_platform",
    type: "select",
    label: "Sequencing Platform",
    name: "platform",
    required: false,
    visible: true,
    helpText: "The sequencing technology to be used",
    options: PLATFORM_OPTIONS,
    order: 0,
    groupId: "group_sequencing",
    isSystem: true,
    systemKey: "platform",
  },
  {
    id: "system_instrumentModel",
    type: "text",
    label: "Instrument Model",
    name: "instrumentModel",
    required: false,
    visible: true,
    placeholder: "e.g., NovaSeq 6000, MinION",
    helpText: "Specific instrument model if known",
    order: 1,
    groupId: "group_sequencing",
    isSystem: true,
    systemKey: "instrumentModel",
  },
  {
    id: "system_libraryStrategy",
    type: "select",
    label: "Library Strategy",
    name: "libraryStrategy",
    required: false,
    visible: true,
    helpText: "The sequencing strategy for library preparation",
    options: LIBRARY_STRATEGY_OPTIONS,
    order: 2,
    groupId: "group_sequencing",
    isSystem: true,
    systemKey: "libraryStrategy",
  },
  {
    id: "system_librarySource",
    type: "select",
    label: "Library Source",
    name: "librarySource",
    required: false,
    visible: true,
    helpText: "The type of source material",
    options: LIBRARY_SOURCE_OPTIONS,
    order: 3,
    groupId: "group_sequencing",
    isSystem: true,
    systemKey: "librarySource",
  },
  {
    id: "system_librarySelection",
    type: "select",
    label: "Library Selection",
    name: "librarySelection",
    required: false,
    visible: true,
    helpText: "Method used to select/enrich the material",
    options: LIBRARY_SELECTION_OPTIONS,
    order: 4,
    groupId: "group_sequencing",
    isSystem: true,
    systemKey: "librarySelection",
  },
  {
    id: "system_organism",
    type: "organism",
    label: "Organism",
    name: "_organism",
    required: true,
    visible: true,
    helpText:
      "The source organism or metagenome type. Start typing to search NCBI taxonomy.",
    placeholder: "e.g., human gut metagenome",
    order: 0,
    isSystem: true,
    perSample: true,
    moduleSource: "ena-sample-fields",
  },
  {
    id: "system_sampleTitle",
    type: "text",
    label: "Sample Title",
    name: "sample_title",
    required: true,
    visible: true,
    helpText: "A short descriptive title for this sample. Required for ENA submission.",
    placeholder: "e.g., Human gut sample from healthy adult",
    order: 1,
    isSystem: true,
    perSample: true,
    moduleSource: "ena-sample-fields",
  },
  {
    id: "system_sampleAlias",
    type: "text",
    label: "Sample Alias",
    name: "sample_alias",
    required: false,
    visible: true,
    helpText: "A unique identifier for this sample. If left empty, it can be auto-generated.",
    placeholder: "e.g., HG-001-A",
    order: 2,
    isSystem: true,
    perSample: true,
    moduleSource: "ena-sample-fields",
  },
];

// Default empty form schema with system fields and groups
export const DEFAULT_FORM_SCHEMA: OrderFormSchema = {
  fields: DEFAULT_SYSTEM_FIELDS,
  groups: DEFAULT_GROUPS,
  version: 1,
};

// Legacy support - keeping CoreFieldConfig for backward compatibility during migration
export interface CoreFieldConfig {
  name: { visible: boolean; required: boolean };
  platform: { visible: boolean; required: boolean };
  instrumentModel: { visible: boolean; required: boolean };
  libraryStrategy: { visible: boolean; required: boolean };
  librarySource: { visible: boolean; required: boolean };
  librarySelection: { visible: boolean; required: boolean };
}

export const DEFAULT_CORE_FIELD_CONFIG: CoreFieldConfig = {
  name: { visible: true, required: true },
  platform: { visible: true, required: false },
  instrumentModel: { visible: true, required: false },
  libraryStrategy: { visible: true, required: false },
  librarySource: { visible: true, required: false },
  librarySelection: { visible: true, required: false },
};

// Field type labels for UI
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text Input",
  textarea: "Text Area",
  select: "Dropdown",
  multiselect: "Multi-Select",
  checkbox: "Checkbox",
  number: "Number",
  date: "Date",
  mixs: "MIxS Metadata",
  funding: "Funding Info",
  billing: "Billing Info",
  "sequencing-tech": "Sequencing Technology",
  organism: "Organism (Taxonomy)",
  barcode: "Barcode",
};

// Core field labels for UI
export const CORE_FIELD_LABELS: Record<keyof CoreFieldConfig, string> = {
  name: "Order Name",
  platform: "Sequencing Platform",
  instrumentModel: "Instrument Model",
  libraryStrategy: "Library Strategy",
  librarySource: "Library Source",
  librarySelection: "Library Selection",
};

// Note: Suggested field templates are now loaded from JSON files in data/field-templates/
// See /api/admin/field-templates for the API endpoint that loads them
