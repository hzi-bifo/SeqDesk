import type { SequencingTechSelection } from "@/types/sequencing-technology";

type CustomFieldsValue = string | Record<string, unknown> | null | undefined;

type OrderLike = {
  platform?: string | null;
  customFields?: CustomFieldsValue;
} | null | undefined;

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseCustomFields(
  value: CustomFieldsValue
): Record<string, unknown> | null {
  if (!value) return null;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return null;
}

function isSequencingTechSelection(
  value: unknown
): value is SequencingTechSelection {
  return (
    !!value &&
    typeof value === "object" &&
    hasNonEmptyString((value as { technologyId?: unknown }).technologyId)
  );
}

function extractSequencingTechSelection(
  customFields: Record<string, unknown> | null
): SequencingTechSelection | null {
  if (!customFields) return null;

  const direct = customFields._sequencing_tech;
  if (isSequencingTechSelection(direct)) {
    return direct;
  }
  if (hasNonEmptyString(direct)) {
    return { technologyId: direct.trim() };
  }

  // Fallback: find any object-valued field that looks like a sequencing-tech selection.
  for (const value of Object.values(customFields)) {
    if (isSequencingTechSelection(value)) {
      return value;
    }
  }

  return null;
}

export function resolveOrderSequencingTechnology(
  order: OrderLike
): SequencingTechSelection | null {
  if (!order) return null;
  const customFields = parseCustomFields(order.customFields);
  return extractSequencingTechSelection(customFields);
}

export function resolveOrderSequencingTechnologyId(
  order: OrderLike
): string | null {
  const selection = resolveOrderSequencingTechnology(order);
  if (!selection) return null;
  if (hasNonEmptyString(selection.technologyId)) {
    return selection.technologyId.trim();
  }
  return null;
}

export function derivePlatformFromSequencingTechSelection(
  selection: SequencingTechSelection | null
): string | null {
  if (!selection) return null;
  if (hasNonEmptyString(selection.technologyName)) {
    return selection.technologyName.trim();
  }
  if (hasNonEmptyString(selection.technologyId)) {
    return selection.technologyId.trim();
  }
  return null;
}

export function resolveOrderPlatform(order: OrderLike): string | null {
  if (!order) return null;

  if (hasNonEmptyString(order.platform)) {
    return order.platform.trim();
  }

  const selection = resolveOrderSequencingTechnology(order);
  return derivePlatformFromSequencingTechSelection(selection);
}
