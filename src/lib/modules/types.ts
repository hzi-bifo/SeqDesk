// Module system types
// Allows features to be enabled/disabled globally

export type ModuleCategory = "order-form" | "validation" | "access" | "communication";

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  featureLocation?: string; // Where the feature appears in the UI
  contactEmail?: string; // Email to contact to enable this module
  comingSoon?: boolean; // If true, module is shown but cannot be enabled yet
  hasSettings?: boolean; // If true, module has additional settings to configure
  // Future: could add pricing, tier requirements, etc.
}

// Category labels and descriptions
export const MODULE_CATEGORIES: Record<ModuleCategory, { label: string; description: string }> = {
  "order-form": {
    label: "Form Extensions",
    description: "Add specialized field types to your order and study forms",
  },
  validation: {
    label: "Validation",
    description: "Enhanced validation and quality checks",
  },
  access: {
    label: "Access Control",
    description: "Control who can access your installation",
  },
  communication: {
    label: "Communication",
    description: "User notifications and messaging",
  },
};

export interface ModuleConfig {
  moduleId: string;
  enabled: boolean;
}

// Module-specific settings types
export interface AccountValidationSettings {
  allowedDomains: string[]; // e.g., ["helmholtz-hzi.de", "hzi.de"]
  enforceValidation: boolean; // Whether to block registrations from other domains
}

// Available modules in the system
export const AVAILABLE_MODULES: ModuleDefinition[] = [
  // Form Extensions
  {
    id: "mixs-metadata",
    name: "MIxS Metadata",
    description: "Adds MIxS (Minimum Information about any Sequence) metadata collection. Users select an environment checklist (Soil, Water, Host-associated, etc.) per study, and corresponding standardized fields are collected at study and sample level.",
    category: "order-form",
    featureLocation: "Configuration > Study Forms",
    contactEmail: "hello@seqdesk.com",
  },
  {
    id: "funding-info",
    name: "External Funding & Grants",
    description: "Collect external grant and funding information at the study level. Includes funding agency (NIH, DFG, ERC, etc.), grant number, project title, and PI details. Supports multiple funding sources per study.",
    category: "order-form",
    featureLocation: "Configuration > Study Forms",
  },
  {
    id: "billing-info",
    name: "Cost Center & PSP",
    description: "Internal billing and cost allocation for orders. Collect Cost Center codes and PSP Elements (SAP project structure plan) with configurable format validation (e.g., 1-1234567-99). For institutions with SAP systems, direct API integration is available.",
    category: "order-form",
    featureLocation: "Configuration > Order Forms",
    hasSettings: true,
  },
  {
    id: "sequencing-tech",
    name: "Sequencing Technologies",
    description: "Interactive technology selector for orders with pre-configured information about sequencing platforms (Illumina, Nanopore, PacBio, etc.). Shows specs, pros/cons, and best-use cases. Fully customizable by admins.",
    category: "order-form",
    featureLocation: "Configuration > Order Forms",
    hasSettings: true,
  },
  {
    id: "ena-sample-fields",
    name: "ENA Sample Fields",
    description: "Essential per-sample fields required for ENA (European Nucleotide Archive) submission. Includes Organism field with NCBI taxonomy lookup, Sample Title, and Sample Alias. Strongly recommended if you plan to submit sequencing data to public repositories.",
    category: "order-form",
    featureLocation: "Configuration > Order Forms",
  },
  // Validation
  {
    id: "ai-validation",
    name: "AI Field Validation",
    description: "Enables AI-powered validation for form fields. When users fill in fields, AI checks if the input looks correct and provides helpful feedback. Configure per-field in Order Configuration.",
    category: "validation",
    featureLocation: "Configuration > Order Forms > Field Settings",
    contactEmail: "hello@seqdesk.com",
  },
  // Access Control
  {
    id: "account-validation",
    name: "Account Validation",
    description: "Restrict who can create accounts by limiting registration to specific email domains. Useful for institutional deployments.",
    category: "access",
    hasSettings: true,
  },
  // Communication
  {
    id: "notifications",
    name: "Notifications",
    description: "Send email notifications to users about order status updates, new features, and important announcements.",
    category: "communication",
    comingSoon: true,
  },
];

// Default module states (what's enabled out of the box)
export const DEFAULT_MODULE_STATES: Record<string, boolean> = {
  "ai-validation": true,
  "mixs-metadata": true,
  "account-validation": false,
  "funding-info": false,
  "billing-info": false,
  "sequencing-tech": true,
  "ena-sample-fields": true, // Enabled by default - essential for ENA submission
  "notifications": false,
};

// Billing module settings
export interface BillingSettings {
  // PSP Element format configuration
  pspEnabled: boolean;
  pspPrefixRange: { min: number; max: number }; // e.g., 1-9
  pspMainDigits: number; // e.g., 7
  pspSuffixRange: { min: number; max: number }; // e.g., 01-99
  pspExample: string; // e.g., "1-1234567-99"
  // Cost Center configuration
  costCenterEnabled: boolean;
  costCenterPattern?: string; // Optional regex pattern
  costCenterExample?: string;
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  pspEnabled: true,
  pspPrefixRange: { min: 1, max: 9 },
  pspMainDigits: 7,
  pspSuffixRange: { min: 1, max: 99 },
  pspExample: "1-1234567-99",
  costCenterEnabled: true,
  costCenterExample: "12345678",
};

// Default settings for modules with settings
export const DEFAULT_ACCOUNT_VALIDATION_SETTINGS: AccountValidationSettings = {
  allowedDomains: [],
  enforceValidation: true,
};

// Helper to get module definition
export function getModuleDefinition(moduleId: string): ModuleDefinition | undefined {
  return AVAILABLE_MODULES.find((m) => m.id === moduleId);
}
