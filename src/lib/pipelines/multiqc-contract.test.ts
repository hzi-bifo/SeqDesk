import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestSchema } from "./manifest-schema";

const repoRoot = process.cwd();
const multiqcRoot = path.join(repoRoot, "pipelines", "multiqc");
const manifest = ManifestSchema.parse(
  JSON.parse(fs.readFileSync(path.join(multiqcRoot, "manifest.json"), "utf8"))
);
const workflow = fs.readFileSync(
  path.join(multiqcRoot, "workflow", "main.nf"),
  "utf8"
);

describe("MultiQC package contract", () => {
  it("maps its executor-owned staging directory to an explicit Nextflow flag", () => {
    const staging = manifest.execution.priorRunArtifacts;

    expect(manifest.targets?.supported).toContain("study");
    expect(staging).toMatchObject({
      scope: "study",
      configKey: "qcDir",
      sources: {
        fastqc: ["sample_qc_data"],
        nanoplot: ["sample_stats"],
      },
    });
    expect(manifest.execution.paramMap?.[staging!.configKey]).toBe("--qc_dir");
    expect(manifest.execution.defaultParams).toMatchObject({
      reportTitle: "Study MultiQC report",
    });
    expect(manifest.execution.paramMap?.reportTitle).toBe("--report_title");
  });

  it("references source pipelines and output IDs that actually ship", () => {
    const sources = manifest.execution.priorRunArtifacts?.sources ?? {};

    for (const [pipelineId, outputIds] of Object.entries(sources)) {
      const sourcePath = path.join(repoRoot, "pipelines", pipelineId, "manifest.json");
      expect(fs.existsSync(sourcePath), `missing source pipeline ${pipelineId}`).toBe(
        true
      );
      const sourceManifest = ManifestSchema.parse(
        JSON.parse(fs.readFileSync(sourcePath, "utf8"))
      );
      const declaredOutputs = new Set(
        sourceManifest.outputs.map((output) => output.id)
      );
      for (const outputId of outputIds) {
        expect(
          declaredOutputs.has(outputId),
          `${pipelineId} does not declare source output ${outputId}`
        ).toBe(true);
      }
    }
  });

  it("fails closed for missing inputs and content-free MultiQC output", () => {
    expect(workflow).toContain(
      'error "Missing --qc_dir. SeqDesk must stage prior QC artifacts before launch."'
    );
    expect(workflow).toContain(
      'error "Staged QC input directory does not exist: ${qcDirPath}"'
    );
    expect(workflow).toMatch(
      /find -H "\$\{qc_dir\}" -type f -print -quit/
    );
    expect(workflow).not.toMatch(
      /find "\$\{qc_dir\}" -type f -print -quit/
    );
    expect(workflow).not.toContain("--strict");
    expect(workflow).toContain(
      "mv multiqc/study-multiqc_data multiqc/multiqc_data"
    );
    expect(workflow).toContain(
      "test -s multiqc/multiqc_data/multiqc_data.json"
    );
    expect(workflow).toContain("report_saved_raw_data");
    expect(workflow).toContain("multiqc_fastqc");
    expect(workflow).toContain("multiqc_nanostat");
    expect(workflow).not.toMatch(/optional\s*:\s*true/);
    expect(workflow).not.toContain("qcDirPath.mkdirs()");
  });
});
