import { describe, expect, it } from "vitest";
import { processingDeclarationSchema, resolveImportProcessing, sourceProcessing } from "./import-processing";

describe("import processing provenance", () => {
  it.each(["cami-benchmark", "ena-fastq-accession"])("does not infer cleaning from %s", provider => {
    expect(resolveImportProcessing(sourceProcessing(provider), undefined, "owner")).toMatchObject({ effectiveState: "unknown", source: { state: "unknown", evidence: "not_provided" } });
  });
  it.each(["unknown", "unprocessed", "cleaned"] as const)("preserves the source separately from a %s declaration", state => {
    const source = sourceProcessing("cami-benchmark");
    const result = resolveImportProcessing(source, { state, details: "  Source documentation reviewed  " }, "owner");
    expect(source.state).toBe("unknown");
    expect(result).toMatchObject({ source, effectiveState: state, userDeclaration: { state, details: "Source documentation reviewed", userId: "owner" } });
    expect(Number.isFinite(Date.parse(result.userDeclaration!.recordedAt))).toBe(true);
  });
  it("rejects missing evidence, invalid states and caller-supplied attribution", () => {
    for (const declaration of [{ state: "cleaned", details: " " }, { state: "assembly", details: "test" }, { state: "cleaned", details: "test", userId: "someone-else" }]) {
      expect(processingDeclarationSchema.safeParse(declaration).success).toBe(false);
    }
  });
});
