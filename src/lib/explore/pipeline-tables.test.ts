import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestSchema } from "@/lib/pipelines/manifest-schema";
import { knownPipelineTable } from "./pipeline-tables";
import { applyTableContract, inferSchema } from "./schema";
import { parsePipelineTable } from "./parsers/pipeline-table";
import { chartChoices, initialChartSpec } from "./report-source-actions";
import { buildChart } from "./report-widgets";

describe("FastQC report table contract", () => {
  it("extends the legacy declaration with typed metadata owned by the pipeline package", () => {
    const manifest = ManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "pipelines/fastqc/manifest.json"), "utf8")));
    const table = manifest.outputs.find(output => output.id === "summary")?.table;
    expect(table).toMatchObject(knownPipelineTable("fastqc", "summary")!);
    expect(table?.columns?.r1_avg_quality).toMatchObject({ type: "number", unit: "Phred" });
    expect(table?.sampleColumn).toBe("sample_id");
    expect(Object.keys(table?.columnLabels ?? {})).toHaveLength(10);
  });
});

describe("package-owned report table declarations", () => {
  it.each([
    { pipeline: "nanoplot", output: "summary_tsv", measurement: "num_reads", unit: "reads", label: "Read count", axisLabel: "Read count (reads)",
      text: "sample_id\tnum_reads\ttotal_bases\tmean_length\tmedian_length\tread_n50\tmean_quality\nINTERNAL_SAMPLE\t4\t8000\t2000\t1800\t2200\t14.1\n" },
    { pipeline: "read-cleaning", output: "report_summary", measurement: "classified_read_ids", unit: "read IDs", label: "Flagged read IDs", axisLabel: "Flagged read IDs",
      text: JSON.stringify([{ sample_record: "sample-1", source_sample: "INTERNAL_SAMPLE", classifier: "Kraken2", classified_read_ids: 4, blastn_unique_ids: null }]) },
  ])("uses $pipeline declarations with the shared parser and charts", ({ pipeline, output, text, measurement, unit, label, axisLabel }) => {
    const manifest = ManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), `pipelines/${pipeline}/manifest.json`), "utf8")));
    const table = manifest.outputs.find(entry => entry.id === output)!.table!;
    // New integrations must not grow the old pipeline-name compatibility map.
    expect(knownPipelineTable(pipeline, output)).toBeNull();
    const parsed = parsePipelineTable(text, table);
    const schema = applyTableContract(inferSchema(parsed.rows), parsed.rows, table);
    expect(schema.columns.find(column => column.key === measurement)).toMatchObject({ type: "number", unit, label });
    expect(chartChoices(schema.columns)).toContain("values");
    const spec = { ...initialChartSpec(schema.columns), x: table.sampleColumn! };
    const chart = buildChart(parsed.rows, schema.columns, spec);
    expect(chart.data[0].y).toEqual([4]);
    expect(chart.layout.yaxis).toEqual({ title: { text: axisLabel } });
  });

  it("does not present the original tool-specific cleaning summary as a generic table", () => {
    const manifest = ManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "pipelines/read-cleaning/manifest.json"), "utf8")));
    expect(manifest.outputs.find(output => output.id === "summary")?.table).toBeUndefined();
    expect(manifest.outputs.find(output => output.id === "cleaned_read_candidates")?.result?.writebackPolicy).toBe("admin_review");
  });

  it("keeps a sample summary distinct from an individual-read distribution", () => {
    const manifest = ManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "pipelines/nanoplot/manifest.json"), "utf8")));
    const table = manifest.outputs.find(output => output.id === "summary_tsv")!.table!;
    expect(table.rowEntity).toBe("sample");
    expect(table.description).toContain("not individual reads");
    expect(table.columns?.mean_quality.unit).toBe("Phred");
    expect(table.columns?.read_n50.unit).toBe("bp");
    const parsed = parsePipelineTable("sample_id\tnum_reads\nS1\t4\n", table);
    expect(() => applyTableContract(inferSchema(parsed.rows), parsed.rows, table)).toThrow(/Required column/);
  });
});
