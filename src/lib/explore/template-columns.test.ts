import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { ColumnRoleSchema, fillColumnParams, resolveColumns, roleColumns, rolesLine, type TableFacts } from "./template-columns";

const template = (id: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "explore", "templates", id, "template.json"), "utf8"));
const rnaseq = template("rnaseq-deseq2");
const roles = rnaseq.columns.map((role: unknown) => ColumnRoleSchema.parse(role));

const ids = ["SRR1039508", "SRR1039509", "SRR1039512", "SRR1039513", "SRR1039516", "SRR1039517", "SRR1039520", "SRR1039521"];
const counts: TableFacts = { columns: [{ key: "gene_id", type: "string" }, ...ids.map((key) => ({ key, type: "number" }))], rows: [] };
const airway: TableFacts = {
  columns: ["sample", "cell", "dex", "run", "geo_sample"].map((key) => ({ key, type: "string" })),
  rows: ids.map((sample, i) => ({ sample, cell: `C${Math.floor(i / 2)}`, dex: i % 2 ? "trt" : "untrt", run: sample, geo_sample: `GSM${i}` })),
};
const renamed: TableFacts = {
  columns: ["SampleName", "Treatment", "CellLine"].map((key) => ({ key, type: "string" })),
  rows: ids.map((sample, i) => ({ SampleName: sample, Treatment: i % 2 ? "treated" : "control", CellLine: `line${Math.floor(i / 2)}` })),
};

describe("template column roles", () => {
  it("keeps the example's names on the example tables", () => {
    const { values, problems } = resolveColumns(roles, { counts, samples: airway });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({ gene_id: "gene_id", sample_id: "sample", group: "dex", "group.numerator": "trt", "group.denominator": "untrt", block: "cell" });
  });

  it("guesses a renamed sheet: id by the count column names, the condition, the pairing and the reference level", () => {
    const resolution = resolveColumns(roles, { counts, samples: renamed });
    expect(resolution.problems).toEqual([]);
    expect(resolution.values).toMatchObject({ sample_id: "SampleName", group: "Treatment", "group.numerator": "treated", "group.denominator": "control", block: "CellLine" });
    expect(roleColumns(resolution.roles, "samples")).toEqual(["SampleName", "Treatment", "CellLine"]);
    expect(rolesLine(resolution.roles, "samples")).toBe("sample id SampleName · condition Treatment: treated vs control · pairing or batch CellLine");
  });

  it("takes the person's choices and says what does not fit in plain sentences", () => {
    const swapped = resolveColumns(roles, { counts, samples: renamed }, { "group.numerator": "control", "group.denominator": "treated", block: "" });
    expect(swapped.values).toMatchObject({ "group.numerator": "control", "group.denominator": "treated", block: "" });
    expect(resolveColumns(roles, { counts, samples: renamed }, { sample_id: "Treatment" }).problems[0]).toMatch(/Sample ids in Treatment must be unique/);
    const oneGroup: TableFacts = { ...renamed, rows: renamed.rows.map((row) => ({ ...row, Treatment: "treated" })) };
    expect(resolveColumns(roles, { counts, samples: oneGroup }, { group: "Treatment" }).problems.join(" ")).toMatch(/Treatment has only one value \(treated\)/);
    const partial: TableFacts = { ...renamed, rows: renamed.rows.slice(0, 6) };
    expect(resolveColumns(roles, { counts, samples: partial }).problems.join(" ")).toMatch(/2 count columns have no row in SampleName: SRR1039520, SRR1039521/);
  });

  it("fills params: whole placeholders, levels, a model formula without an empty pairing and lists without blanks", () => {
    const de = rnaseq.steps.find((step: { key: string }) => step.key === "de").params;
    const top = rnaseq.steps.find((step: { key: string }) => step.key === "top").params;
    const values = { group: "Treatment", "group.numerator": "treated", "group.denominator": "control", block: "CellLine" };
    expect(fillColumnParams(de, values)).toMatchObject({ design: "~ CellLine + Treatment", factor: "Treatment", numerator: "treated", denominator: "control", padj_cutoff: 0.05 });
    expect(fillColumnParams(de, { ...values, block: "" }).design).toBe("~ Treatment");
    expect(fillColumnParams(top, { ...values, block: "" }).annotate_by).toEqual(["Treatment"]);
    expect(fillColumnParams({ untouched: "{{other}}" }, values)).toEqual({ untouched: "{{other}}" });
  });

  it("keeps defaults for an input without a table", () => {
    const { values, problems } = resolveColumns(roles, { counts, samples: null });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({ sample_id: "sample", group: "dex", "group.numerator": "trt", block: "" });
  });

  it("the microbiome template guesses its three tables", () => {
    const microbiome = template("microbiome-diversity");
    const mroles = microbiome.columns.map((role: unknown) => ColumnRoleSchema.parse(role));
    const samples = ["A1", "A2", "B1", "B2", "C1"];
    const table: TableFacts = { columns: ["SampleID", "site", "host"].map((key) => ({ key, type: "string" })), rows: samples.map((s, i) => ({ SampleID: s, site: ["gut", "gut", "tongue", "tongue", "palm"][i], host: i % 2 ? "h1" : "h2" })) };
    const { values, problems } = resolveColumns(mroles, {
      counts: { columns: [{ key: "asv", type: "string" }, ...samples.map((key) => ({ key, type: "number" }))], rows: [] },
      samples: table,
      taxonomy: { columns: [{ key: "asv", type: "string" }, { key: "lineage", type: "string" }], rows: [{ asv: "x", lineage: "k__B" }, { asv: "y", lineage: "k__A" }] },
    });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({ feature_id: "asv", sample_id: "SampleID", group: "site", "group.a": "gut", "group.b": "tongue", subject: "host", taxonomy_id: "asv", taxon: "lineage" });
  });
});
