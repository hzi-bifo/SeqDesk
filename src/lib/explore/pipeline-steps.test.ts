/**
 * Pipelines as recipe steps: the pure parts. The step's code and reuse key are stable and change only with what
 * changes the work; settings are checked like the integration API starts pipelines (admin settings refused); sample
 * lists match reads by name without guessing; a few reads tell amplicons from shotgun; fit is said, never guessed.
 */
import { describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./__fixtures__/memory-db");
  memory.db = createMemoryDb().db;
  return { db: memory.db };
});
vi.mock("@/lib/pipelines/package-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pipelines/package-loader")>()),
  getPackage: (id: string) => (id === "fastqc" ? {
    id: "fastqc", basePath: "/packages/fastqc",
    manifest: { package: { id: "fastqc", name: "FastQC", version: "0.12.1", description: "Checks read quality per sample.", provider: "SeqDesk" },
      outputs: [
        { id: "summary", scope: "run", destination: "run_artifact", discovery: { pattern: "summary.tsv" }, table: { label: "FastQC quality summary", tableKind: "sample-summary", sampleColumn: "sample_id" } },
        { id: "multiqc_report", scope: "run", destination: "run_artifact", type: "report", discovery: { pattern: "multiqc/multiqc_report.html" }, result: { kind: "run_artifact", preview: { label: "MultiQC report" } } },
        { id: "fastqc_reads", scope: "sample", destination: "sample_reads", discovery: { pattern: "*_R1_fastqc.html" }, writeback: { target: "Read", mode: "merge", fields: {} } },
      ] },
  } : undefined),
}));

import type { PipelineDefinition } from "@/lib/pipelines/types";
import {
  canonicalJson, fileOutputsOf, matchSamplesToReads, normalizeSampleName, outputNameFor, parsePipelineStepConfig, pipelineInputHash, pipelineSettings, pipelineStepCode,
  stepKindOf, tableOutputsOf, validateStepParams, type PipelineStepConfig,
} from "./pipeline-steps";
import { codeHashOf } from "./analyses";
import { fitOf, headSequences, primerPattern, sniffReads, type DataSummary } from "./pipeline-lab";
import fs from "fs/promises";
import os from "os";
import path from "path";
import zlib from "zlib";

const definition = {
  id: "fastqc", name: "FastQC", description: "Checks read quality", category: "qc", version: "0.12.1", requires: {}, outputs: [], visibility: { showToUser: true, userCanStart: true },
  input: { supportedScopes: ["study"], minSamples: 1, perSample: { reads: true, pairedEnd: false } }, samplesheet: { format: "csv", generator: "samplesheet.yaml" },
  configSchema: {
    type: "object", additionalProperties: false, required: ["database"],
    properties: {
      nogroup: { type: "boolean", title: "No grouping", default: false, "x-seqdesk": { placement: "basic" } },
      kmers: { type: "integer", title: "Kmer size", minimum: 2, maximum: 10, default: 7, "x-seqdesk": { placement: "advanced" } },
      adapters: { type: "string", title: "Adapter set", enum: ["default", "nextera"], default: "default", "x-seqdesk": { placement: "basic" } },
      database: { type: "string", title: "Reference database", "x-seqdesk": { placement: "basic" } },
      threads: { type: "integer", title: "Threads", default: 4, "x-seqdesk": { placement: "admin" } },
      outdir: { type: "string", title: "Output folder", "x-seqdesk": { placement: "derived" } },
    },
  },
  defaultConfig: { nogroup: false, kmers: 7, adapters: "default" },
} as unknown as PipelineDefinition;

const config = (over: Partial<PipelineStepConfig> = {}): PipelineStepConfig => ({ pipelineId: "fastqc", version: "0.12.1", params: { kmers: 5, nogroup: true }, samples: null, outputs: [{ outputId: "summary", name: "fastqc_summary" }], ...over });
const reads = { files: [{ id: "f2", name: "S1_R2.fastq.gz", size: 20 }, { id: "f1", name: "S1_R1.fastq.gz", size: 10 }], records: [] };

