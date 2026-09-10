import type { FormFieldDefinition } from "@/types/form-config";

/** Adapt legacy built-in labels for the shared data UI, not the facility order form. */
export function getSequencingDataSectionLabel(id: string, label: string): string {
  if (
    id === "group_details" &&
    ["sequencing order details", "order details"].includes(label.trim().toLowerCase())
  ) {
    return "Sequencing data details";
  }
  return label;
}

export function getSequencingDataFieldLabel(
  field: Pick<FormFieldDefinition, "label" | "isSystem" | "systemKey">
): string {
  if (
    field.isSystem &&
    field.systemKey === "name" &&
    ["sequencing order name", "order name"].includes(field.label.trim().toLowerCase())
  ) {
    return "Sequencing data name";
  }
  return field.label;
}
