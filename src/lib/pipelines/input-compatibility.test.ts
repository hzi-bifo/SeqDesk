import { describe, expect, it } from "vitest";
import {
  assessPipelineInputCompatibility,
  assessPipelineSampleCompatibility,
  getPipelineSampleCountIssue,
  type PipelineCompatibilitySample,
  type PipelineInputRequirements,
} from "./input-compatibility";
import { getOrderPipelineSampleReadiness } from "./order-pipeline-readiness";
import { getEligibleStudySampleIds, getStudySampleReadIssue } from "@/components/pipelines/study-pipeline-utils";

const generic: PipelineInputRequirements = {
  input: { minSamples: 1, perSample: { reads: true, readMode: "single_or_paired" } },
  sequencingCompatibility: { readLengthClass: "both", readLayouts: ["single", "paired"] },
};
const paired: PipelineCompatibilitySample = {
  reads: [{ id: "r1", file1: "R1.fastq.gz", file2: "R2.fastq.gz", filesMissing: false, isActive: true }],
  sequencingTechnology: { technologyId: "nova", platformFamily: "illumina", readLengthClass: "short", readLayout: "paired" },
};
const single: PipelineCompatibilitySample = {
  reads: [{ file1: "reads.fastq.gz", filesMissing: false }],
  sequencingTechnology: { platformFamily: "oxford-nanopore", readLengthClass: "long", readLayout: "single" },
};
const nanoplot: PipelineInputRequirements = {
  ...generic,
  sequencingCompatibility: { readLengthClass: "long", readLayouts: ["single"], platformFamilies: ["oxford-nanopore", "pacbio"] },
};