describe("a pipeline step's code and reuse key", () => {
  it("writes JSON with sorted keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null }, e: undefined })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it("keeps the settings out of the code, so a settings edit reads paramChanged and a version or sample list change codeChanged", () => {
    const base = codeHashOf(pipelineStepCode(config()));
    expect(codeHashOf(pipelineStepCode(config({ params: { kmers: 9 } })))).toBe(base);
    expect(codeHashOf(pipelineStepCode(config({ presetId: "preset-1" })))).toBe(base);
    expect(codeHashOf(pipelineStepCode(config({ version: "0.12.2" })))).not.toBe(base);
    expect(codeHashOf(pipelineStepCode(config({ samples: { from: "table", datasetId: "d1", column: "sample" } })))).not.toBe(base);
    expect(codeHashOf(pipelineStepCode(config({ outputs: [] })))).not.toBe(base);
    expect(JSON.parse(pipelineStepCode(config())).params).toBeUndefined();
  });

  it("hashes the inputs canonically: settings order and file order do not matter, version, settings, reads and the sample list do", () => {
    const hash = pipelineInputHash({ pipelineId: "fastqc", version: "0.12.1", params: { a: 1, b: 2 }, reads });
    expect(pipelineInputHash({ pipelineId: "fastqc", version: "0.12.1", params: { b: 2, a: 1 }, reads: { files: [...reads.files].reverse(), records: [] } })).toBe(hash);
    expect(pipelineInputHash({ pipelineId: "fastqc", version: "0.12.2", params: { a: 1, b: 2 }, reads })).not.toBe(hash);
    expect(pipelineInputHash({ pipelineId: "fastqc", version: "0.12.1", params: { a: 1, b: 3 }, reads })).not.toBe(hash);
    expect(pipelineInputHash({ pipelineId: "fastqc", version: "0.12.1", params: { a: 1, b: 2 }, reads: { files: [...reads.files, { id: "f3", name: "S2_R1.fastq.gz", size: 5 }], records: [] } })).not.toBe(hash);
    expect(pipelineInputHash({ pipelineId: "fastqc", version: "0.12.1", params: { a: 1, b: 2 }, reads, sampleList: { contentHash: "c1", column: "sample", samples: ["S1"] } })).not.toBe(hash);
  });

  it("reads stored configurations tolerantly", () => {
    expect(parsePipelineStepConfig(JSON.stringify(config()))).toMatchObject({ pipelineId: "fastqc", version: "0.12.1", samples: null, outputs: [{ outputId: "summary", name: "fastqc_summary" }] });
    expect(parsePipelineStepConfig({ pipelineId: "fastqc", samples: { from: "table", datasetId: "d1" }, outputs: [{ outputId: "x" }] })).toMatchObject({ version: "", samples: { from: "table", datasetId: "d1", column: null }, outputs: [] });
    expect(parsePipelineStepConfig({ version: "1" })).toBeNull();
    expect(parsePipelineStepConfig("not json")).toBeNull();
    expect([stepKindOf("pipeline"), stepKindOf("samples"), stepKindOf(undefined), stepKindOf("other")]).toEqual(["pipeline", "samples", "code", "code"]);
  });
});

describe("what a pipeline step keeps", () => {
  it("names its tables in snake case, plainly", () => {
    expect(outputNameFor("fastqc", "summary")).toBe("fastqc_summary");
    expect(outputNameFor("kraken2-bracken", "bracken_report")).toBe("bracken_species");
    expect(outputNameFor("nf-core-ampliseq", "asv-table")).toBe("ampliseq_asv_table");
    expect(outputNameFor("mag", "mag_summary")).toBe("mag_summary");
  });

  it("keeps table outputs as tables and reports as files; read writebacks are neither", () => {
    expect(tableOutputsOf("fastqc")).toEqual([expect.objectContaining({ outputId: "summary", name: "fastqc_summary", label: "FastQC quality summary", tableKind: "sample-summary" })]);
    expect(fileOutputsOf("fastqc")).toEqual([{ outputId: "multiqc_report", label: "MultiQC report", kind: "report" }]);
    expect(tableOutputsOf("unknown")).toEqual([]);
  });
});

describe("a step's settings", () => {
  it("refuses unknown, admin and SeqDesk-set settings and values outside the schema, and names required ones nobody set", () => {
    expect(validateStepParams(definition, { kmers: 5, adapters: "nextera", database: "/db/silva" })).toEqual({ refused: [], missing: [] });
    const result = validateStepParams(definition, { colour: "blue", threads: 64, outdir: "/tmp", kmers: 50, adapters: "truseq" });
    expect(result.refused).toEqual(expect.arrayContaining([
      "FastQC has no setting called colour.", "Only an admin sets Threads (in the pipeline's settings on this server).", "Output folder is set by SeqDesk, not by a step.",
      "Kmer size must be at most 10.", "Adapter set must be one of: default, nextera.",
    ]));
    expect(result.missing).toEqual(["Reference database"]);
    // The admin's stored configuration counts as set.
    expect(validateStepParams(definition, {}, { database: "/db/silva" }).missing).toEqual([]);
  });

  it("lists basic settings first, never admin or derived ones, with the value it runs with and whether the step changed it", () => {
    const settings = pipelineSettings(definition, { kmers: 5, nogroup: false }, { adapters: "nextera" });
    expect(settings.map((setting) => [setting.key, setting.placement, setting.value, setting.changed])).toEqual([
      ["nogroup", "basic", false, false], ["adapters", "basic", "nextera", false], ["database", "basic", null, false], ["kmers", "advanced", 5, true],
    ]);
    expect(settings.find((setting) => setting.key === "kmers")).toMatchObject({ minimum: 2, maximum: 10, default: 7 });
  });
});

