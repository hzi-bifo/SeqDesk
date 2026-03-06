import { describe, expect, it } from "vitest";

import { FIELD_TO_COLUMN_MAP, mapPerSampleFieldToColumn } from "./sample-fields";

describe("sample field mapping", () => {
  it("maps core ENA-style field names to sample columns", () => {
    expect(mapPerSampleFieldToColumn("sample_alias")).toBe("sampleAlias");
    expect(mapPerSampleFieldToColumn("sample_title")).toBe("sampleTitle");
    expect(mapPerSampleFieldToColumn("sample_description")).toBe("sampleDescription");
    expect(mapPerSampleFieldToColumn("scientific_name")).toBe("scientificName");
    expect(mapPerSampleFieldToColumn("tax_id")).toBe("taxId");
  });

  it("maps direct field names and prefixed variants", () => {
    expect(mapPerSampleFieldToColumn("sampleAlias")).toBe("sampleAlias");
    expect(mapPerSampleFieldToColumn("sampleTitle")).toBe("sampleTitle");
    expect(mapPerSampleFieldToColumn("_sampleAlias")).toBe("sampleAlias");
    expect(mapPerSampleFieldToColumn("_sampleTitle")).toBe("sampleTitle");
  });

  it("maps organism fields to taxId for special handling", () => {
    expect(mapPerSampleFieldToColumn("organism")).toBe("taxId");
    expect(mapPerSampleFieldToColumn("_organism")).toBe("taxId");
  });

  it("returns undefined for unmapped fields", () => {
    expect(mapPerSampleFieldToColumn("sample_volume")).toBeUndefined();
    expect(mapPerSampleFieldToColumn("unknown_field")).toBeUndefined();
  });

  it("exports a stable map for the supported core fields", () => {
    expect(FIELD_TO_COLUMN_MAP).toMatchObject({
      sample_alias: "sampleAlias",
      sample_title: "sampleTitle",
      scientific_name: "scientificName",
      tax_id: "taxId",
      organism: "taxId",
    });
  });
});
