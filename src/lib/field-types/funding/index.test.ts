import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/field-types/index", () => ({
  registerFieldType: vi.fn(),
}));

import { registerFieldType } from "@/lib/field-types/index";
import {
  FUNDING_AGENCIES,
  fundingFieldType,
  registerFundingFieldType,
} from "./index";
import type { FundingFieldValue } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FUNDING_AGENCIES", () => {
  it("contains expected agencies", () => {
    const ids = FUNDING_AGENCIES.map((a) => a.id);
    expect(ids).toContain("nih");
    expect(ids).toContain("nsf");
    expect(ids).toContain("dfg");
    expect(ids).toContain("bmbf");
    expect(ids).toContain("erc");
    expect(ids).toContain("horizon");
    expect(ids).toContain("wellcome");
    expect(ids).toContain("mrc");
    expect(ids).toContain("helmholtz");
    expect(ids).toContain("max_planck");
    expect(ids).toContain("other");
  });

  it("has 11 agencies", () => {
    expect(FUNDING_AGENCIES).toHaveLength(11);
  });

  it("each agency has id and name", () => {
    for (const agency of FUNDING_AGENCIES) {
      expect(agency.id).toBeTruthy();
      expect(agency.name).toBeTruthy();
    }
  });

  it("NIH has a grant number pattern", () => {
    const nih = FUNDING_AGENCIES.find((a) => a.id === "nih");
    expect(nih?.grantNumberPattern).toBeDefined();
  });
});

describe("fundingFieldType", () => {
  it("has correct metadata", () => {
    expect(fundingFieldType.type).toBe("funding");
    expect(fundingFieldType.label).toBe("External Funding & Grants");
    expect(fundingFieldType.isSpecial).toBe(true);
  });

  describe("validate", () => {
    const requiredField = { required: true } as Parameters<
      NonNullable<typeof fundingFieldType.validate>
    >[1];
    const optionalField = { required: false } as Parameters<
      NonNullable<typeof fundingFieldType.validate>
    >[1];

    it("returns error when required and no entries", () => {
      expect(fundingFieldType.validate!(null, requiredField)).toBe(
        "Please add at least one funding source"
      );
    });

    it("returns error when required and empty entries array", () => {
      const value: FundingFieldValue = { entries: [] };
      expect(fundingFieldType.validate!(value, requiredField)).toBe(
        "Please add at least one funding source"
      );
    });

    it("returns error when required and entry missing agencyId", () => {
      const value: FundingFieldValue = {
        entries: [
          { id: "1", agencyId: "", grantNumber: "R01-GM123456" },
        ],
      };
      expect(fundingFieldType.validate!(value, requiredField)).toBe(
        "Please select a funding agency for all entries"
      );
    });

    it("returns error when required and entry missing grant number", () => {
      const value: FundingFieldValue = {
        entries: [{ id: "1", agencyId: "nih", grantNumber: "" }],
      };
      expect(fundingFieldType.validate!(value, requiredField)).toBe(
        "Please enter a grant number for all entries"
      );
    });

    it("returns error when required and grant number is whitespace only", () => {
      const value: FundingFieldValue = {
        entries: [{ id: "1", agencyId: "nih", grantNumber: "   " }],
      };
      expect(fundingFieldType.validate!(value, requiredField)).toBe(
        "Please enter a grant number for all entries"
      );
    });

    it("returns null for valid required entry", () => {
      const value: FundingFieldValue = {
        entries: [
          { id: "1", agencyId: "nih", grantNumber: "R01-GM123456" },
        ],
      };
      expect(fundingFieldType.validate!(value, requiredField)).toBeNull();
    });

    it("returns null when not required and empty", () => {
      expect(fundingFieldType.validate!(null, optionalField)).toBeNull();
    });

    it("returns null when not required and has entries", () => {
      const value: FundingFieldValue = {
        entries: [
          { id: "1", agencyId: "dfg", grantNumber: "SFB1234" },
        ],
      };
      expect(fundingFieldType.validate!(value, optionalField)).toBeNull();
    });
  });

  describe("getDisplayValue", () => {
    it("returns 'No funding sources' for null", () => {
      expect(fundingFieldType.getDisplayValue!(null)).toBe(
        "No funding sources"
      );
    });

    it("returns 'No funding sources' for empty entries", () => {
      expect(fundingFieldType.getDisplayValue!({ entries: [] })).toBe(
        "No funding sources"
      );
    });

    it("shows primary funding with agency name and grant number", () => {
      const value: FundingFieldValue = {
        entries: [
          {
            id: "1",
            agencyId: "nih",
            grantNumber: "R01-GM123456",
            isPrimary: true,
          },
        ],
      };
      expect(fundingFieldType.getDisplayValue!(value)).toBe(
        "NIH (National Institutes of Health): R01-GM123456"
      );
    });

    it("shows primary funding with count of additional sources", () => {
      const value: FundingFieldValue = {
        entries: [
          {
            id: "1",
            agencyId: "nih",
            grantNumber: "R01-GM123456",
            isPrimary: true,
          },
          { id: "2", agencyId: "nsf", grantNumber: "2023456" },
        ],
      };
      expect(fundingFieldType.getDisplayValue!(value)).toBe(
        "NIH (National Institutes of Health): R01-GM123456 (+1 more)"
      );
    });

    it("shows count when no primary is set", () => {
      const value: FundingFieldValue = {
        entries: [
          { id: "1", agencyId: "nih", grantNumber: "R01-GM123456" },
          { id: "2", agencyId: "nsf", grantNumber: "2023456" },
        ],
      };
      expect(fundingFieldType.getDisplayValue!(value)).toBe(
        "2 funding sources"
      );
    });

    it("shows singular form for single non-primary entry", () => {
      const value: FundingFieldValue = {
        entries: [
          { id: "1", agencyId: "nih", grantNumber: "R01-GM123456" },
        ],
      };
      expect(fundingFieldType.getDisplayValue!(value)).toBe(
        "1 funding source"
      );
    });

    it("uses agency name from list for 'other' agency type", () => {
      const value: FundingFieldValue = {
        entries: [
          {
            id: "1",
            agencyId: "other",
            agencyOther: "Custom Foundation",
            grantNumber: "CF-001",
            isPrimary: true,
          },
        ],
      };
      // agency?.name ("Other") takes precedence over agencyOther in display
      expect(fundingFieldType.getDisplayValue!(value)).toBe(
        "Other: CF-001"
      );
    });

    it("falls back to agencyOther when agency not in list", () => {
      const value: FundingFieldValue = {
        entries: [
          {
            id: "1",
            agencyId: "unknown_agency",
            agencyOther: "Custom Foundation",
            grantNumber: "CF-001",
            isPrimary: true,
          },
        ],
      };
      expect(fundingFieldType.getDisplayValue!(value)).toBe(
        "Custom Foundation: CF-001"
      );
    });

    it("falls back to agency name from list for unknown primary", () => {
      const value: FundingFieldValue = {
        entries: [
          {
            id: "1",
            agencyId: "dfg",
            grantNumber: "SFB1234",
            isPrimary: true,
          },
        ],
      };
      expect(fundingFieldType.getDisplayValue!(value)).toBe(
        "DFG (Deutsche Forschungsgemeinschaft): SFB1234"
      );
    });
  });
});

describe("registerFundingFieldType", () => {
  it("calls registerFieldType with the plugin", () => {
    vi.mocked(registerFieldType).mockClear();
    registerFundingFieldType();
    expect(registerFieldType).toHaveBeenCalledWith(fundingFieldType);
  });
});
