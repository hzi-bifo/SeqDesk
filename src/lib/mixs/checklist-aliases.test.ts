import { describe, expect, it } from "vitest";
import {
  LEGACY_CHECKLIST_ALIASES,
  resolveChecklistRef,
} from "./checklist-aliases";

describe("resolveChecklistRef", () => {
  it("returns an empty ref for falsy input", () => {
    expect(resolveChecklistRef(null)).toEqual({});
    expect(resolveChecklistRef(undefined)).toEqual({});
    expect(resolveChecklistRef("")).toEqual({});
  });

  it("treats an ENA accession as an accession ref (passthrough)", () => {
    expect(resolveChecklistRef("ERC000022")).toEqual({ accession: "ERC000022" });
    // New, non-environmental accessions resolve the same way.
    expect(resolveChecklistRef("ERC000028")).toEqual({ accession: "ERC000028" });
    expect(resolveChecklistRef("ERC000049")).toEqual({ accession: "ERC000049" });
  });

  it("matches the accession pattern case-insensitively", () => {
    expect(resolveChecklistRef("erc000022")).toEqual({ accession: "erc000022" });
  });

  it("maps every legacy picker slug to its accession", () => {
    const expected: Record<string, string> = {
      "human-gut": "ERC000015",
      "human-oral": "ERC000016",
      "human-skin": "ERC000017",
      "human-associated": "ERC000014",
      "host-associated": "ERC000013",
      "plant-associated": "ERC000020",
      soil: "ERC000022",
      water: "ERC000024",
      "wastewater-sludge": "ERC000023",
      air: "ERC000012",
      sediment: "ERC000021",
      "microbial-mat": "ERC000019",
      "misc-environment": "ERC000025",
    };
    for (const [slug, accession] of Object.entries(expected)) {
      expect(resolveChecklistRef(slug)).toEqual({ accession });
    }
  });

  it("falls back to a name ref for an unknown / free-form value", () => {
    // e.g. an older study that stored the checklist name directly.
    expect(resolveChecklistRef("GSC MIxS soil")).toEqual({ name: "GSC MIxS soil" });
    expect(resolveChecklistRef("some-custom-thing")).toEqual({ name: "some-custom-thing" });
  });
});

describe("LEGACY_CHECKLIST_ALIASES", () => {
  it("covers the 13 original hardcoded picker slugs", () => {
    expect(Object.keys(LEGACY_CHECKLIST_ALIASES)).toHaveLength(13);
  });

  it("maps every slug to a well-formed, unique ENA accession", () => {
    const accessions = Object.values(LEGACY_CHECKLIST_ALIASES);
    for (const accession of accessions) {
      expect(accession).toMatch(/^ERC\d+$/);
    }
    expect(new Set(accessions).size).toBe(accessions.length);
  });
});
