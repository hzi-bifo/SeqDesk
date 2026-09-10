import { describe, expect, it } from "vitest";
import { getSequencingDataFieldLabel, getSequencingDataSectionLabel } from "./sequencing-data-labels";

describe("shared sequencing data labels", () => {
  it.each(["Sequencing Order Details", "Order Details", " sequencing order details "])(
    "adapts the legacy details label %s",
    (label) => {
      expect(getSequencingDataSectionLabel("group_details", label)).toBe("Sequencing data details");
    }
  );

  it("preserves custom section names and unrelated sections", () => {
    expect(getSequencingDataSectionLabel("group_details", "Lab project information")).toBe("Lab project information");
    expect(getSequencingDataSectionLabel("custom_group", "Sequencing Order Details")).toBe("Sequencing Order Details");
    expect(getSequencingDataSectionLabel("group_sequencing", "Sequencing Information")).toBe("Sequencing Information");
  });

  it.each(["Sequencing Order Name", "Order Name", " sequencing order name "])(
    "adapts the built-in name label %s",
    (label) => {
      expect(getSequencingDataFieldLabel({ label, isSystem: true, systemKey: "name" })).toBe("Sequencing data name");
    }
  );

  it("preserves admin-customized labels and fields that are not the built-in name", () => {
    expect(getSequencingDataFieldLabel({ label: "Batch name", isSystem: true, systemKey: "name" })).toBe("Batch name");
    expect(getSequencingDataFieldLabel({ label: "Sequencing Order Name", isSystem: false })).toBe("Sequencing Order Name");
    expect(getSequencingDataFieldLabel({ label: "Number of Samples", isSystem: true, systemKey: "numberOfSamples" })).toBe("Number of Samples");
  });
});
