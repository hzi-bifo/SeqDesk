export interface StudyTableValidationColumn {
  key: string;
  label: string;
  fieldType?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface StudyTableCellValidationResult {
  value: string;
  error: string | null;
}

function normalizeRawValue(value: unknown, fieldType?: string): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && fieldType === "date") {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const richText = (value as { richText?: Array<{ text?: string }> }).richText;
    if (Array.isArray(richText)) {
      return richText.map((part) => part.text ?? "").join("").trim();
    }
    const formulaResult = (value as { result?: unknown }).result;
    if (formulaResult !== undefined) {
      return normalizeRawValue(formulaResult, fieldType);
    }
    const text = (value as { text?: unknown }).text;
    if (text !== undefined) return String(text).trim();
  }
  return String(value).trim();
}

function isValidIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateStudyTableCellValue(
  column: StudyTableValidationColumn,
  rawValue: unknown
): StudyTableCellValidationResult {
  const fieldType = column.fieldType ?? "text";
  const value = normalizeRawValue(rawValue, fieldType);

  if (!value) {
    return column.required
      ? { value: "", error: `${column.label} is required` }
      : { value: "", error: null };
  }

  if (fieldType === "select" && column.options?.length) {
    const exact = column.options.find((option) => option.value === value);
    if (exact) return { value: exact.value, error: null };

    const byLabel = column.options.find(
      (option) => option.label.toLowerCase() === value.toLowerCase()
    );
    if (byLabel) return { value: byLabel.value, error: null };

    return {
      value,
      error: `Choose one of: ${column.options
        .map((option) => option.label)
        .join(", ")}`,
    };
  }

  if (fieldType === "number" && !Number.isFinite(Number(value))) {
    return { value, error: "Enter a valid number" };
  }

  if (fieldType === "date") {
    if (isValidIsoDate(value)) return { value, error: null };
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return { value: parsed.toISOString().slice(0, 10), error: null };
    }
    return { value, error: "Use a valid date" };
  }

  if (fieldType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { value, error: "Enter a valid email address" };
  }

  if (fieldType === "url") {
    try {
      new URL(value);
    } catch {
      return { value, error: "Enter a valid URL" };
    }
  }

  return { value, error: null };
}
