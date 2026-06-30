import { describe, it, expect } from "vitest";

import {
  validateStudyTableCellValue,
  type StudyTableValidationColumn,
} from "./study-table-validation";

const col = (
  overrides: Partial<StudyTableValidationColumn> = {}
): StudyTableValidationColumn => ({
  key: "field",
  label: "Field",
  ...overrides,
});

describe("validateStudyTableCellValue - text (default fieldType)", () => {
  it("trims surrounding whitespace and returns no error", () => {
    expect(validateStudyTableCellValue(col(), "  hello  ")).toEqual({
      value: "hello",
      error: null,
    });
  });

  it("treats an omitted fieldType as text", () => {
    expect(validateStudyTableCellValue(col({ fieldType: undefined }), "plain")).toEqual({
      value: "plain",
      error: null,
    });
  });
});

describe("validateStudyTableCellValue - required / empty handling", () => {
  it("errors with `<label> is required` for a required empty value", () => {
    expect(
      validateStudyTableCellValue(col({ label: "Title", required: true }), "")
    ).toEqual({ value: "", error: "Title is required" });
  });

  it("treats whitespace-only input as empty for a required column", () => {
    expect(
      validateStudyTableCellValue(col({ label: "Title", required: true }), "   ")
    ).toEqual({ value: "", error: "Title is required" });
  });

  it("returns empty value with no error when not required and empty", () => {
    expect(validateStudyTableCellValue(col({ required: false }), "")).toEqual({
      value: "",
      error: null,
    });
  });

  it("returns empty value with no error when required flag is absent and empty", () => {
    expect(validateStudyTableCellValue(col(), "")).toEqual({
      value: "",
      error: null,
    });
  });
});

describe("validateStudyTableCellValue - number", () => {
  it("accepts a finite numeric string", () => {
    expect(validateStudyTableCellValue(col({ fieldType: "number" }), "42")).toEqual({
      value: "42",
      error: null,
    });
  });

  it("accepts a finite decimal/negative numeric string (trimmed)", () => {
    expect(validateStudyTableCellValue(col({ fieldType: "number" }), " -3.5 ")).toEqual({
      value: "-3.5",
      error: null,
    });
  });

  it("rejects a non-numeric string", () => {
    expect(validateStudyTableCellValue(col({ fieldType: "number" }), "abc")).toEqual({
      value: "abc",
      error: "Enter a valid number",
    });
  });
});

describe("validateStudyTableCellValue - date", () => {
  it("accepts a valid ISO date unchanged", () => {
    expect(validateStudyTableCellValue(col({ fieldType: "date" }), "2025-05-05")).toEqual({
      value: "2025-05-05",
      error: null,
    });
  });

  it("normalizes a non-ISO but Date-parseable string to ISO yyyy-mm-dd", () => {
    // Explicit UTC instant: TZ-stable, not in strict yyyy-mm-dd form so it
    // falls through to the new Date() fallback and is normalized.
    expect(
      validateStudyTableCellValue(col({ fieldType: "date" }), "2025-05-05T12:00:00Z")
    ).toEqual({ value: "2025-05-05", error: null });
  });

  it("errors on an unparseable date string", () => {
    expect(
      validateStudyTableCellValue(col({ fieldType: "date" }), "not a date")
    ).toEqual({ value: "not a date", error: "Use a valid date" });
  });

  it("errors on an out-of-range calendar ISO (fails strict check and Date fallback)", () => {
    // "2025-13-40" fails isValidIsoDate and `new Date("2025-13-40")` is NaN,
    // so it reaches the "Use a valid date" branch.
    expect(
      validateStudyTableCellValue(col({ fieldType: "date" }), "2025-13-40")
    ).toEqual({ value: "2025-13-40", error: "Use a valid date" });
  });
});

describe("validateStudyTableCellValue - email", () => {
  it("accepts a valid email", () => {
    expect(validateStudyTableCellValue(col({ fieldType: "email" }), "a@b.com")).toEqual({
      value: "a@b.com",
      error: null,
    });
  });

  it("rejects an invalid email", () => {
    expect(validateStudyTableCellValue(col({ fieldType: "email" }), "nope")).toEqual({
      value: "nope",
      error: "Enter a valid email address",
    });
  });
});

describe("validateStudyTableCellValue - url", () => {
  it("accepts a valid URL", () => {
    expect(validateStudyTableCellValue(col({ fieldType: "url" }), "https://x.org")).toEqual({
      value: "https://x.org",
      error: null,
    });
  });

  it("rejects an invalid URL", () => {
    expect(validateStudyTableCellValue(col({ fieldType: "url" }), "not a url")).toEqual({
      value: "not a url",
      error: "Enter a valid URL",
    });
  });
});

describe("validateStudyTableCellValue - select with options", () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ];

  it("returns the value on an exact value match", () => {
    expect(
      validateStudyTableCellValue(col({ fieldType: "select", options }), "a")
    ).toEqual({ value: "a", error: null });
  });

  it("maps a case-insensitive label match to the option value", () => {
    expect(
      validateStudyTableCellValue(col({ fieldType: "select", options }), "bEtA")
    ).toEqual({ value: "b", error: null });
  });

  it("errors with `Choose one of:` and the labels for an unknown value", () => {
    expect(
      validateStudyTableCellValue(col({ fieldType: "select", options }), "gamma")
    ).toEqual({ value: "gamma", error: "Choose one of: Alpha, Beta" });
  });

  it("falls through to text validation when select has no options", () => {
    expect(
      validateStudyTableCellValue(col({ fieldType: "select", options: [] }), "  free  ")
    ).toEqual({ value: "free", error: null });
  });
});

describe("validateStudyTableCellValue - normalizeRawValue via rawValue inputs", () => {
  it("treats null as empty", () => {
    expect(validateStudyTableCellValue(col(), null)).toEqual({
      value: "",
      error: null,
    });
  });

  it("treats undefined as empty", () => {
    expect(validateStudyTableCellValue(col(), undefined)).toEqual({
      value: "",
      error: null,
    });
  });

  it("converts a Date instance to an ISO date slice for fieldType date", () => {
    const date = new Date("2025-05-05T12:00:00Z");
    expect(validateStudyTableCellValue(col({ fieldType: "date" }), date)).toEqual({
      value: "2025-05-05",
      error: null,
    });
  });

  it("joins richText parts into a single string", () => {
    expect(
      validateStudyTableCellValue(col(), {
        richText: [{ text: "a" }, { text: "b" }],
      })
    ).toEqual({ value: "ab", error: null });
  });

  it("unwraps a formula result object", () => {
    expect(validateStudyTableCellValue(col(), { result: 42 })).toEqual({
      value: "42",
      error: null,
    });
  });

  it("unwraps a text object", () => {
    expect(validateStudyTableCellValue(col(), { text: "hello" })).toEqual({
      value: "hello",
      error: null,
    });
  });
});
