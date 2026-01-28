/**
 * Billing Field Type Plugin
 *
 * A special field type for collecting internal billing information.
 * Includes Cost Center and PSP Element (SAP Project Structure Plan) fields.
 *
 * Note: External funding/grants is handled by the Funding module.
 */

import { FieldTypePlugin, registerFieldType } from "../index";
import { Receipt } from "lucide-react";
import {
  BillingSettings,
  DEFAULT_BILLING_SETTINGS,
} from "@/lib/modules/types";

// Billing field value stored in customFields
export interface BillingFieldValue {
  costCenter?: string;
  pspElement?: string;
}

/**
 * Validate PSP Element format based on settings
 * Format: prefix-main-suffix (e.g., 1-1234567-99)
 */
export function validatePspElement(
  value: string,
  settings: BillingSettings
): string | null {
  if (!value?.trim()) {
    return null; // Empty is OK (handled by required check)
  }

  const trimmed = value.trim();

  // Check format: prefix-main-suffix
  const parts = trimmed.split("-");
  if (parts.length !== 3) {
    return `PSP Element must be in format: ${settings.pspExample}`;
  }

  const [prefix, main, suffix] = parts;

  // Validate prefix
  const prefixNum = parseInt(prefix, 10);
  if (
    isNaN(prefixNum) ||
    prefixNum < settings.pspPrefixRange.min ||
    prefixNum > settings.pspPrefixRange.max
  ) {
    return `Prefix must be ${settings.pspPrefixRange.min}-${settings.pspPrefixRange.max}`;
  }

  // Validate main part (must be exactly N digits)
  if (
    main.length !== settings.pspMainDigits ||
    !/^\d+$/.test(main)
  ) {
    return `Main part must be exactly ${settings.pspMainDigits} digits`;
  }

  // Validate suffix
  const suffixNum = parseInt(suffix, 10);
  if (
    isNaN(suffixNum) ||
    suffixNum < settings.pspSuffixRange.min ||
    suffixNum > settings.pspSuffixRange.max
  ) {
    return `Suffix must be ${String(settings.pspSuffixRange.min).padStart(2, "0")}-${String(settings.pspSuffixRange.max).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Format PSP Element hint based on settings
 */
export function getPspElementHint(settings: BillingSettings): string {
  return `e.g., ${settings.pspExample}`;
}

/**
 * Generate regex pattern for PSP Element validation
 */
export function getPspElementPattern(settings: BillingSettings): string {
  const prefixPattern = `[${settings.pspPrefixRange.min}-${settings.pspPrefixRange.max}]`;
  const mainPattern = `\\d{${settings.pspMainDigits}}`;
  const suffixPattern = `\\d{1,2}`;
  return `^${prefixPattern}-${mainPattern}-${suffixPattern}$`;
}

// Billing field type plugin definition
const billingFieldType: FieldTypePlugin = {
  type: "billing",
  label: "Cost Center & PSP",
  description: "Collect internal billing information (Cost Center and PSP Element)",
  icon: Receipt,
  isSpecial: true, // Not shown in regular type dropdown

  defaultConfig: {
    type: "billing",
    label: "Billing Information",
    name: "_billing",
    required: false,
    visible: true,
    helpText: "Enter your internal billing codes for cost allocation",
  },

  validate: (value, field) => {
    const billingValue = value as BillingFieldValue | null;

    if (field.required) {
      if (!billingValue?.costCenter && !billingValue?.pspElement) {
        return "Please provide Cost Center or PSP Element";
      }
    }

    // PSP validation with default settings (actual validation done with real settings in component)
    if (billingValue?.pspElement) {
      const error = validatePspElement(billingValue.pspElement, DEFAULT_BILLING_SETTINGS);
      if (error) {
        return error;
      }
    }

    return null;
  },

  getDisplayValue: (value) => {
    const billingValue = value as BillingFieldValue | null;
    if (!billingValue) {
      return "Not provided";
    }

    const parts: string[] = [];
    if (billingValue.costCenter) {
      parts.push(`Cost Center: ${billingValue.costCenter}`);
    }
    if (billingValue.pspElement) {
      parts.push(`PSP: ${billingValue.pspElement}`);
    }

    return parts.length > 0 ? parts.join(", ") : "Not provided";
  },
};

/**
 * Register the Billing field type
 */
export function registerBillingFieldType(): void {
  registerFieldType(billingFieldType);
}

// Auto-register when imported
registerBillingFieldType();

// Export for use in components
export { billingFieldType };
