/**
 * Sequencing Technology Field Type Plugin
 *
 * A special field type for selecting sequencing technology.
 * Shows card-based technology selector with specs, pros/cons, and best-use cases.
 */

import { FieldTypePlugin, registerFieldType } from "../index";
import { Dna } from "lucide-react";

// Sequencing tech field value stored in customFields
export interface SequencingTechFieldValue {
  technologyId: string;
  technologyName?: string; // Cached name for display
}

// Sequencing tech field type plugin definition
const sequencingTechFieldType: FieldTypePlugin = {
  type: "sequencing-tech",
  label: "Sequencing Technology",
  description: "Interactive technology selector with specs, pros/cons",
  icon: Dna,
  isSpecial: true, // Not shown in regular type dropdown

  defaultConfig: {
    type: "sequencing-tech",
    label: "Sequencing Technology",
    name: "_sequencing_tech",
    required: false,
    visible: true,
    helpText: "Select the sequencing technology for your samples",
  },

  validate: (value, field) => {
    const techValue = value as SequencingTechFieldValue | string | null;

    if (field.required) {
      if (!techValue) {
        return "Please select a sequencing technology";
      }
      // Handle both string (just ID) and object format
      if (typeof techValue === "string" && !techValue) {
        return "Please select a sequencing technology";
      }
      if (typeof techValue === "object" && !techValue.technologyId) {
        return "Please select a sequencing technology";
      }
    }

    return null;
  },

  getDisplayValue: (value) => {
    const techValue = value as SequencingTechFieldValue | string | null;
    if (!techValue) {
      return "Not selected";
    }

    // Handle string format (just ID)
    if (typeof techValue === "string") {
      return techValue;
    }

    // Handle object format
    return techValue.technologyName || techValue.technologyId || "Not selected";
  },
};

/**
 * Register the Sequencing Technology field type
 */
export function registerSequencingTechFieldType(): void {
  registerFieldType(sequencingTechFieldType);
}

// Auto-register when imported
registerSequencingTechFieldType();

// Export for use in components
export { sequencingTechFieldType };
