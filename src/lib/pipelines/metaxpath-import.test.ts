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

function buildValidDefinition(id: string): string {
  return JSON.stringify({
    pipeline: id,
    name: `${id} pipeline`,
    description: "Test package",
    version: "1.0.0",
    steps: [],
    inputs: [],
    outputs: [],
  });
}

function buildValidRegistry(id: string): string {
  return JSON.stringify({
    id,
    name: `${id} pipeline`,
    description: "Test package",
    category: "analysis",
    version: "1.0.0",
    requires: {},
    outputs: [],
    visibility: {
      showToUser: true,
      userCanStart: true,
    },
    input: {
      supportedScopes: ["study"],
      perSample: {
        reads: false,
        pairedEnd: false,
      },
    },
    samplesheet: {
      format: "csv",
      generator: "internal",
    },
    configSchema: {
      type: "object",
      properties: {},
    },
    defaultConfig: {},
    icon: "beaker",
  });
}

const validSamplesheet =
  "samplesheet:\n  format: csv\n  filename: samples.csv\n  rows:\n    scope: sample\n  columns:\n    - name: sample\n      source: sample.sampleId\n";

const originalPipelinesDir = process.env.SEQDESK_PIPELINES_DIR;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "metaxpath-import-"));
  delete process.env.SEQDESK_PIPELINES_DIR;
});

