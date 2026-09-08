import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { getPackage, packageToPipelineDefinition } from "./package-loader";
import { pipelineSchemaRunIssues, pipelineConfigOverrideIssues, pipelineRunOverrides } from "./config-schema-validation";
import { importedReadLengthClass } from "./import-read-technology";
import { validateManagedPipelineConfig } from './pipeline-readiness-service';

const taxonomicConfigIssues = (id: string, config: Record<string, unknown>) => pipelineSchemaRunIssues(getPackage(id)!.registry.configSchema, config);
const taxonomicConfigOverrideIssues = (id: string, config: Record<string, unknown>, admin: boolean) => pipelineConfigOverrideIssues(getPackage(id)!.registry.configSchema, config, admin);
const taxonomicRunOverrides = (id: string, config: Record<string, unknown>) => pipelineRunOverrides(getPackage(id)?.registry.configSchema, config);

describe("taxonomic packages", () => {
  it.each(["metaphlan", "cami-opal"])("loads the complete %s package through the real loader", id => {
    const pkg = getPackage(id);
    expect(pkg, id).not.toBeNull();
    expect(pkg?.manifest.package.version).toBe("0.1.0");
    expect(packageToPipelineDefinition(id)?.visibility.userCanStart).toBe(true);
    for (const output of pkg!.manifest.outputs) {
      expect(pkg!.definition.outputs?.some(candidate => candidate.id === output.id)).toBe(true);
      expect(output.writeback).toBeUndefined();
    }
  });
  it("keeps reference data out of the profiler and OPAL study-scoped", () => {
    expect(getPackage("metaphlan")?.manifest.targets?.supported).toEqual(["order", "study"]);
    expect(getPackage("metaphlan")?.registry.configSchema?.properties).not.toHaveProperty("groundTruthFile");
    const opal = getPackage("cami-opal")!;
    expect(opal.manifest.targets?.supported).toEqual(["study"]);
    expect(opal.manifest.execution.priorRunArtifacts).toMatchObject({
      scope: "study", sources: { metaphlan: ["cami_profile", "provenance"] },
    });
    for (const [id, outputs] of Object.entries(opal.manifest.execution.priorRunArtifacts!.sources)) {
      expect(getPackage(id)!.manifest.outputs.map(output => output.id)).toEqual(expect.arrayContaining(outputs));
    }
  });
  it("pins runtime tools and does not advertise unsupported long reads", () => {
    const read = (id: string) => fs.readFileSync(path.join(process.cwd(), "pipelines", id, "workflow/main.nf"), "utf8");
    expect(read("metaphlan")).toContain("bioconda::metaphlan=4.2.5");
    expect(read("cami-opal")).toContain("bioconda::cami-opal=1.0.12");
    expect(getPackage("metaphlan")?.manifest.sequencingCompatibility?.readLengthClass).toBe("short");
  });
  it("runs internal runner contract fixtures without simulating external services", () => {
    const result = spawnSync("python3", ["pipelines/cami-opal/workflow/bin/test_taxonomic_runners.py"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("Ran 20 tests");
  });
  it("protects administrator-owned paths and executor-owned staging", () => {
    expect(taxonomicConfigOverrideIssues("metaphlan", { metaphlanDb: "/untrusted/db" }, false)).toHaveLength(1);
    expect(taxonomicConfigOverrideIssues("cami-opal", { groundTruthFile: "/untrusted/file" }, false)).toHaveLength(1);
    expect(taxonomicConfigOverrideIssues("cami-opal", { profilesDir: "/untrusted" }, true)).toHaveLength(1);
    expect(taxonomicConfigOverrideIssues("metaphlan", { metaphlanDb: "/configured/db" }, true)).toEqual([]);
    expect(taxonomicConfigOverrideIssues("metaphlan", { skipUnclassifiedEstimation: false }, false)).toEqual([]);
  });
  it("does not post cached administrator paths or internal defaults from the run UI", () => {
    for (const id of ["metaphlan", "cami-opal"]) {
      const defaults = getPackage(id)!.registry.defaultConfig;
      const overrides = taxonomicRunOverrides(id, { ...defaults, runAt: "all", profilesDir: "/old/staged" });
      expect(overrides).not.toHaveProperty("metaphlanDb");
      expect(overrides).not.toHaveProperty("groundTruthFile");
      expect(overrides).not.toHaveProperty("profilesDir");
      expect(overrides).not.toHaveProperty("runAt");
      expect(taxonomicConfigOverrideIssues(id, overrides, false)).toEqual([]);
    }
    expect(taxonomicRunOverrides("cami-opal", { sampleMap: '{"sample_0":"truth"}', normalize: false })).toEqual({ sampleMap: '{"sample_0":"truth"}', normalize: false });
    expect(taxonomicRunOverrides("fastqc", { threads: 4 })).toEqual({ threads: 4 });
  });
  it("fails before launch without DB configuration or benchmark declarations", () => {
    expect(taxonomicConfigIssues("metaphlan", {})).not.toEqual([]);
    expect(taxonomicConfigIssues("cami-opal", {})).not.toEqual([]);
    expect(taxonomicConfigIssues("metaphlan", { metaphlanDb: "/db", metaphlanIndex: "mpa_pinned", skipUnclassifiedEstimation: false })).toEqual([]);
    const config = { groundTruthFile: "/reference.profile", sampleMap: '{"sample_0":"truth-0"}', predictionRunIds: "run-1", taxonomyNote: "CAMI reference version", taxonomyConfirmed: true, normalize: false };
    expect(taxonomicConfigIssues("cami-opal", config)).toEqual([]);
    expect(taxonomicConfigIssues("cami-opal", { ...config, taxonomyConfirmed: false })).toHaveLength(1);
    expect(taxonomicConfigIssues("cami-opal", { ...config, sampleMap: "{}" })).toHaveLength(1);
  });
  it('does not mistake the pinned index for a filesystem path or demand run-specific benchmark declarations during setup', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-taxonomic-setup-'));
    try {
      const meta = getPackage('metaphlan')!.registry;
      const configured = { ...meta.defaultConfig, metaphlanDb: directory, metaphlanIndex: 'mpa_pinned' };
      expect(validateManagedPipelineConfig({ pipelineId: 'metaphlan', schema: meta.configSchema, config: configured, executionMode: 'local' }).issues).toEqual([]);
      const opal = getPackage('cami-opal')!.registry;
      const reference = path.join(directory, 'internal-reference'); fs.writeFileSync(reference, 'internal fixture');
      expect(validateManagedPipelineConfig({ pipelineId: 'cami-opal', schema: opal.configSchema, config: { ...opal.defaultConfig, groundTruthFile: reference }, executionMode: 'local' }).issues).toEqual([]);
      expect(validateManagedPipelineConfig({ pipelineId: 'cami-opal', schema: opal.configSchema, config: { ...opal.defaultConfig, groundTruthFile: '/absent/reference' }, executionMode: 'local' }).issues.length).toBeGreaterThan(0);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it.each([
    [{ sourceType: "cami-benchmark", technology: "short" }, "short"],
    [{ sourceType: "cami-benchmark", technology: "long" }, "long"],
    [{ sourceType: "ena-fastq-accession", technology: "single", platform: "LS454" }, "short"],
    [{ sourceType: "ena-fastq-accession", technology: "single", platform: "OXFORD_NANOPORE" }, "long"],
    [{ sourceType: "ena-fastq-accession", technology: "single" }, null],
    [{}, null],
  ])("uses source evidence for read length, not pairedness: %j", (metadata, expected) => {
    expect(importedReadLengthClass(JSON.stringify(metadata))).toBe(expected);
  });
});
