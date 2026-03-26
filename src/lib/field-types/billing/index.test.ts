import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/field-types/index", () => ({
  registerFieldType: vi.fn(),
}));

vi.mock("@/lib/modules/types", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/modules/types")>();
  return {
    ...orig,
    DEFAULT_BILLING_SETTINGS: {
      pspEnabled: true,
      pspPrefixRange: { min: 1, max: 9 },
      pspMainDigits: 7,
      pspSuffixRange: { min: 1, max: 99 },
      pspExample: "1-1234567-99",
      costCenterEnabled: true,
      costCenterExample: "12345678",
    },
  };
});

import { registerFieldType } from "@/lib/field-types/index";
import type { BillingSettings } from "@/lib/modules/types";
import {
  billingFieldType,
  getPspElementHint,
  getPspElementPattern,
  registerBillingFieldType,
  validatePspElement,
} from "./index";

const defaultSettings: BillingSettings = {
  pspEnabled: true,
  pspPrefixRange: { min: 1, max: 9 },
  pspMainDigits: 7,
  pspSuffixRange: { min: 1, max: 99 },
  pspExample: "1-1234567-99",
  costCenterEnabled: true,
  costCenterExample: "12345678",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validatePspElement", () => {
  it("returns null for valid PSP element", () => {
    expect(validatePspElement("1-1234567-99", defaultSettings)).toBeNull();
  });

  it("returns null for empty value", () => {
    expect(validatePspElement("", defaultSettings)).toBeNull();
  });

  it("returns null for whitespace-only value", () => {
    expect(validatePspElement("   ", defaultSettings)).toBeNull();
  });

  it("returns error for wrong format (missing parts)", () => {
    expect(validatePspElement("1-1234567", defaultSettings)).toBe(
      "PSP Element must be in format: 1-1234567-99"
    );
  });

  it("returns error for too many parts", () => {
    expect(validatePspElement("1-1234567-99-extra", defaultSettings)).toBe(
      "PSP Element must be in format: 1-1234567-99"
    );
  });

  it("returns error when prefix is out of range (too low)", () => {
    expect(validatePspElement("0-1234567-99", defaultSettings)).toBe(
      "Prefix must be 1-9"
    );
  });

  it("returns error when prefix is out of range (too high)", () => {
    expect(validatePspElement("10-1234567-99", defaultSettings)).toBe(
      "Prefix must be 1-9"
    );
  });

  it("returns error when prefix is not numeric", () => {
    expect(validatePspElement("a-1234567-99", defaultSettings)).toBe(
      "Prefix must be 1-9"
    );
  });

  it("returns error when main part has wrong length", () => {
    expect(validatePspElement("1-123456-99", defaultSettings)).toBe(
      "Main part must be exactly 7 digits"
    );
  });

  it("returns error when main part has non-numeric characters", () => {
    expect(validatePspElement("1-12345ab-99", defaultSettings)).toBe(
      "Main part must be exactly 7 digits"
    );
  });

  it("returns error when suffix is out of range (too low)", () => {
    expect(validatePspElement("1-1234567-0", defaultSettings)).toBe(
      "Suffix must be 01-99"
    );
  });

  it("returns error when suffix is out of range (too high)", () => {
    expect(validatePspElement("1-1234567-100", defaultSettings)).toBe(
      "Suffix must be 01-99"
    );
  });

  it("returns error when suffix is not numeric", () => {
    expect(validatePspElement("1-1234567-ab", defaultSettings)).toBe(
      "Suffix must be 01-99"
    );
  });

  it("validates with custom settings", () => {
    const custom: BillingSettings = {
      ...defaultSettings,
      pspPrefixRange: { min: 1, max: 3 },
      pspMainDigits: 5,
      pspSuffixRange: { min: 10, max: 50 },
      pspExample: "1-12345-10",
    };
    expect(validatePspElement("2-12345-25", custom)).toBeNull();
    expect(validatePspElement("5-12345-25", custom)).toBe("Prefix must be 1-3");
  });

  it("trims whitespace before validating", () => {
    expect(validatePspElement("  1-1234567-99  ", defaultSettings)).toBeNull();
  });
});

