import { describe, expect, it } from "vitest";
import path from "path";
import { checkColumns } from "./flow-inputs";
import { listTemplates, serializeTemplate } from "./templates";

const counts = [{ key: "gene_id", type: "string" }, { key: "s1", type: "number" }, { key: "s2", type: "number" }];

describe("flow input checks", () => {
  it("accepts a count matrix of whole numbers", () => {
    const result = checkColumns({ kind: "counts", columns: ["gene_id"] }, counts, 3, [{ gene_id: "a", s1: 1, s2: 0 }]);
    expect(result).toEqual({ ok: true, sentence: "A count matrix, whole numbers: 3 rows × 2 samples ✓" });
  });
  it("refuses fractions and says which column", () => {
    const result = checkColumns({ kind: "counts", columns: [] }, counts, 1, [{ gene_id: "a", s1: 1.5, s2: 0 }]);
    expect(result.ok).toBe(false);
    expect(result.sentence).toContain("s1");
  });
  it("names the missing sample-sheet columns", () => {
    const result = checkColumns({ kind: "samples", columns: ["sample", "dex"] }, [{ key: "sample", type: "string" }], 2, [{ sample: "a" }, { sample: "b" }]);
    expect(result).toMatchObject({ ok: false });
    expect(result.sentence).toContain("dex");
  });
  it("refuses duplicate sample ids", () => {
    const result = checkColumns({ kind: "samples", columns: ["sample"] }, [{ key: "sample", type: "string" }], 2, [{ sample: "a" }, { sample: "a" }]);
    expect(result.ok).toBe(false);
  });
});

describe("real-example templates", () => {
  it("serves the DESeq2 and scikit-bio templates with named Data inputs", async () => {
    process.env.SEQDESK_EXPLORE_TEMPLATES_DIR = path.join(process.cwd(), "explore", "templates");
    const templates = (await listTemplates()).map(serializeTemplate);
    const rnaseq = templates.find((template) => template.id === "rnaseq-deseq2")!;
    const microbiome = templates.find((template) => template.id === "microbiome-diversity")!;
    expect(rnaseq.name).toBe("RNA-seq differential expression (DESeq2)");
    expect(rnaseq.inputs.map((input) => input.key)).toEqual(["counts", "samples"]);
    expect(rnaseq.steps).toHaveLength(4);
    expect(microbiome.inputs.map((input) => input.key)).toEqual(["counts", "samples", "taxonomy"]);
    delete process.env.SEQDESK_EXPLORE_TEMPLATES_DIR;
  });
});
