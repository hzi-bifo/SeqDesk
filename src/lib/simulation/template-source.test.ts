import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveTemplateSource,
  selectTemplatePair,
} from "./template-source";

async function touch(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "");
}

describe("template-source", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function makeTempDir() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "seqdesk-template-source-"));
    return tempDir;
  }

  it("stays in synthetic mode when synthetic mode is explicitly requested", async () => {
    const dataBasePath = await makeTempDir();

    const result = await resolveTemplateSource({
      dataBasePath,
      sequencingFilesConfig: { simulationMode: "synthetic" },
      extension: ".fastq.gz",
    });

    expect(result).toEqual({
      modeRequested: "synthetic",
      modeUsed: "synthetic",
      templateDir: null,
      templatePairs: [],
      reason: "Configured to synthetic mode",
    });
  });

  it("falls back to synthetic mode for non-gzipped extensions in auto mode", async () => {
    const dataBasePath = await makeTempDir();

    const result = await resolveTemplateSource({
      dataBasePath,
      sequencingFilesConfig: {},
      extension: ".fastq",
    });

    expect(result.modeRequested).toBe("auto");
    expect(result.modeUsed).toBe("synthetic");
    expect(result.reason).toBe("Configured extension is not gzipped");
    expect(result.templateDir).toBe(
      path.resolve(dataBasePath, "_simulation_templates/mag")
    );
  });

  it("discovers numbered template pairs and rotates them by sample index", async () => {
    const dataBasePath = await makeTempDir();
    const templateDir = path.join(dataBasePath, "_simulation_templates", "mag");

    await touch(path.join(templateDir, "template_2_1.fastq.gz"));
    await touch(path.join(templateDir, "template_2_2.fastq.gz"));
    await touch(path.join(templateDir, "template_1_1.fastq.gz"));
    await touch(path.join(templateDir, "template_1_2.fastq.gz"));
    await touch(path.join(templateDir, "template_3_1.fastq.gz"));

    const result = await resolveTemplateSource({
      dataBasePath,
      sequencingFilesConfig: { simulationMode: "auto" },
      extension: ".fastq.gz",
    });

    expect(result.modeUsed).toBe("template");
    expect(result.templateDir).toBe(templateDir);
    expect(result.templatePairs.map((pair) => pair.label)).toEqual([
      "template_1",
      "template_2",
    ]);
    expect(selectTemplatePair(result.templatePairs, 3).label).toBe("template_2");
  });

  it("discovers generic template pairs from a configured relative template directory", async () => {
    const dataBasePath = await makeTempDir();
    const templateDir = path.join(dataBasePath, "custom-templates");

    await touch(path.join(templateDir, "alpha_R1.fastq.gz"));
    await touch(path.join(templateDir, "alpha_R2.fastq.gz"));
    await touch(path.join(templateDir, "beta_1.fastq.gz"));
    await touch(path.join(templateDir, "beta_2.fastq.gz"));

    const result = await resolveTemplateSource({
      dataBasePath,
      sequencingFilesConfig: {
        simulationMode: "auto",
        simulationTemplateDir: "custom-templates",
      },
      extension: ".fq.gz",
    });

    expect(result.modeUsed).toBe("template");
    expect(result.templatePairs.map((pair) => pair.label)).toEqual(["alpha", "beta"]);
    expect(selectTemplatePair(result.templatePairs, 5).label).toBe("beta");
  });

  it("throws in template mode when no pairs are present or the extension is not gzipped", async () => {
    const dataBasePath = await makeTempDir();

    await expect(
      resolveTemplateSource({
        dataBasePath,
        sequencingFilesConfig: { simulationMode: "template" },
        extension: ".fastq.gz",
      })
    ).rejects.toThrow(/No template FASTQ pairs found/);

    await expect(
      resolveTemplateSource({
        dataBasePath,
        sequencingFilesConfig: { simulationMode: "template" },
        extension: ".fastq",
      })
    ).rejects.toThrow(/requires gzip extensions/);
  });
});
