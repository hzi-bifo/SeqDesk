import { describe, expect, it } from "vitest";

import {
  derivePlatformFromSequencingTechSelection,
  resolveOrderPlatform,
  resolveOrderSequencingTechnology,
  resolveOrderSequencingTechnologyId,
} from "./order-platform";

describe("order-platform", () => {
  it("extracts sequencing technology from JSON custom fields", () => {
    const order = {
      customFields: JSON.stringify({
        _sequencing_tech: {
          technologyId: "  ONT  ",
          technologyName: "  Oxford Nanopore  ",
        },
      }),
    };

    const selection = resolveOrderSequencingTechnology(order);
    expect(selection).toEqual({
      technologyId: "  ONT  ",
      technologyName: "  Oxford Nanopore  ",
    });

    expect(resolveOrderSequencingTechnologyId(order)).toBe("ONT");
  });

  it("accepts _sequencing_tech as a string", () => {
    const order = {
      customFields: JSON.stringify({ _sequencing_tech: "  illumina  " }),
    };

    expect(resolveOrderSequencingTechnology(order)).toEqual({
      technologyId: "illumina",
    });
    expect(resolveOrderSequencingTechnologyId(order)).toBe("illumina");
  });

  it("falls back to object-shaped selection in other custom fields", () => {
    const order = {
      customFields: {
        somethingElse: { technologyId: "PACBIO", technologyName: "PacBio" },
      },
    };

    expect(resolveOrderSequencingTechnology(order)).toEqual({
      technologyId: "PACBIO",
      technologyName: "PacBio",
    });
  });

  it("returns null for invalid customFields payloads", () => {
    expect(resolveOrderSequencingTechnology({ customFields: "{bad-json" })).toBeNull();
    expect(resolveOrderSequencingTechnology({ customFields: "[]" })).toBeNull();
    expect(resolveOrderSequencingTechnology({ customFields: null })).toBeNull();
    expect(resolveOrderSequencingTechnology(undefined)).toBeNull();
  });

  it("derives platform from technology name first, then id", () => {
    expect(
      derivePlatformFromSequencingTechSelection({
        technologyId: "ONT",
        technologyName: " Nanopore ",
      })
    ).toBe("Nanopore");

    expect(
      derivePlatformFromSequencingTechSelection({
        technologyId: "  ILLUMINA  ",
        technologyName: "",
      })
    ).toBe("ILLUMINA");

    expect(derivePlatformFromSequencingTechSelection(null)).toBeNull();
  });

  it("prefers explicit order.platform before derived platform", () => {
    const order = {
      platform: "  Manual Platform  ",
      customFields: JSON.stringify({ _sequencing_tech: "ONT" }),
    };

    expect(resolveOrderPlatform(order)).toBe("Manual Platform");
  });

  it("derives platform from selection when order.platform is absent", () => {
    expect(
      resolveOrderPlatform({
        customFields: JSON.stringify({ _sequencing_tech: { technologyId: "  ONT  " } }),
      })
    ).toBe("ONT");

    expect(resolveOrderPlatform({ platform: "   ", customFields: "{}" })).toBeNull();
    expect(resolveOrderSequencingTechnologyId({ customFields: { _sequencing_tech: "   " } })).toBe(
      null
    );
  });
});
