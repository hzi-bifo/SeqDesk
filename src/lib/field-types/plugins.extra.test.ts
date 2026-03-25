import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BILLING_SETTINGS } from "@/lib/modules/types";

async function loadPluginModules() {
  vi.resetModules();
  const index = await import("./index");
  const billing = await import("./billing");
  const funding = await import("./funding");
  const mixs = await import("./mixs");
  const projects = await import("./projects");
  const sequencingTech = await import("./sequencing-tech");

  return {
    ...index,
    ...billing,
    ...funding,
    ...mixs,
    ...projects,
    ...sequencingTech,
  };
}

describe("field type plugin quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("covers billing helpers and auto-registers the billing plugin", async () => {
    const {
      billingFieldType,
      getFieldType,
      getPspElementHint,
      getPspElementPattern,
      validatePspElement,
    } = await loadPluginModules();

    expect(getFieldType("billing")).toBe(billingFieldType);
    expect(validatePspElement("", DEFAULT_BILLING_SETTINGS)).toBeNull();
    expect(validatePspElement("1-1234", DEFAULT_BILLING_SETTINGS)).toBe(
      "PSP Element must be in format: 1-1234567-99"
    );
    expect(validatePspElement("0-1234567-99", DEFAULT_BILLING_SETTINGS)).toBe(
      "Prefix must be 1-9"
    );
    expect(validatePspElement("1-ABC-99", DEFAULT_BILLING_SETTINGS)).toBe(
      "Main part must be exactly 7 digits"
    );
    expect(validatePspElement("1-1234567-999", DEFAULT_BILLING_SETTINGS)).toBe(
      "Suffix must be 01-99"
    );
    expect(validatePspElement("1-1234567-99", DEFAULT_BILLING_SETTINGS)).toBeNull();
    expect(getPspElementHint(DEFAULT_BILLING_SETTINGS)).toBe("e.g., 1-1234567-99");
    expect(new RegExp(getPspElementPattern(DEFAULT_BILLING_SETTINGS)).test("1-1234567-07")).toBe(
      true
    );

    expect(
      billingFieldType.validate?.(null, { required: true } as never)
    ).toBe("Please provide Cost Center or PSP Element");
    expect(
      billingFieldType.validate?.(
        { pspElement: "1-1234567-99" },
        { required: true } as never
      )
    ).toBeNull();
    expect(
      billingFieldType.getDisplayValue?.({
        costCenter: "CC-001",
        pspElement: "1-1234567-99",
      }, {} as never)
    ).toBe("Cost Center: CC-001, PSP: 1-1234567-99");
    expect(billingFieldType.getDisplayValue?.(null, {} as never)).toBe("Not provided");
  });

  it("validates funding entries and formats display text", async () => {
    const { fundingFieldType, getFieldType } = await loadPluginModules();

    expect(getFieldType("funding")).toBe(fundingFieldType);
    expect(
      fundingFieldType.validate?.(null, { required: true } as never)
    ).toBe("Please add at least one funding source");
    expect(
      fundingFieldType.validate?.(
        {
          entries: [{ id: "1", agencyId: "", grantNumber: "R01" }],
        },
        { required: true } as never
      )
    ).toBe("Please select a funding agency for all entries");
    expect(
      fundingFieldType.validate?.(
        {
          entries: [{ id: "1", agencyId: "nih", grantNumber: "   " }],
        },
        { required: true } as never
      )
    ).toBe("Please enter a grant number for all entries");
    expect(
      fundingFieldType.validate?.(
        {
          entries: [{ id: "1", agencyId: "nih", grantNumber: "R01-GM123456" }],
        },
        { required: true } as never
      )
    ).toBeNull();

    expect(fundingFieldType.getDisplayValue?.(null, {} as never)).toBe("No funding sources");
    expect(
      fundingFieldType.getDisplayValue?.(
        {
          entries: [
            {
              id: "1",
              agencyId: "nih",
              grantNumber: "R01-GM123456",
              isPrimary: true,
            },
            {
              id: "2",
              agencyId: "other",
              agencyOther: "Charity",
              grantNumber: "GR-2",
            },
          ],
        },
        {} as never
      )
    ).toBe("NIH (National Institutes of Health): R01-GM123456 (+1 more)");
    expect(
      fundingFieldType.getDisplayValue?.(
        {
          entries: [
            { id: "1", agencyId: "dfg", grantNumber: "SFB1234" },
            { id: "2", agencyId: "erc", grantNumber: "ERC-2024-StG-101234567" },
          ],
        },
        {} as never
      )
    ).toBe("2 funding sources");
  });

  it("parses and stringifies projects values from legacy and JSON formats", async () => {
    const { generateProjectId, parseProjectsValue, stringifyProjectsValue } =
      await loadPluginModules();

    vi.spyOn(Date, "now").mockReturnValue(1234);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    expect(generateProjectId()).toMatch(/^proj_1234_[a-z0-9]{5}$/);
    expect(parseProjectsValue(null)).toEqual([]);
    expect(
      parseProjectsValue(
        JSON.stringify([
          { id: "proj-1", name: "Alpha" },
          { id: 2, name: "Invalid" },
        ])
      )
    ).toEqual([{ id: "proj-1", name: "Alpha" }]);
    expect(parseProjectsValue("Alpha\n\nBeta\n")).toEqual([
      { id: "proj_0", name: "Alpha" },
      { id: "proj_1", name: "Beta" },
    ]);
    expect(
      parseProjectsValue([
        { id: "proj-2", name: "Gamma" },
        { id: "proj-3", title: "Wrong shape" },
      ])
    ).toEqual([{ id: "proj-2", name: "Gamma" }]);
    expect(parseProjectsValue({ id: "proj-4", name: "Delta" })).toEqual([]);
    expect(stringifyProjectsValue([{ id: "proj-1", name: "Alpha" }])).toBe(
      '[{"id":"proj-1","name":"Alpha"}]'
    );
  });

  it("registers mixs and sequencing-tech plugins and validates their display values", async () => {
    const { getFieldType, mixsFieldType, sequencingTechFieldType } =
      await loadPluginModules();

    expect(getFieldType("mixs")).toBe(mixsFieldType);
    expect(getFieldType("sequencing-tech")).toBe(sequencingTechFieldType);

    expect(
      mixsFieldType.validate?.(null, { required: true } as never)
    ).toBe("Please select an environment type");
    expect(
      mixsFieldType.validate?.(
        { checklist: "none" },
        { required: true } as never
      )
    ).toBe("Please select an environment type");
    expect(
      mixsFieldType.validate?.(
        { checklist: "soil" },
        { required: true } as never
      )
    ).toBeNull();
    expect(mixsFieldType.getDisplayValue?.(null, {} as never)).toBe("Not selected");
    expect(
      mixsFieldType.getDisplayValue?.({ checklist: "soil" }, {} as never)
    ).toBe("soil");

    expect(
      sequencingTechFieldType.validate?.(null, { required: true } as never)
    ).toBe("Please select a sequencing technology");
    expect(
      sequencingTechFieldType.validate?.(
        { technologyId: "" },
        { required: true } as never
      )
    ).toBe("Please select a sequencing technology");
    expect(
      sequencingTechFieldType.validate?.(
        "illumina",
        { required: true } as never
      )
    ).toBeNull();
    expect(sequencingTechFieldType.getDisplayValue?.(null, {} as never)).toBe(
      "Not selected"
    );
    expect(
      sequencingTechFieldType.getDisplayValue?.("nanopore", {} as never)
    ).toBe("nanopore");
    expect(
      sequencingTechFieldType.getDisplayValue?.(
        { technologyId: "pb", technologyName: "PacBio" },
        {} as never
      )
    ).toBe("PacBio");
  });
});
