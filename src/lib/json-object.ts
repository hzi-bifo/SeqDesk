/**
 * Parse a JSON string into a plain object. Returns {} for null/undefined, invalid
 * JSON, or any non-object value (arrays/primitives). Shared by the surfaces that
 * read JSON columns like `checklistData`, `customFields`, and `studyMetadata`.
 */
export function parseJsonObject(
  value: string | null | undefined
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
