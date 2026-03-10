import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyCloneFailure,
  installGitHubPipelineSnapshot,
  isValidGitRef,
  shouldCopyWorkflowEntry,
  validatePipelineDescriptorDir,
  validateMetaxPathDescriptorDir,
} from "./metaxpath-import";

let tempDir: string;

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function buildValidManifest(): string {
  return JSON.stringify(
    {
      manifestVersion: 1,
      package: {
        id: "metaxpath",
        name: "MetaxPath",
        version: "0.1.0",
        description: "Test package",
      },
      files: {
        definition: "definition.json",
        registry: "registry.json",
        samplesheet: "samplesheet.yaml",
        readme: "README.md",
      },
      inputs: [],
      execution: {
        type: "nextflow",
        pipeline: "./workflow",
        version: "main",
        profiles: ["conda"],
        defaultParams: {},
      },
      outputs: [],
    },
    null,
    2
  );
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "metaxpath-import-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("metaxpath-import helpers", () => {
  it("validates git refs", () => {
    expect(isValidGitRef("Nextflow")).toBe(true);
    expect(isValidGitRef("release/1.2.3")).toBe(true);
    expect(isValidGitRef("feature_x-1")).toBe(true);

    expect(isValidGitRef("")).toBe(false);
    expect(isValidGitRef("bad ref")).toBe(false);
    expect(isValidGitRef("-danger")).toBe(false);
    expect(isValidGitRef("ref..oops")).toBe(false);
  });

  it("classifies clone failures", () => {
    expect(
      classifyCloneFailure("remote: Invalid username or password")
    ).toMatchObject({ status: 401 });
    expect(
      classifyCloneFailure("Remote branch no-such-branch not found in upstream origin")
    ).toMatchObject({ status: 400 });
    expect(
      classifyCloneFailure("fatal: unable to access 'https://github.com/...': timeout")
    ).toMatchObject({ status: 500 });
  });

  it("filters workflow root entries", () => {
    expect(shouldCopyWorkflowEntry("main.nf")).toBe(true);
    expect(shouldCopyWorkflowEntry("config")).toBe(true);
    expect(shouldCopyWorkflowEntry(".git")).toBe(false);
    expect(shouldCopyWorkflowEntry(".seqdesk")).toBe(false);
    expect(shouldCopyWorkflowEntry(".claude")).toBe(false);
    expect(shouldCopyWorkflowEntry("agents.md")).toBe(false);
    expect(shouldCopyWorkflowEntry("AGENTS.md")).toBe(false);
    expect(shouldCopyWorkflowEntry("claude.md")).toBe(false);
    expect(shouldCopyWorkflowEntry("CLAUDE.md")).toBe(false);
  });

  it("reports missing descriptor directory", async () => {
    const missingDir = path.join(tempDir, "missing");
    const result = await validateMetaxPathDescriptorDir(missingDir);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Descriptor directory not found");
  });

  it("reports missing descriptor files", async () => {
    const descriptorDir = path.join(tempDir, ".seqdesk/pipelines/metaxpath");
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(path.join(descriptorDir, "manifest.json"), buildValidManifest());

    const result = await validateMetaxPathDescriptorDir(descriptorDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing descriptor file: definition.json");
    expect(result.errors).toContain("Missing descriptor file: registry.json");
    expect(result.errors).toContain("Missing descriptor file: samplesheet.yaml");
  });

  it("validates manifest metaxpath execution contract", async () => {
    const descriptorDir = path.join(tempDir, ".seqdesk/pipelines/metaxpath");
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(
      path.join(descriptorDir, "manifest.json"),
      JSON.stringify(
        {
          manifestVersion: 1,
          package: {
            id: "wrong-id",
            name: "Wrong",
            version: "0.1.0",
            description: "Wrong",
          },
          files: {
            definition: "definition.json",
            registry: "registry.json",
            samplesheet: "samplesheet.yaml",
            readme: "README.md",
          },
          inputs: [],
          execution: {
            type: "snakemake",
            pipeline: "hzi-bifo/MetaxPath",
            version: "",
            profiles: ["conda"],
            defaultParams: {},
          },
          outputs: [],
        },
        null,
        2
      )
    );
    await writeFile(path.join(descriptorDir, "definition.json"), "{}");
    await writeFile(path.join(descriptorDir, "registry.json"), "{}");
    await writeFile(path.join(descriptorDir, "samplesheet.yaml"), "samplesheet:\n");

    const result = await validateMetaxPathDescriptorDir(descriptorDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'manifest.json package.id must be "metaxpath" (received "wrong-id").'
    );
    expect(result.errors).toContain(
      'manifest.json execution.pipeline must be "./workflow".'
    );
    expect(result.errors).toContain(
      'manifest.json execution.type must be "nextflow".'
    );
    expect(result.errors).toContain(
      "manifest.json execution.version must be a non-empty string."
    );
  });

  it("reports invalid manifest JSON", async () => {
    const descriptorDir = path.join(tempDir, ".seqdesk/pipelines/metaxpath");
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(path.join(descriptorDir, "manifest.json"), "{ not-json");
    await writeFile(path.join(descriptorDir, "definition.json"), "{}");
    await writeFile(path.join(descriptorDir, "registry.json"), "{}");
    await writeFile(path.join(descriptorDir, "samplesheet.yaml"), "samplesheet:\n");

    const result = await validateMetaxPathDescriptorDir(descriptorDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("manifest.json is not valid JSON.");
  });

  it("accepts a valid descriptor directory", async () => {
    const descriptorDir = path.join(tempDir, ".seqdesk/pipelines/metaxpath");
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(path.join(descriptorDir, "manifest.json"), buildValidManifest());
    await writeFile(path.join(descriptorDir, "definition.json"), "{ \"pipeline\": \"metaxpath\", \"steps\": [] }");
    await writeFile(path.join(descriptorDir, "registry.json"), "{ \"id\": \"metaxpath\" }");
    await writeFile(path.join(descriptorDir, "samplesheet.yaml"), "samplesheet:\n  format: csv\n");

    const result = await validateMetaxPathDescriptorDir(descriptorDir);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest?.execution.pipeline).toBe("./workflow");
  });

  it("validates a generic GitHub descriptor directory", async () => {
    const descriptorDir = path.join(tempDir, ".seqdesk/pipelines/custom");
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(
      path.join(descriptorDir, "manifest.json"),
      JSON.stringify(
        {
          manifestVersion: 1,
          package: {
            id: "custom",
            name: "Custom Pipeline",
            version: "1.0.0",
            description: "Generic package",
          },
          files: {
            definition: "definition.json",
            registry: "registry.json",
            samplesheet: "samplesheet.yaml",
          },
          inputs: [],
          execution: {
            type: "nextflow",
            pipeline: "nf-core/custom",
            version: "1.0.0",
            profiles: ["conda"],
            defaultParams: {},
          },
          outputs: [],
        },
        null,
        2
      )
    );
    await writeFile(path.join(descriptorDir, "definition.json"), "{}");
    await writeFile(path.join(descriptorDir, "registry.json"), "{}");
    await writeFile(path.join(descriptorDir, "samplesheet.yaml"), "samplesheet:\n");

    const result = await validatePipelineDescriptorDir(descriptorDir, "custom");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("installs a generic GitHub snapshot without copying workflow when not needed", async () => {
    const cloneDir = path.join(tempDir, "clone");
    const descriptorDir = path.join(cloneDir, ".seqdesk/pipelines/custom");
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(
      path.join(descriptorDir, "manifest.json"),
      JSON.stringify(
        {
          manifestVersion: 1,
          package: {
            id: "custom",
            name: "Custom Pipeline",
            version: "1.0.0",
            description: "Generic package",
          },
          files: {
            definition: "definition.json",
            registry: "registry.json",
            samplesheet: "samplesheet.yaml",
          },
          inputs: [],
          execution: {
            type: "nextflow",
            pipeline: "nf-core/custom",
            version: "1.0.0",
            profiles: ["conda"],
            defaultParams: {},
          },
          outputs: [],
        },
        null,
        2
      )
    );
    await writeFile(path.join(descriptorDir, "definition.json"), "{}");
    await writeFile(path.join(descriptorDir, "registry.json"), "{}");
    await writeFile(path.join(descriptorDir, "samplesheet.yaml"), "samplesheet:\n");
    await writeFile(path.join(cloneDir, "main.nf"), "workflow {}\n");

    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const result = await installGitHubPipelineSnapshot({
        pipelineId: "custom",
        cloneDir,
        repo: "example/custom",
        ref: "main",
      });
      expect(result.action).toBe("install");
      await expect(
        fs.stat(path.join(tempDir, "pipelines/custom/manifest.json"))
      ).resolves.toBeTruthy();
      await expect(
        fs.stat(path.join(tempDir, "pipelines/custom/workflow"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.chdir(originalCwd);
    }
  });
});
