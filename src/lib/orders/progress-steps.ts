import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

export type OrderProgressStepKind =
  | "group"
  | "ungrouped"
  | "mixs"
  | "samples"
  | "facility"
  | "review";

export interface OrderProgressStep {
  id: string;
  label: string;
  description: string;
  icon: string;
  kind: OrderProgressStepKind;
}

interface BuildOrderProgressStepsOptions {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  enabledMixsChecklists?: string[];
  includeFacilityFields?: boolean;
}

export function getOrderProgressAnchorId(stepId: string): string {
  return `order-progress-${stepId}`;
}

export function buildOrderProgressSteps({
  fields,
  groups,
  enabledMixsChecklists = [],
  includeFacilityFields = false,
}: BuildOrderProgressStepsOptions): OrderProgressStep[] {
  const visibleFields = fields.filter((field) => field.visible);
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
  const hasActiveSequencingTechField = visibleFields.some(
    (field) => !field.perSample && field.type === "sequencing-tech"
  );
  const hiddenGroupIds = new Set(
    hasActiveSequencingTechField
      ? sortedGroups
          .filter((group) => {
            const groupName = group.name.toLowerCase();
            const groupId = group.id.toLowerCase();
            return groupName.includes("software") || groupId.includes("software");
          })
          .map((group) => group.id)
      : []
  );

  const regularOrderFields = visibleFields.filter(
    (field) =>
      !field.perSample &&
      !field.adminOnly &&
      (!field.groupId || !hiddenGroupIds.has(field.groupId))
  );
  const regularNonMixsFields = regularOrderFields.filter(
    (field) => field.type !== "mixs"
  );
  const adminOnlyOrderFields = includeFacilityFields
    ? visibleFields.filter(
        (field) =>
          !field.perSample &&
          field.adminOnly &&
          field.type !== "mixs" &&
          (!field.groupId || !hiddenGroupIds.has(field.groupId))
      )
    : [];
  const adminOnlySampleFields = includeFacilityFields
    ? visibleFields.filter((field) => field.perSample && field.adminOnly)
    : [];

  const steps: OrderProgressStep[] = [];

  for (const group of sortedGroups) {
    if (hiddenGroupIds.has(group.id)) continue;

    const hasFieldsInGroup = regularNonMixsFields.some(
      (field) => field.groupId === group.id
    );
    if (!hasFieldsInGroup) continue;

    steps.push({
      id: group.id,
      label: group.name,
      description: group.description || "",
      icon: group.icon || "FileText",
      kind: "group",
    });
  }

  const hasUngroupedFields = regularNonMixsFields.some((field) => !field.groupId);
  if (hasUngroupedFields) {
    steps.push({
      id: "_ungrouped",
      label: "Additional Details",
      description: "Other order information",
      icon: "ClipboardList",
      kind: "ungrouped",
    });
  }

  const hasMixsStep =
    regularOrderFields.some((field) => field.type === "mixs") &&
    enabledMixsChecklists.length > 0;
  if (hasMixsStep) {
    steps.push({
      id: "mixs",
      label: "Sample Metadata",
      description: "Select MIxS environment checklist for your samples",
      icon: "Leaf",
      kind: "mixs",
    });
  }

  steps.push({
    id: "samples",
    label: "Samples",
    description: "Add your samples to this order",
    icon: "Table",
    kind: "samples",
  });

  if (adminOnlyOrderFields.length > 0 || adminOnlySampleFields.length > 0) {
    steps.push({
      id: "_facility",
      label: "Facility Fields",
      description: "Internal facility information",
      icon: "Shield",
      kind: "facility",
    });
  }

  steps.push({
    id: "review",
    label: "Review",
    description: "Review and submit your order",
    icon: "CheckCircle2",
    kind: "review",
  });

  return steps;
}