describe("sample lists and reads", () => {
  it("normalises the names sequencers and people write", () => {
    expect(normalizeSampleName("A17_S12_L001_R1_001.fastq.gz")).toBe(normalizeSampleName("A-17"));
    expect(normalizeSampleName("A01_S1_L001")).toBe("a1");
    expect(normalizeSampleName("Normal 12")).toBe("normal12");
  });

  it("matches exactly, then by the normalised name, and never guesses between two", () => {
    const match = matchSamplesToReads(["A-01", "A01b", "N-03", "B-7", " "], [{ sampleId: "A01_S1_L001" }, { sampleId: "A01b" }, { sampleId: "B7_S3" }, { sampleId: "B-07" }]);
    expect(match.matched).toEqual([{ name: "A-01", sampleId: "A01_S1_L001", how: "normalised" }, { name: "A01b", sampleId: "A01b", how: "exact" }]);
    expect(match.unmatched).toEqual(["N-03"]);
    expect(match.ambiguous).toEqual(["B-7"]);
  });
});

describe("a study's reads in one line", () => {
  // mulberry32: a small generator whose low bits are not periodic (an LCG's are, and its reads then share starts).
  const random = (length: number, seed: number) => {
    let a = seed * 2654435761 >>> 0;
    const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return Array.from({ length }, () => "ACGT"[Math.floor(next() * 4)]).join("");
  };
  it("finds 16S V4 amplicons by their primers on both reads", () => {
    const r1 = Array.from({ length: 100 }, (_, i) => `${i % 2 ? "" : "AC"}GTGCCAGCAGCCGCGGTAA${random(220, i)}`);
    const r2 = Array.from({ length: 100 }, (_, i) => `GGACTACAAGGGTATCTAAT${random(200, i + 500)}`);
    expect(sniffReads({ r1, r2 })).toMatchObject({ kind: "amplicon", region: "16S V4", primers: { forward: "515F", reverse: "806R", share: 1 }, length: { max: 241 } });
    expect(primerPattern("GTGYCAGCMGCCGCGGTAA").test("NNGTGTCAGCAGCCGCGGTAAACGT")).toBe(true);
  });

  it("tells trimmed amplicons from shotgun reads by how many reads share their start", () => {
    const shared = random(250, 1);
    expect(sniffReads({ r1: Array.from({ length: 50 }, (_, i) => (i < 30 ? shared : random(250, i + 2))), r2: [] }).kind).toBe("amplicon");
    expect(sniffReads({ r1: Array.from({ length: 200 }, (_, i) => random(150, i + 7)), r2: [] })).toMatchObject({ kind: "shotgun", region: null, length: { median: 150, max: 150 } });
    expect(sniffReads({ r1: [], r2: [] }).kind).toBeNull();
  });

  it("reads gzip FASTQ that Data stores under an id without its extension (live: 2×151 reads read as 2×960)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-head-"));
    const file = path.join(dir, "674d02fd-1a76-4349-b675-7baf3da57cf7");
    await fs.writeFile(file, zlib.gzipSync(Array.from({ length: 5 }, (_, i) => `@r${i}\n${"ACGT".repeat(37)}A\n+\n${"I".repeat(149)}\n`).join("")));
    expect((await headSequences(file, 3)).map((seq) => seq.length)).toEqual([149, 149, 149]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("fit to the data, said and never guessed", () => {
  const amplicons: DataSummary = { targetKey: "project:p", samples: 708, reads: { files: 1416, pairs: 708, single: 0, records: 0, layout: "paired", length: { median: 250, max: 250 } }, kind: "amplicon", region: "16S V4", primers: { forward: "515F", reverse: "806R", share: 0.98 }, tables: { count: 2, names: [] }, tablesOnly: false, words: "", checkedAt: "" };
  it("fits amplicon pipelines to amplicons, keeps shotgun ones apart with the reason, and says when a pipeline does not describe its fit", () => {
    expect(fitOf("ampliseq", null, amplicons)).toMatchObject({ state: "fits", lines: [{ ok: true, words: "paired FASTQ" }, { ok: true, words: "amplicons · primers 515F/806R found" }] });
    expect(fitOf("mag", null, amplicons)).toMatchObject({ state: "not-for-data", lines: [{ ok: true }, { ok: false, words: "needs shotgun reads; yours are amplicons" }] });
    expect(fitOf("kraken2-bracken", null, amplicons, ["needs the Kraken2 database"])).toMatchObject({ state: "needs", lines: [{ ok: true }, { ok: null, words: "meant for shotgun reads; works on amplicons with lower resolution" }, { ok: false, words: "needs the Kraken2 database" }] });
    expect(fitOf("rnaseq", null, amplicons)).toMatchObject({ state: "unknown", words: "Fit with your data: not described yet" });
    expect(fitOf("rnaseq", { reads: "amplicon" }, amplicons).state).toBe("fits");
    expect(fitOf("fastqc", null, { ...amplicons, samples: 0, reads: null, kind: null, tablesOnly: true })).toMatchObject({ state: "not-for-data", words: "Pipelines start from reads; your data are tables" });
    // An empty study is not "tables".
    expect(fitOf("fastqc", null, { ...amplicons, samples: 0, reads: null, kind: null, tablesOnly: false, tables: { count: 0, names: [] } })).toMatchObject({ state: "not-for-data", words: "Pipelines start from reads; add reads in Data first" });
  });
});
