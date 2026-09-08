import { describe, expect, it } from "vitest";
import { applyIndivoGrammar, parseIndivoId } from "./indivo-id";

describe("INDIVO id grammar", () => {
  it("parses the canonical form", () => {
    const parsed = parseIndivoId("A001_hd_U_D463");
    expect(parsed).toMatchObject({
      specimen: "A001",
      subject: "A001",
      depletion: "hd",
      timepoint: 463,
      replicate: "",
      sampletypeCode: "U",
      sampletype: "Urine",
      cohort: "clinical",
      isolateLabel: null,
    });
  });

  it("handles missing depletion, replicates and protocol variants", () => {
    expect(parseIndivoId("A109_U_D1212a")).toMatchObject({ depletion: "unknown", replicate: "a", sampletype: "Urine", timepoint: 1212 });
    expect(parseIndivoId("A003_hd-shield_A-SBP+_D521")).toMatchObject({ depletion: "hd", sampletypeCode: "A-SBP+", sampletype: "Ascites" });
    expect(parseIndivoId("A003_A-SBP+_D521")).toMatchObject({ depletion: "unknown", sampletypeCode: "A-SBP+" });
  });

  it("recognises old-style and new-style isolate ids", () => {
    expect(parseIndivoId("A242_Encasseliflavus_nd_A_D1801")).toMatchObject({ depletion: "nd", sampletypeCode: "A", sampletype: "Ascites" });
    expect(parseIndivoId("A280=Escherichia.coli_nd_U_D2263")).toMatchObject({ subject: "A280", isolateLabel: "Escherichia.coli", sampletype: "Urine" });
  });

  it("classifies controls from the sample column or the code", () => {
    expect(parseIndivoId("Control1=Beadbeating_nd_Control_D1877_barcode05", "control")).toMatchObject({ sampletype: "Control/Env", cohort: "control" });
    expect(parseIndivoId("X1_hd_Water_D5", null)).toMatchObject({ sampletype: "Control/Env" });
    expect(parseIndivoId("A5_hd_U_D5", "Urine")).toMatchObject({ sampletype: "Urine" });
    expect(parseIndivoId("A5_hd_BAL_D5")).toMatchObject({ sampletype: "BAL" });
  });

  it("adds derived columns without overwriting existing ones", () => {
    const rows = applyIndivoGrammar(
      [
        { "A-ID": "A001_hd_U_D463", sample: "Urine", isIsolate: 0, subject: "keep" },
        { "A-ID": "A280=Escherichia.coli_nd_U_D2263", sample: "Urine", isIsolate: 1 },
      ],
      { idColumn: "A-ID", sampleTypeColumn: "sample", isolateColumn: "isIsolate" }
    );
    expect(rows[0]).toMatchObject({ subject: "keep", timepoint: 463, specimen_type: "Urine", depletion_protocol: "hd", cohort: "clinical", is_isolate: false });
    expect(rows[1]).toMatchObject({ subject: "A280", is_isolate: true, depletion_protocol: "nd" });
  });
});
