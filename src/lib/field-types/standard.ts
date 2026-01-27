/**
 * Standard Field Types
 *
 * These are the basic field types that come built-in.
 */

import { FieldTypePlugin, registerFieldType } from "./index";
import {
  Type,
  AlignLeft,
  ChevronDown,
  ListChecks,
  ToggleLeft,
  Hash,
  Calendar,
} from "lucide-react";

// Text input
const textField: FieldTypePlugin = {
  type: "text",
  label: "Text Input",
  description: "Single line text input",
  icon: Type,
  defaultConfig: {
    type: "text",
    required: false,
    visible: true,
  },
  validate: (value, field) => {
    if (field.required && (!value || String(value).trim() === "")) {
      return `${field.label} is required`;
    }
    const strValue = String(value || "");
    const sv = field.simpleValidation;
    if (sv?.minLength && strValue.length < sv.minLength) {
      return `${field.label} must be at least ${sv.minLength} characters`;
    }
    if (sv?.maxLength && strValue.length > sv.maxLength) {
      return `${field.label} must be at most ${sv.maxLength} characters`;
    }
    if (sv?.pattern) {
      const regex = new RegExp(sv.pattern);
      if (!regex.test(strValue)) {
        return sv.patternMessage || `${field.label} format is invalid`;
      }
    }
    return null;
  },
};

// Textarea
const textareaField: FieldTypePlugin = {
  type: "textarea",
  label: "Text Area",
  description: "Multi-line text input",
  icon: AlignLeft,
  defaultConfig: {
    type: "textarea",
    required: false,
    visible: true,
  },
  validate: textField.validate, // Same validation as text
};

// Select dropdown
const selectField: FieldTypePlugin = {
  type: "select",
  label: "Dropdown",
  description: "Single selection from options",
  icon: ChevronDown,
  defaultConfig: {
    type: "select",
    required: false,
    visible: true,
    options: [],
  },
  validate: (value, field) => {
    if (field.required && (!value || String(value).trim() === "")) {
      return `${field.label} is required`;
    }
    return null;
  },
  getDisplayValue: (value, field) => {
    const option = field.options?.find(o => o.value === value);
    return option?.label || String(value || "");
  },
};

// Multi-select
const multiselectField: FieldTypePlugin = {
  type: "multiselect",
  label: "Multi-Select",
  description: "Multiple selections from options",
  icon: ListChecks,
  defaultConfig: {
    type: "multiselect",
    required: false,
    visible: true,
    options: [],
  },
  validate: (value, field) => {
    const arr = Array.isArray(value) ? value : [];
    if (field.required && arr.length === 0) {
      return `${field.label} is required`;
    }
    return null;
  },
  getDisplayValue: (value, field) => {
    const arr = Array.isArray(value) ? value : [];
    return arr
      .map(v => {
        const option = field.options?.find(o => o.value === v);
        return option?.label || v;
      })
      .join(", ");
  },
};

// Checkbox
const checkboxField: FieldTypePlugin = {
  type: "checkbox",
  label: "Checkbox",
  description: "Boolean yes/no toggle",
  icon: ToggleLeft,
  defaultConfig: {
    type: "checkbox",
    required: false,
    visible: true,
  },
  validate: (value, field) => {
    if (field.required && !value) {
      return `${field.label} must be checked`;
    }
    return null;
  },
  getDisplayValue: (value) => {
    return value ? "Yes" : "No";
  },
};

// Number
const numberField: FieldTypePlugin = {
  type: "number",
  label: "Number",
  description: "Numeric input",
  icon: Hash,
  defaultConfig: {
    type: "number",
    required: false,
    visible: true,
  },
  validate: (value, field) => {
    if (field.required && (value === undefined || value === null || value === "")) {
      return `${field.label} is required`;
    }
    if (value !== undefined && value !== null && value !== "") {
      const num = Number(value);
      if (isNaN(num)) {
        return `${field.label} must be a number`;
      }
      const sv = field.simpleValidation;
      if (sv?.minValue !== undefined && num < sv.minValue) {
        return `${field.label} must be at least ${sv.minValue}`;
      }
      if (sv?.maxValue !== undefined && num > sv.maxValue) {
        return `${field.label} must be at most ${sv.maxValue}`;
      }
    }
    return null;
  },
};

// Date
const dateField: FieldTypePlugin = {
  type: "date",
  label: "Date",
  description: "Date picker",
  icon: Calendar,
  defaultConfig: {
    type: "date",
    required: false,
    visible: true,
  },
  validate: (value, field) => {
    if (field.required && !value) {
      return `${field.label} is required`;
    }
    return null;
  },
  getDisplayValue: (value) => {
    if (!value) return "";
    try {
      return new Date(String(value)).toLocaleDateString();
    } catch {
      return String(value);
    }
  },
};

/**
 * Register all standard field types
 */
export function registerStandardFieldTypes(): void {
  registerFieldType(textField);
  registerFieldType(textareaField);
  registerFieldType(selectField);
  registerFieldType(multiselectField);
  registerFieldType(checkboxField);
  registerFieldType(numberField);
  registerFieldType(dateField);
}

// Auto-register when this module is imported
registerStandardFieldTypes();