afterEach(async () => {
  if (originalPipelinesDir === undefined) {
    delete process.env.SEQDESK_PIPELINES_DIR;
  } else {
    process.env.SEQDESK_PIPELINES_DIR = originalPipelinesDir;
  }
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
    await writeFile(path.join(descriptorDir, "README.md"), "# MetaxPath\n");

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
    await writeFile(
      path.join(descriptorDir, "definition.json"),
      buildValidDefinition("custom")
    );
    await writeFile(
      path.join(descriptorDir, "registry.json"),
      buildValidRegistry("custom")
    );
    await writeFile(path.join(descriptorDir, "samplesheet.yaml"), validSamplesheet);
    await writeFile(path.join(cloneDir, "main.nf"), "workflow {}\n");

    const originalCwd = process.cwd();
    const pipelinesDir = path.join(tempDir, "shared-pipelines");
    process.env.SEQDESK_PIPELINES_DIR = pipelinesDir;
    process.chdir(tempDir);
    try {
      const result = await installGitHubPipelineSnapshot({
        pipelineId: "custom",
        cloneDir,
        repo: "example/custom",
        ref: "main",
        includeWorkflow: true,
      });
      expect(result.action).toBe("install");
      await expect(
        fs.stat(path.join(pipelinesDir, "custom/manifest.json"))
      ).resolves.toBeTruthy();
      await expect(
        fs.stat(path.join(pipelinesDir, "custom/workflow"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("copies every declared descriptor file and a local workflow to its exact target", async () => {
    const pipelineId = "custom-local";
    const cloneDir = path.join(tempDir, "clone");
    const descriptorDir = path.join(
      cloneDir,
      `.seqdesk/pipelines/${pipelineId}`
    );
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(
      path.join(descriptorDir, "manifest.json"),
      JSON.stringify(
        {
          manifestVersion: 1,
          package: {
            id: pipelineId,
            name: "Custom Local Pipeline",
            version: "1.0.0",
            description: "Generic local package",
          },
          files: {
            definition: "descriptors/definition.json",
            registry: "descriptors/registry.json",
            samplesheet: "config/samplesheet.yaml",
            readme: "docs/README.md",
            parsers: ["parsers/results.yaml"],
            scripts: {
              samplesheet: "scripts/make-samplesheet.js",
              discoverOutputs: "scripts/discover-outputs.js",
            },
          },
          inputs: [],
          execution: {
            type: "nextflow",
            pipeline: "./pipeline-code",
            version: "main",
            profiles: ["conda"],
            defaultParams: {},
          },
          outputs: [],
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(descriptorDir, "descriptors/definition.json"),
      buildValidDefinition(pipelineId)
    );
    await writeFile(
      path.join(descriptorDir, "descriptors/registry.json"),
      buildValidRegistry(pipelineId)
    );
    await writeFile(
      path.join(descriptorDir, "config/samplesheet.yaml"),
      validSamplesheet
    );
    await writeFile(
      path.join(descriptorDir, "docs/README.md"),
      "# Custom local pipeline\n"
    );
    await writeFile(
      path.join(descriptorDir, "parsers/results.yaml"),
      [
        "parser:",
        "  id: results_parser",
        "  type: tsv",
        "  description: Test parser",
        "  trigger:",
        '    filePattern: "results/*.tsv"',
        "  skipHeader: true",
        "  columns:",
        "    - name: sample",
        "      index: 0",
        "",
      ].join("\n")
    );
    await writeFile(
      path.join(descriptorDir, "scripts/make-samplesheet.js"),
      "export default function makeSamplesheet() {}\n"
    );
    await writeFile(
      path.join(descriptorDir, "scripts/discover-outputs.js"),
      "export default function discoverOutputs() {}\n"
    );
    await writeFile(path.join(cloneDir, "main.nf"), "workflow {}\n");
    await writeFile(
      path.join(cloneDir, "modules/example.nf"),
      "process EXAMPLE {}\n"
    );

    const pipelinesDir = path.join(tempDir, "shared-pipelines");
    process.env.SEQDESK_PIPELINES_DIR = pipelinesDir;

    const result = await installGitHubPipelineSnapshot({
      pipelineId,
      cloneDir,
      repo: "example/custom-local",
      ref: "main",
    });

    expect(result.action).toBe("install");
    const installedDir = path.join(pipelinesDir, pipelineId);
    await expect(
      fs.readFile(path.join(installedDir, "pipeline-code/main.nf"), "utf8")
    ).resolves.toBe("workflow {}\n");
    await expect(
      fs.readFile(
        path.join(installedDir, "pipeline-code/modules/example.nf"),
        "utf8"
      )
    ).resolves.toBe("process EXAMPLE {}\n");
    await expect(
      fs.readFile(
        path.join(installedDir, "descriptors/definition.json"),
        "utf8"
      )
    ).resolves.toContain(`"pipeline":"${pipelineId}"`);
    await expect(
      fs.readFile(path.join(installedDir, "descriptors/registry.json"), "utf8")
    ).resolves.toContain(`"id":"${pipelineId}"`);
    await expect(
      fs.readFile(path.join(installedDir, "config/samplesheet.yaml"), "utf8")
    ).resolves.toBe(validSamplesheet);
    await expect(
      fs.readFile(path.join(installedDir, "docs/README.md"), "utf8")
    ).resolves.toBe("# Custom local pipeline\n");
    await expect(
      fs.readFile(path.join(installedDir, "parsers/results.yaml"), "utf8")
    ).resolves.toContain("id: results_parser");
    await expect(
      fs.readFile(
        path.join(installedDir, "scripts/make-samplesheet.js"),
        "utf8"
      )
    ).resolves.toContain("makeSamplesheet");
    await expect(
      fs.readFile(
        path.join(installedDir, "scripts/discover-outputs.js"),
        "utf8"
      )
    ).resolves.toContain("discoverOutputs");
    await expect(
      fs.stat(path.join(installedDir, "workflow"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("installs a local Nextflow file entrypoint as a file, not a directory", async () => {
    const pipelineId = "custom-file";
    const cloneDir = path.join(tempDir, "clone-file");
    const descriptorDir = path.join(
      cloneDir,
      `.seqdesk/pipelines/${pipelineId}`
    );
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(
      path.join(descriptorDir, "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        package: {
          id: pipelineId,
          name: "Custom File Pipeline",
          version: "1.0.0",
          description: "Generic local file package",
        },
        files: {
          definition: "definition.json",
          registry: "registry.json",
          samplesheet: "samplesheet.yaml",
          parsers: [],
        },
        inputs: [],
        execution: {
          type: "nextflow",
          pipeline: "./main.nf",
          version: "main",
          profiles: ["conda"],
          defaultParams: {},
        },
        outputs: [],
      })
    );
    await writeFile(
      path.join(descriptorDir, "definition.json"),
      buildValidDefinition(pipelineId)
    );
    await writeFile(
      path.join(descriptorDir, "registry.json"),
      buildValidRegistry(pipelineId)
    );
    await writeFile(
      path.join(descriptorDir, "samplesheet.yaml"),
      validSamplesheet
    );
    await writeFile(path.join(cloneDir, "main.nf"), "workflow {}\n");
    await writeFile(
      path.join(cloneDir, "modules/example.nf"),
      "process EXAMPLE {}\n"
    );

    const pipelinesDir = path.join(tempDir, "shared-pipelines");
    process.env.SEQDESK_PIPELINES_DIR = pipelinesDir;

    const result = await installGitHubPipelineSnapshot({
      pipelineId,
      cloneDir,
      repo: "example/custom-file",
      ref: "main",
    });

    expect(result.action).toBe("install");
    const installedDir = path.join(pipelinesDir, pipelineId);
    await expect(
      fs.readFile(path.join(installedDir, "main.nf"), "utf8")
    ).resolves.toBe("workflow {}\n");
    await expect(
      fs.readFile(path.join(installedDir, "modules/example.nf"), "utf8")
    ).resolves.toBe("process EXAMPLE {}\n");
    expect(
      (await fs.stat(path.join(installedDir, "main.nf"))).isFile()
    ).toBe(true);
  });

  it("rejects declared descriptor files outside the descriptor directory", async () => {
    const descriptorDir = path.join(tempDir, ".seqdesk/pipelines/custom");
    await fs.mkdir(descriptorDir, { recursive: true });
    await writeFile(
      path.join(descriptorDir, "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        package: {
          id: "custom",
          name: "Custom",
          version: "1.0.0",
          description: "Custom package",
        },
        files: {
          definition: "../definition.json",
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
      })
    );
    await writeFile(
      path.join(tempDir, ".seqdesk/pipelines/definition.json"),
      buildValidDefinition("custom")
    );
    await writeFile(
      path.join(descriptorDir, "registry.json"),
      buildValidRegistry("custom")
    );
    await writeFile(
      path.join(descriptorDir, "samplesheet.yaml"),
      validSamplesheet
    );

    const result = await validatePipelineDescriptorDir(
      descriptorDir,
      "custom"
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Invalid files.definition outside allowed directory: ../definition.json"
    );
  });

  it("rejects descriptor paths that escape the cloned repository", async () => {
    const cloneDir = path.join(tempDir, "clone");
    const outsideDescriptorDir = path.join(tempDir, "outside");
    await fs.mkdir(cloneDir, { recursive: true });
    await fs.mkdir(outsideDescriptorDir, { recursive: true });
    await writeFile(
      path.join(outsideDescriptorDir, "manifest.json"),
      buildValidManifest()
    );
    await writeFile(
      path.join(outsideDescriptorDir, "definition.json"),
      buildValidDefinition("metaxpath")
    );
    await writeFile(
      path.join(outsideDescriptorDir, "registry.json"),
      buildValidRegistry("metaxpath")
    );
    await writeFile(
      path.join(outsideDescriptorDir, "samplesheet.yaml"),
      validSamplesheet
    );

    await expect(
      installGitHubPipelineSnapshot({
        pipelineId: "metaxpath",
        cloneDir,
        repo: "example/metaxpath",
        ref: "main",
        descriptorPath: "../outside",
      })
    ).rejects.toThrow("Invalid descriptor path outside allowed directory");
  });
});
