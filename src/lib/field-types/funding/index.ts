/**
 * External Funding & Grants Field Type Plugin
 *
 * A special field type for collecting external grant and funding information.
 * Allows users to add one or more funding sources with structured data
 * including agency, grant number, project title, and PI.
 *
 * Note: Internal billing (Cost Center, PSP) is handled by the Billing module.
 */

import { FieldTypePlugin, registerFieldType } from "../index";
import { Wallet } from "lucide-react";

// Funding agency definitions with grant number format hints
export interface FundingAgency {
  id: string;
  name: string;
  country?: string;
  grantNumberHint?: string;
  grantNumberPattern?: string; // Regex pattern for validation
}

// Common funding agencies
export const FUNDING_AGENCIES: FundingAgency[] = [
  {
    id: "nih",
    name: "NIH (National Institutes of Health)",
    country: "USA",
    grantNumberHint: "e.g., R01-GM123456",
    grantNumberPattern: "^[A-Z][0-9]{2}[A-Z]{2}[0-9]{6}",
  },
  {
    id: "nsf",
    name: "NSF (National Science Foundation)",
    country: "USA",
    grantNumberHint: "e.g., 2023456",
  },
  {
    id: "dfg",
    name: "DFG (Deutsche Forschungsgemeinschaft)",
    country: "Germany",
    grantNumberHint: "e.g., SFB1234, FOR2345",
  },
  {
    id: "bmbf",
    name: "BMBF (Bundesministerium fur Bildung und Forschung)",
    country: "Germany",
    grantNumberHint: "e.g., 01KI2345",
  },
  {
    id: "erc",
    name: "ERC (European Research Council)",
    country: "EU",
    grantNumberHint: "e.g., ERC-2024-StG-101234567",
  },
  {
    id: "horizon",
    name: "Horizon Europe",
    country: "EU",
    grantNumberHint: "e.g., 101234567",
  },
  {
    id: "wellcome",
    name: "Wellcome Trust",
    country: "UK",
    grantNumberHint: "e.g., 123456/Z/12/Z",
  },
  {
    id: "mrc",
    name: "MRC (Medical Research Council)",
    country: "UK",
    grantNumberHint: "e.g., MR/X012345/1",
  },
  {
    id: "helmholtz",
    name: "Helmholtz Association",
    country: "Germany",
    grantNumberHint: "e.g., VH-NG-1234",
  },
  {
    id: "max_planck",
    name: "Max Planck Society",
    country: "Germany",
  },
  {
    id: "other",
    name: "Other",
    grantNumberHint: "Enter your grant/award number",
  },
];

// Single funding entry
export interface FundingEntry {
  id: string; // Unique ID for this entry
  agencyId: string;
  agencyOther?: string; // If agency is "other", the custom name
  grantNumber: string;
  grantTitle?: string;
  piName?: string; // PI on the grant
  isPrimary?: boolean; // Is this the primary funding source
}

// Value stored in the order's customFields
export interface FundingFieldValue {
  entries: FundingEntry[];
}

// Funding field type plugin definition
const fundingFieldType: FieldTypePlugin = {
  type: "funding",
  label: "External Funding & Grants",
  description: "Collect external grant and funding information",
  icon: Wallet,
  isSpecial: true, // Not shown in regular type dropdown

  defaultConfig: {
    type: "funding",
    label: "External Funding & Grants",
    name: "_funding",
    required: false,
    visible: true,
    helpText: "Add your external grant or funding source information",
  },

  validate: (value, field) => {
    const fundingValue = value as FundingFieldValue | null;

    if (field.required) {
      if (!fundingValue?.entries || fundingValue.entries.length === 0) {
        return "Please add at least one funding source";
      }

      // Check that primary entries have required fields
      for (const entry of fundingValue.entries) {
        if (!entry.agencyId) {
          return "Please select a funding agency for all entries";
        }
        if (!entry.grantNumber?.trim()) {
          return "Please enter a grant number for all entries";
        }
      }
    }

    return null;
  },

  getDisplayValue: (value) => {
    const fundingValue = value as FundingFieldValue | null;
    if (!fundingValue?.entries || fundingValue.entries.length === 0) {
      return "No funding sources";
    }

    const count = fundingValue.entries.length;
    const primary = fundingValue.entries.find(e => e.isPrimary);

    if (primary) {
      const agency = FUNDING_AGENCIES.find(a => a.id === primary.agencyId);
      const agencyName = agency?.name || primary.agencyOther || primary.agencyId;
      return `${agencyName}: ${primary.grantNumber}${count > 1 ? ` (+${count - 1} more)` : ""}`;
    }

    return `${count} funding source${count > 1 ? "s" : ""}`;
  },
};

/**
 * Register the Funding field type
 */
export function registerFundingFieldType(): void {
  registerFieldType(fundingFieldType);
}

// Auto-register when imported
registerFundingFieldType();

// Export for use in components
export { fundingFieldType };
