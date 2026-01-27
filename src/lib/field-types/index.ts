/**
 * Field Type Plugin System
 *
 * This module provides a plugin architecture for custom field types.
 * Each field type can define its own:
 * - Admin editor component (for Form Builder)
 * - Form renderer component (for Order Form)
 * - Validation logic
 * - Default configuration
 */

import { FormFieldDefinition } from "@/types/form-config";
import { ReactNode } from "react";

// Base interface for field type plugins
export interface FieldTypePlugin {
  // Unique identifier for this field type
  type: string;

  // Display name shown in UI
  label: string;

  // Description of this field type
  description?: string;

  // Icon component (optional)
  icon?: React.ComponentType<{ className?: string }>;

  // Whether this is a "special" field type (not shown in regular type dropdown)
  isSpecial?: boolean;

  // Default field configuration when adding this type
  defaultConfig: Partial<FormFieldDefinition>;

  // Validate field value - returns error message or null if valid
  validate?: (value: unknown, field: FormFieldDefinition) => string | null;

  // Transform value before saving (optional)
  transformValue?: (value: unknown, field: FormFieldDefinition) => unknown;

  // Get display value for review (optional)
  getDisplayValue?: (value: unknown, field: FormFieldDefinition) => string;
}

// Props passed to admin editor components
export interface FieldEditorProps {
  field: Partial<FormFieldDefinition>;
  onChange: (updates: Partial<FormFieldDefinition>) => void;
  templates?: unknown[]; // Additional data (e.g., MIxS templates)
}

// Props passed to form renderer components
export interface FieldRendererProps {
  field: FormFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  disabled?: boolean;
  // Additional context
  templates?: unknown[];
  onTemplateSelect?: (templateName: string) => void;
}

// Registry of all field type plugins
const fieldTypeRegistry = new Map<string, FieldTypePlugin>();

/**
 * Register a field type plugin
 */
export function registerFieldType(plugin: FieldTypePlugin): void {
  if (fieldTypeRegistry.has(plugin.type)) {
    console.warn(`Field type "${plugin.type}" is already registered. Overwriting.`);
  }
  fieldTypeRegistry.set(plugin.type, plugin);
}

/**
 * Get a field type plugin by type
 */
export function getFieldType(type: string): FieldTypePlugin | undefined {
  return fieldTypeRegistry.get(type);
}

/**
 * Get all registered field types
 */
export function getAllFieldTypes(): FieldTypePlugin[] {
  return Array.from(fieldTypeRegistry.values());
}

/**
 * Get standard field types (non-special, shown in dropdown)
 */
export function getStandardFieldTypes(): FieldTypePlugin[] {
  return getAllFieldTypes().filter(p => !p.isSpecial);
}

/**
 * Get special field types (like MIxS)
 */
export function getSpecialFieldTypes(): FieldTypePlugin[] {
  return getAllFieldTypes().filter(p => p.isSpecial);
}

/**
 * Check if a field type is registered
 */
export function isFieldTypeRegistered(type: string): boolean {
  return fieldTypeRegistry.has(type);
}

// Re-export types
export type { FormFieldDefinition };