describe("getPspElementHint", () => {
  it("generates hint text based on settings", () => {
    expect(getPspElementHint(defaultSettings)).toBe("e.g., 1-1234567-99");
  });

  it("uses custom example from settings", () => {
    const custom = { ...defaultSettings, pspExample: "2-9876543-01" };
    expect(getPspElementHint(custom)).toBe("e.g., 2-9876543-01");
  });
});

describe("getPspElementPattern", () => {
  it("generates regex pattern based on default settings", () => {
    const pattern = getPspElementPattern(defaultSettings);
    expect(pattern).toContain("[1-9]");
    expect(pattern).toContain("\\d{7}");
    expect(pattern).toContain("\\d{1,2}");
  });

  it("generated pattern matches valid PSP elements", () => {
    const pattern = getPspElementPattern(defaultSettings);
    const regex = new RegExp(pattern);
    expect(regex.test("1-1234567-99")).toBe(true);
    expect(regex.test("9-0000000-1")).toBe(true);
  });

  it("generated pattern rejects invalid PSP elements", () => {
    const pattern = getPspElementPattern(defaultSettings);
    const regex = new RegExp(pattern);
    expect(regex.test("0-1234567-99")).toBe(false);
    expect(regex.test("1-123456-99")).toBe(false);
  });
});

describe("billingFieldType", () => {
  it("has correct metadata", () => {
    expect(billingFieldType.type).toBe("billing");
    expect(billingFieldType.label).toBe("Cost Center & PSP");
    expect(billingFieldType.isSpecial).toBe(true);
  });

  it("validate returns null for valid billing value", () => {
    const value = { costCenter: "12345678", pspElement: "1-1234567-99" };
    const field = { required: true } as Parameters<
      NonNullable<typeof billingFieldType.validate>
    >[1];
    expect(billingFieldType.validate!(value, field)).toBeNull();
  });

  it("validate returns error when required and both fields empty", () => {
    const field = { required: true } as Parameters<
      NonNullable<typeof billingFieldType.validate>
    >[1];
    expect(billingFieldType.validate!(null, field)).toBe(
      "Please provide Cost Center or PSP Element"
    );
  });

  it("validate returns null when not required and empty", () => {
    const field = { required: false } as Parameters<
      NonNullable<typeof billingFieldType.validate>
    >[1];
    expect(billingFieldType.validate!(null, field)).toBeNull();
  });

  it("validate returns error for invalid PSP element", () => {
    const value = { pspElement: "invalid" };
    const field = { required: false } as Parameters<
      NonNullable<typeof billingFieldType.validate>
    >[1];
    expect(billingFieldType.validate!(value, field)).toBe(
      "PSP Element must be in format: 1-1234567-99"
    );
  });

  it("getDisplayValue shows cost center and PSP", () => {
    const value = { costCenter: "12345678", pspElement: "1-1234567-99" };
    expect(billingFieldType.getDisplayValue!(value)).toBe(
      "Cost Center: 12345678, PSP: 1-1234567-99"
    );
  });

  it("getDisplayValue shows only cost center", () => {
    const value = { costCenter: "12345678" };
    expect(billingFieldType.getDisplayValue!(value)).toBe(
      "Cost Center: 12345678"
    );
  });

  it("getDisplayValue returns 'Not provided' for null", () => {
    expect(billingFieldType.getDisplayValue!(null)).toBe("Not provided");
  });

  it("getDisplayValue returns 'Not provided' for empty object", () => {
    expect(billingFieldType.getDisplayValue!({})).toBe("Not provided");
  });
});

describe("registerBillingFieldType", () => {
  it("calls registerFieldType", () => {
    // Note: auto-registration already happened on import, so registerFieldType
    // was already called. We clear and call again explicitly.
    vi.mocked(registerFieldType).mockClear();
    registerBillingFieldType();
    expect(registerFieldType).toHaveBeenCalledWith(billingFieldType);
  });
});
