/**
 * Barcode Field Type Plugin
 *
 * A special per-sample field type for assigning barcodes to samples.
 * Options are dynamic — resolved at runtime from the selected sequencing kit's
 * barcode set. Registered under the "sequencing-tech" module.
 */

import { FieldTypePlugin, registerFieldType } from "../index";

// Barcode field type plugin definition
const barcodeFieldType: FieldTypePlugin = {
  type: "barcode",
  label: "Barcode",
  description: "Per-sample barcode assignment (options from selected kit)",
  isSpecial: true, // Not shown in regular type dropdown

  defaultConfig: {
    type: "barcode",
    label: "Barcode",
    name: "_barcode",
    required: false,
    visible: true,
    perSample: true,
    helpText:
      "Assign a barcode to this sample. Available barcodes depend on the selected sequencing kit.",
  },

  validate: (value, field) => {
    if (field.required && (!value || value === "")) {
      return "Please select a barcode";
    }
    return null;
  },

  getDisplayValue: (value) => {
    if (!value || value === "") return "Not assigned";
    return String(value);
  },
};

/**
 * Register the Barcode field type
 */
export function registerBarcodeFieldType(): void {
  registerFieldType(barcodeFieldType);
}

// Auto-register when imported
registerBarcodeFieldType();

// Export for use in components
export { barcodeFieldType };
