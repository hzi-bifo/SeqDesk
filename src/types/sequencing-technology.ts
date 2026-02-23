/**
 * Sequencing Technology Types
 *
 * Defines the structure for sequencing technology information
 * displayed to users when creating orders.
 */

// A single pro or con point
export interface TechnologyPoint {
  text: string;
  tooltip?: string; // Optional detailed explanation
}

// Specification item (e.g., "Read Length: 150bp")
export interface TechnologySpec {
  label: string;
  value: string;
  unit?: string;
}

// Follow-up option when technology is selected
export interface TechnologyOption {
  id: string;
  label: string;
  type: "select" | "checkbox" | "number";
  options?: { value: string; label: string }[]; // For select type
  default?: string | boolean | number;
  helpText?: string;
}

// Main sequencing technology definition
export interface SequencingTechnology {
  id: string;
  name: string;
  manufacturer: string;
  shortDescription: string;
  description?: string; // Longer description

  // Visual
  icon?: string; // Icon name or URL
  color?: string; // Brand color (e.g., "#0066CC" for Illumina blue)

  // Technical info
  specs: TechnologySpec[];
  pros: TechnologyPoint[];
  cons: TechnologyPoint[];
  bestFor: string[]; // Use cases

  // Follow-up options when selected
  options?: TechnologyOption[];

  // Facility configuration
  available: boolean; // Is this offered at the facility?
  comingSoon?: boolean; // Show but not selectable
  priceIndicator?: "$" | "$$" | "$$$" | "$$$$"; // Relative cost
  turnaroundDays?: { min: number; max: number }; // Typical TAT

  // Metadata
  order: number; // Display order
  lastUpdated?: string; // ISO date
  sourceUrl?: string; // Link to official docs

  // For sync with central server
  externalId?: string; // ID from central server
  localOverrides?: boolean; // Has admin customized this?
}

// A specific sequencer device (e.g., MinION Mk1D)
export interface SequencerDevice {
  id: string;
  platformId: string; // Parent SequencingTechnology.id
  name: string;
  manufacturer: string;
  sku?: string;
  productOverview: string;
  shortDescription: string;
  image?: string;
  color?: string;
  specs: TechnologySpec[];
  connectivity?: string;
  features?: string[];
  compatibleFlowCells: string[];
  compatibleKits: string[];
  compatibleSoftware: string[];
  available: boolean;
  comingSoon?: boolean;
  order: number;
  sourceUrl?: string;
  lastUpdated?: string;
  localOverrides?: boolean;
}

export interface FlowCell {
  id: string;
  name: string;
  sku: string;
  description?: string;
  chemistry?: string;
  poreCount?: number;
  maxOutput?: string;
  category: "standard" | "rna" | "flongle" | "other";
  image?: string;
  available: boolean;
  order: number;
  sourceUrl?: string;
  localOverrides?: boolean;
}

// Kit barcoding capabilities
export interface KitBarcoding {
  supported: boolean;
  builtIn: boolean;
  requiresAdditionalBarcodeKit: boolean;
  barcodeSetId?: string; // References BarcodeSet.id (for built-in barcodes)
  maxBarcodesPerRun?: number;
  compatibleBarcodeKits?: string[]; // Kit IDs for sequencing-only kits
}

// Barcode scheme (e.g., native_nb, rapid_rb)
export interface BarcodeScheme {
  id: string;
  name: string;
  chemistry: string;
  description?: string;
}

// Barcode set (e.g., NB01_24 = barcodes 1-24 using native_nb scheme)
export interface BarcodeSet {
  id: string;
  name: string;
  schemeId: string; // References BarcodeScheme.id
  barcodeRange: [number, number]; // [start, end] inclusive
  count: number;
}

export interface SequencingKit {
  id: string;
  name: string;
  sku: string;
  description?: string;
  category:
    | "ligation"
    | "rapid"
    | "barcoding"
    | "pcr"
    | "cdna"
    | "direct-rna"
    | "amplicon"
    | "other";
  inputType?: "dna" | "rna" | "both";
  multiplexing?: boolean;
  barcodeCount?: number;
  kitKind?: "sequencing_only" | "barcoding_and_sequencing";
  doradoKitName?: string;
  barcoding?: KitBarcoding;
  image?: string;
  available: boolean;
  order: number;
  sourceUrl?: string;
  localOverrides?: boolean;
}

export interface SequencingSoftware {
  id: string;
  name: string;
  description?: string;
  category: "control" | "basecalling" | "analysis" | "other";
  version?: string;
  downloadUrl?: string;
  available: boolean;
  order: number;
  localOverrides?: boolean;
}

// Technology category/family
export interface TechnologyCategory {
  id: string;
  name: string;
  description?: string;
  technologies: string[]; // Technology IDs
}

// JSON file per platform family
export interface SequencingDevicesFile {
  platformId: string;
  devices?: SequencerDevice[];
  flowCells?: FlowCell[];
  kits?: SequencingKit[];
  software?: SequencingSoftware[];
}

// Full configuration stored in database
export interface SequencingTechConfig {
  technologies: SequencingTechnology[];
  devices?: SequencerDevice[];
  flowCells?: FlowCell[];
  kits?: SequencingKit[];
  software?: SequencingSoftware[];
  barcodeSchemes?: BarcodeScheme[];
  barcodeSets?: BarcodeSet[];
  categories?: TechnologyCategory[];
  lastSyncedAt?: string; // When last synced with central server
  syncUrl?: string; // URL to fetch updates from
  version: number;
}

// API response from central server
export interface TechSyncResponse {
  technologies: SequencingTechnology[];
  version: string;
  updatedAt: string;
}

export interface SequencingTechSelection {
  technologyId: string;
  technologyName?: string;
  deviceId?: string;
  deviceName?: string;
  flowCellId?: string;
  flowCellSku?: string;
  kitId?: string;
  kitSku?: string;
  barcodeKitId?: string; // Companion barcode kit (when main kit requires one)
  barcodeKitSku?: string;
  softwareIds?: string[];
  [optionId: string]: unknown;
}

// Default empty config
export const DEFAULT_TECH_CONFIG: SequencingTechConfig = {
  technologies: [],
  devices: [],
  flowCells: [],
  kits: [],
  software: [],
  barcodeSchemes: [],
  barcodeSets: [],
  version: 1,
};
