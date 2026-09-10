import { describe, expect, it } from "vitest";
import type { SequencingTechnology } from "@/types/sequencing-technology";
import { resolveSampleSequencingTechnology } from "./input-metadata";

const technologies = new Map<string, SequencingTechnology>([["illumina", {
  id: "illumina", name: "Illumina", manufacturer: "Illumina", shortDescription: "Short reads",
  specs: [], pros: [], cons: [], bestFor: [], available: true, order: 0,
  platformFamily: "illumina", readLengthClass: "short", supportedReadLayouts: ["single", "paired"],
}]]);

describe("resolveSampleSequencingTechnology", () => {
  it("enriches a legacy selected technology without guessing a supported layout", () => {
    expect(resolveSampleSequencingTechnology({
      orderCustomFields: JSON.stringify({ _sequencing_tech: "illumina" }), technologies,
    })).toEqual({ technologyId: "illumina", platformFamily: "illumina", readLengthClass: "short" });
  });

  it.each(["PAIRED", "paired-end", "PE"])("uses concrete checklist layout %s before order defaults", (layout) => {
    expect(resolveSampleSequencingTechnology({
      orderCustomFields: { _sequencing_tech: "illumina", read_layout: "SE" },
      sampleChecklistData: JSON.stringify({ library_layout: layout }), technologies,
    })).toMatchObject({ readLayout: "paired" });
  });

  it.each([["2x150", "paired"], ["1x75", "single"]])("uses explicit sequencing cycle choice %s", (readLength, layout) => {
    expect(resolveSampleSequencingTechnology({
      orderCustomFields: { _sequencing_tech: { technologyId: "illumina", read_length: readLength } }, technologies,
    })).toMatchObject({ readLayout: layout });
  });

  it("preserves selected metadata over subsequently changed technology defaults", () => {
    expect(resolveSampleSequencingTechnology({
      orderCustomFields: { _sequencing_tech: { technologyId: "illumina", readLengthClass: "unknown" } }, technologies,
    })).toMatchObject({ readLengthClass: "unknown" });
  });

  it("retains actual sample layout when the order has no selected technology", () => {
    expect(resolveSampleSequencingTechnology({ sampleCustomFields: { read_layout: "SE" } }))
      .toEqual({ readLayout: "single" });
  });

  it.each([undefined, null, "broken", "[]", {}])("returns unknown for missing or invalid metadata %s", (orderCustomFields) => {
    expect(resolveSampleSequencingTechnology({ orderCustomFields, technologies })).toBeNull();
  });

  it("retains an unconfigured technology ID without guessing platform or length", () => {
    expect(resolveSampleSequencingTechnology({ orderCustomFields: { _sequencing_tech: "new-tech" }, technologies }))
      .toEqual({ technologyId: "new-tech" });
  });
});
