import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadFieldTypeModules() {
  vi.resetModules();
  const standard = await import("./standard");
  const index = await import("./index");
  return { ...standard, ...index };
}

describe("standard field types", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers the built-in field types and validates text input rules", async () => {
    const { getFieldType, getStandardFieldTypes } = await loadFieldTypeModules();
    const textField = getFieldType("text");

    expect(textField).toBeTruthy();
    expect(getStandardFieldTypes().map((fieldType) => fieldType.type)).toEqual(
      expect.arrayContaining([
        "text",
        "textarea",
        "select",
        "multiselect",
        "checkbox",
        "number",
        "date",
      ])
    );

    expect(
      textField?.validate?.("", { label: "Name", required: true } as never)
    ).toBe("Name is required");
    expect(
      textField?.validate?.("ab", {
        label: "Name",
        required: false,
        simpleValidation: { minLength: 3 },
      } as never)
    ).toBe("Name must be at least 3 characters");
    expect(
      textField?.validate?.("abcdef", {
        label: "Name",
        required: false,
        simpleValidation: { maxLength: 5 },
      } as never)
    ).toBe("Name must be at most 5 characters");
    expect(
      textField?.validate?.("abc", {
        label: "Code",
        required: false,
        simpleValidation: {
          pattern: "^[A-Z]+$",
          patternMessage: "Uppercase only",
        },
      } as never)
    ).toBe("Uppercase only");
    expect(
      textField?.validate?.("ABCD", {
        label: "Code",
        required: false,
        simpleValidation: { minLength: 2, maxLength: 5 },
      } as never)
    ).toBeNull();
  });

  it("formats and validates select, multiselect, checkbox, number, and date values", async () => {
    const { getFieldType } = await loadFieldTypeModules();
    const selectField = getFieldType("select");
    const multiselectField = getFieldType("multiselect");
    const checkboxField = getFieldType("checkbox");
    const numberField = getFieldType("number");
    const dateField = getFieldType("date");

    const optionField = {
      label: "Choice",
      required: true,
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    } as never;

    expect(selectField?.validate?.("", optionField)).toBe("Choice is required");
    expect(selectField?.getDisplayValue?.("b", optionField)).toBe("Beta");
    expect(multiselectField?.validate?.([], optionField)).toBe("Choice is required");
    expect(multiselectField?.getDisplayValue?.(["a", "b"], optionField)).toBe(
      "Alpha, Beta"
    );

    expect(
      checkboxField?.validate?.(false, { label: "Approved", required: true } as never)
    ).toBe("Approved must be checked");
    expect(checkboxField?.getDisplayValue?.(true, {} as never)).toBe("Yes");
    expect(checkboxField?.getDisplayValue?.(false, {} as never)).toBe("No");

    expect(
      numberField?.validate?.("abc", { label: "Reads", required: false } as never)
    ).toBe("Reads must be a number");
    expect(
      numberField?.validate?.(1, {
        label: "Reads",
        required: false,
        simpleValidation: { minValue: 2 },
      } as never)
    ).toBe("Reads must be at least 2");
    expect(
      numberField?.validate?.(10, {
        label: "Reads",
        required: false,
        simpleValidation: { maxValue: 5 },
      } as never)
    ).toBe("Reads must be at most 5");
    expect(numberField?.validate?.(4, { label: "Reads", required: true } as never)).toBeNull();

    expect(dateField?.validate?.("", { label: "Run Date", required: true } as never)).toBe(
      "Run Date is required"
    );
    expect(dateField?.getDisplayValue?.("", {} as never)).toBe("");
    expect(dateField?.getDisplayValue?.("2024-01-02", {} as never)).toBeTruthy();
  });

  it("warns when the built-in field types are registered a second time", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registerStandardFieldTypes } = await loadFieldTypeModules();

    registerStandardFieldTypes();

    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes('Field type "text" is already registered')
      )
    ).toBe(true);
  });
});
