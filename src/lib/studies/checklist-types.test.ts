import { describe, expect, it } from "vitest";
import {
  resolveStudyChecklistTypeId,
  studyChecklistTypeToAccession,
} from "./checklist-types";

describe("resolveStudyChecklistTypeId", () => {
  it("passes a canonical slug through unchanged", () => {
    expect(resolveStudyChecklistTypeId("water")).toBe("water");
    expect(resolveStudyChecklistTypeId("human-gut")).toBe("human-gut");
  });

  it("resolves an ENA accession to its slug (new-study-wizard format)", () => {
    expect(resolveStudyChecklistTypeId("ERC000024")).toBe("water");
    expect(resolveStudyChecklistTypeId("erc000015")).toBe("human-gut"); // case-insensitive
  });

  it("resolves a display name to its slug (seed/demo format)", () => {
    expect(resolveStudyChecklistTypeId("Water")).toBe("water");
    expect(resolveStudyChecklistTypeId("Human Gut")).toBe("human-gut");
    expect(resolveStudyChecklistTypeId("Wastewater/Sludge")).toBe("wastewater-sludge");
    expect(resolveStudyChecklistTypeId("  Soil  ")).toBe("soil");
  });

  it("returns '' for an empty or unresolvable value (no data is invented)", () => {
    expect(resolveStudyChecklistTypeId("")).toBe("");
    expect(resolveStudyChecklistTypeId(null)).toBe("");
    expect(resolveStudyChecklistTypeId("Built Environment")).toBe("");
    expect(resolveStudyChecklistTypeId("ERC999999")).toBe("");
  });
});

describe("studyChecklistTypeToAccession", () => {
  it("maps a slug to its ENA accession", () => {
    expect(studyChecklistTypeToAccession("water")).toBe("ERC000024");
    expect(studyChecklistTypeToAccession("human-gut")).toBe("ERC000015");
  });

  it("passes an unknown value (e.g. an accession) through unchanged", () => {
    expect(studyChecklistTypeToAccession("ERC000024")).toBe("ERC000024");
    expect(studyChecklistTypeToAccession("custom-checklist")).toBe("custom-checklist");
  });
});
