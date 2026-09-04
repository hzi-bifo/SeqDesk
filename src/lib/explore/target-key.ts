/**
 * Explore scopes everything by a target key, the same shape that
 * PipelineResultSelection.targetKey already uses:
 *
 *   study:<id> | order:<id> | workspace:<id>
 *
 * Keys are parsed strictly so a malformed key can never widen a query.
 */
export type ExploreTargetType = "study" | "order" | "workspace";

export interface ExploreTargetKey {
  type: ExploreTargetType;
  id: string;
}

export const EXPLORE_TARGET_TYPES: readonly ExploreTargetType[] = [
  "study",
  "order",
  "workspace",
] as const;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isExploreTargetType(value: unknown): value is ExploreTargetType {
  return typeof value === "string" && (EXPLORE_TARGET_TYPES as readonly string[]).includes(value);
}

export function parseTargetKey(value: unknown): ExploreTargetKey | null {
  if (typeof value !== "string") return null;
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const type = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!isExploreTargetType(type)) return null;
  if (!ID_PATTERN.test(id)) return null;
  return { type, id };
}

export function formatTargetKey(type: ExploreTargetType, id: string): string {
  if (!isExploreTargetType(type)) {
    throw new Error(`Unknown Explore target type: ${type}`);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error("Explore target id contains unsupported characters");
  }
  return `${type}:${id}`;
}

export function isValidTargetKey(value: unknown): value is string {
  return parseTargetKey(value) !== null;
}

export function targetTypeLabel(type: ExploreTargetType): string {
  switch (type) {
    case "study":
      return "Study";
    case "order":
      return "Sequencing Order";
    case "workspace":
      return "Workspace";
  }
}
