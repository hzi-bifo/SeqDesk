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

  it("derives platform from technology name first, then platform family, then id", () => {
    expect(
      derivePlatformFromSequencingTechSelection({
        technologyId: "ONT",
        technologyName: " Nanopore ",
        platformFamily: "oxford-nanopore",
      })
    ).toBe("Nanopore");

    expect(
      derivePlatformFromSequencingTechSelection({
        technologyId: "  mgi-dnbseq-t7  ",
        technologyName: "",
        platformFamily: " mgi ",
      })
    ).toBe("mgi");

    expect(
      derivePlatformFromSequencingTechSelection({
        technologyId: "  ILLUMINA  ",
        technologyName: "",
      })
    ).toBe("ILLUMINA");

    expect(derivePlatformFromSequencingTechSelection(null)).toBeNull();
  });

  it("prefers sequencing technology selection before stale order.platform", () => {
    const order = {
      platform: "  Manual Platform  ",
      customFields: JSON.stringify({ _sequencing_tech: "ONT" }),
    };

    expect(resolveOrderPlatform(order)).toBe("ONT");
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