describe("pipeline input compatibility", () => {
  it("accepts explicitly supported paired short and single long inputs", () => {
    expect(assessPipelineSampleCompatibility(generic, paired).status).toBe("compatible");
    expect(assessPipelineSampleCompatibility(generic, single).status).toBe("compatible");
    expect(assessPipelineSampleCompatibility(nanoplot, single).status).toBe("compatible");
  });

  it("reports a short/long mismatch even when other metadata or file verification is unknown", () => {
    expect(assessPipelineSampleCompatibility(nanoplot, {
      reads: [{ file1: "reads.fastq.gz" }],
      sequencingTechnology: { readLengthClass: "short" },
    })).toMatchObject({ status: "incompatible", reason: expect.stringContaining("Requires long reads") });
  });

  it("does not interpret one filename as proof of single-end input", () => {
    const result = assessPipelineSampleCompatibility(generic, { reads: single.reads });
    expect(result).toMatchObject({ status: "unknown", reason: expect.stringContaining("layout is unknown") });
  });

  it("uses the actual pair when layout metadata is absent", () => {
    expect(assessPipelineSampleCompatibility(generic, { reads: paired.reads }).status).toBe("compatible");
  });

  it("identifies a missing mate using either the pipeline requirement or declared layout", () => {
    expect(assessPipelineSampleCompatibility(generic, { ...paired, reads: single.reads })).toEqual({ status: "incompatible", reason: "Missing R2 file" });
    expect(assessPipelineSampleCompatibility({ ...generic, input: { perSample: { reads: true, pairedEnd: true } } }, single))
      .toEqual({ status: "incompatible", reason: "Missing R2 file" });
  });

  it("reports conflicting layout metadata as unknown", () => {
    expect(assessPipelineSampleCompatibility(generic, { ...single, reads: paired.reads }))
      .toMatchObject({ status: "unknown", reason: expect.stringContaining("metadata disagree") });
  });

  it("respects an explicit single_or_paired mode over legacy pairedEnd", () => {
    expect(assessPipelineSampleCompatibility({ ...generic, input: { perSample: { reads: true, pairedEnd: true, readMode: "single_or_paired" } } }, single).status).toBe("compatible");
  });

  it("distinguishes missing files from unavailable file verification", () => {
    expect(assessPipelineSampleCompatibility(generic, { ...paired, reads: [{ ...paired.reads![0], filesMissing: true }] }))
      .toEqual({ status: "incompatible", reason: "Files missing" });
    expect(assessPipelineSampleCompatibility(generic, { ...paired, reads: [{ ...paired.reads![0], filesMissing: null }] }))
      .toMatchObject({ status: "unknown", reason: expect.stringContaining("availability has not been verified") });
  });

  it("treats undeclared pipeline compatibility and platform capability both as unknown", () => {
    expect(assessPipelineSampleCompatibility({ input: generic.input }, paired).status).toBe("unknown");
    expect(assessPipelineSampleCompatibility(nanoplot, { ...single, sequencingTechnology: { ...single.sequencingTechnology, readLengthClass: "both" } }).status).toBe("unknown");
    expect(assessPipelineSampleCompatibility({}, paired).status).toBe("unknown");
  });

  it("checks platform and configured technology restrictions", () => {
    expect(assessPipelineSampleCompatibility(nanoplot, { ...single, sequencingTechnology: { ...single.sequencingTechnology, platformFamily: "illumina" } }))
      .toMatchObject({ status: "incompatible", reason: expect.stringContaining("platform illumina") });
    const restricted = { ...generic, config: { allowedSequencingTechnologies: ["minion"] } };
    expect(assessPipelineSampleCompatibility(restricted, paired).status).toBe("incompatible");
    expect(assessPipelineSampleCompatibility(restricted, single).status).toBe("unknown");
    expect(assessPipelineSampleCompatibility({ ...generic, config: { allowedSequencingTechnologies: ["nova"] } }, paired).status).toBe("compatible");
  });

  it("ignores inactive historical pairs and the displayed read when active inputs are provided", () => {
    const sample = { read: paired.reads![0], reads: [{ ...paired.reads![0], isActive: false }] };
    expect(assessPipelineSampleCompatibility(generic, sample)).toEqual({ status: "incompatible", reason: "Missing reads" });
  });

  it("checks the read record execution selects, rather than any available matching record", () => {
    const sample = { ...paired, reads: [
      { id: "a", dataClass: "cleaned", file1: "missing_R1", file2: "missing_R2", filesMissing: true },
      { id: "b", dataClass: "raw", file1: "present_R1", file2: "present_R2", filesMissing: false },
    ] };
    expect(assessPipelineSampleCompatibility(generic, sample)).toEqual({ status: "incompatible", reason: "Files missing" });
    expect(assessPipelineSampleCompatibility({ ...generic, pipelineId: "read-cleaning" }, sample).status).toBe("compatible");
    expect(assessPipelineSampleCompatibility({ ...generic, pipelineId: "read-cleaning" }, { ...paired, reads: [{ ...paired.reads![0], dataClass: "cleaned" }] }))
      .toEqual({ status: "incompatible", reason: "Needs raw or unknown reads" });
  });

  it("supports pipelines without existing read inputs and keeps additional inputs unknown", () => {
    const simulation = { pipelineId: "simulate-reads", input: { perSample: { reads: false } } };
    expect(assessPipelineSampleCompatibility(simulation, {}).status).toBe("compatible");
    expect(assessPipelineSampleCompatibility({ ...simulation, inputCompatibilityWarnings: ["Inputs from previous pipeline runs have not been checked"] }, {}).status).toBe("unknown");
  });

  it("checks declared assembly and bin inputs without treating missing information as absence", () => {
    const assembly = { input: { perSample: { reads: false, assemblies: true } } };
    expect(assessPipelineSampleCompatibility(assembly, {}).status).toBe("unknown");
    expect(assessPipelineSampleCompatibility(assembly, { assemblies: [] }).status).toBe("incompatible");
    expect(assessPipelineSampleCompatibility(assembly, { assemblies: [{ assemblyFile: "contigs.fa" }] }).status).toBe("compatible");
    expect(assessPipelineSampleCompatibility(assembly, { preferredAssemblyId: "missing", assemblies: [{ id: "other", assemblyFile: "contigs.fa" }] }))
      .toEqual({ status: "incompatible", reason: "Selected assembly is missing" });
    expect(assessPipelineSampleCompatibility({ input: { perSample: { reads: false, bins: true } } }, { bins: [] }).status).toBe("incompatible");
  });

  it("summarizes mixed samples with counted reasons and separates failed requests from empty targets", () => {
    expect(assessPipelineInputCompatibility(generic, [paired, paired, { reads: [] }, { reads: [] }]))
      .toMatchObject({ status: "partial", compatibleSamples: 2, totalSamples: 4, reasons: [{ reason: "Missing reads", count: 2 }] });
    expect(assessPipelineInputCompatibility(generic, null).status).toBe("unknown");
    expect(assessPipelineInputCompatibility(generic, []).status).toBe("incompatible");
    expect(assessPipelineInputCompatibility(generic, [paired, { reads: single.reads }]).status).toBe("partial");
    expect(assessPipelineInputCompatibility(generic, [{ reads: single.reads }, { reads: [] }]).status).toBe("unknown");
  });

  it("requires enough compatible samples while allowing a subset below the maximum", () => {
    const minTwo = { ...generic, input: { ...generic.input, minSamples: 2 } };
    expect(assessPipelineInputCompatibility(minTwo, [paired, { reads: [] }]).status).toBe("incompatible");
    expect(assessPipelineInputCompatibility(minTwo, [paired, { reads: single.reads }]).status).toBe("unknown");
    expect(assessPipelineInputCompatibility({ ...generic, input: { ...generic.input, maxSamples: 1 } }, [paired, paired]))
      .toMatchObject({ status: "partial", summary: expect.stringContaining("select at most 1") });
    expect(getPipelineSampleCountIssue(minTwo, 1)).toBe("Requires at least 2 samples per run");
    expect(getPipelineSampleCountIssue(minTwo, 2)).toBeNull();
    expect(getPipelineSampleCountIssue({ input: { maxSamples: 1 } }, 2)).toBe("Accepts at most 1 sample per run");
  });

  it("does not apply generic read selection to custom samplesheet scripts", () => {
    expect(assessPipelineSampleCompatibility({ ...generic, inputSelection: "custom" }, { reads: [] }).status).toBe("unknown");
  });

  it("keeps generated inputs unknown when their mode can differ from planned order metadata", () => {
    const sample = { ...paired, reads: [{ file1: "generated.fastq.gz", filesMissing: false, pipelineSources: '{"simulate-reads":"run-1"}' }] };
    expect(assessPipelineSampleCompatibility(generic, sample)).toMatchObject({ status: "unknown", reason: expect.stringContaining("Generated read layout") });
    expect(getOrderPipelineSampleReadiness({ pipeline: generic, sample }).ready).toBe(true);
  });

  it("uses the same known mismatch in order and study sample eligibility", () => {
    const sample = { id: "s1", sampleId: "S1", ...paired, reads: [{ file1: "R1.fastq.gz", file2: "R2.fastq.gz", filesMissing: false }] };
    const assessed = assessPipelineSampleCompatibility(nanoplot, sample);
    expect(getOrderPipelineSampleReadiness({ pipeline: nanoplot, sample })).toEqual({ ready: false, reason: assessed.reason });
    expect(getStudySampleReadIssue(sample, nanoplot)).toBe(assessed.reason);
    expect(getEligibleStudySampleIds([sample], nanoplot)).toEqual(new Set());
    // Older packages are not disabled merely because they lack new declarations.
    expect(getOrderPipelineSampleReadiness({ pipeline: { input: generic.input }, sample }).ready).toBe(true);
  });
});
