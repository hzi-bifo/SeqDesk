/**
 * MIxS Field Type Plugin
 *
 * A special field type for GSC MIxS (Minimum Information about any Sequence)
 * metadata collection. This allows users to select an environment checklist
 * (e.g., Soil, Water, Host-Associated) and fill in the corresponding
 * standardized metadata fields.
 */

import { FieldTypePlugin, registerFieldType } from "../index";
import { Leaf } from "lucide-react";

// MIxS template structure
export interface MixsTemplate {
  name: string;
  description: string;
  version: string;
  source?: string;
  category: string;
  fields: MixsFieldDef[];
}

export interface MixsFieldDef {
  type: string;
  label: string;
  name: string;
  required: boolean;
  visible: boolean;
  helpText?: string;
  placeholder?: string;
  example?: string;
  options?: Array<{ value: string; label: string }>;
  aiValidation?: {
    enabled: boolean;
    prompt: string;
    strictness?: "lenient" | "moderate" | "strict";
  };
}

// MIxS field type plugin definition
const mixsFieldType: FieldTypePlugin = {
  type: "mixs",
  label: "MIxS Metadata",
  description: "GSC MIxS standard metadata selector with environment-specific fields",
  icon: Leaf,
  isSpecial: true, // Not shown in regular type dropdown

  defaultConfig: {
    type: "mixs",
    label: "Sample Metadata (MIxS)",
    name: "_mixs",
    required: false,
    visible: true,
    helpText: "Select the environment type for your samples to see MIxS standard metadata fields",
    mixsChecklists: [], // Will be populated with available checklists
  },

  validate: (value, field) => {
    // Value is an object with { checklist: string, fields: Record<string, unknown> }
    if (field.required) {
      const mixsValue = value as { checklist?: string; fields?: Record<string, unknown> } | null;
      if (!mixsValue?.checklist || mixsValue.checklist === "none") {
        return "Please select an environment type";
      }
    }
    return null;
  },

  getDisplayValue: (value) => {
    const mixsValue = value as { checklist?: string } | null;
    return mixsValue?.checklist || "Not selected";
  },
};

/**
 * Register the MIxS field type
 */
export function registerMixsFieldType(): void {
  registerFieldType(mixsFieldType);
}

// Auto-register when imported
registerMixsFieldType();

// Export for use in components
export { mixsFieldType };
