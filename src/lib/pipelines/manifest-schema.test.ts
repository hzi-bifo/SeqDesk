import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { ManifestSchema } from "./manifest-schema";

const baseManifest = {
  manifestVersion: 1,
  package: {
    id: "test",
    name: "Test Pipeline",
    version: "1.0.0",
    description: "Integration test pipeline",
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
    pipeline: "test",
    version: "1.0.0",
    profiles: ["conda"],
    defaultParams: {},
  },
  outputs: [],
};

describe("manifest-schema", () => {
  it("accepts a complete minimal manifest", () => {
    const result = ManifestSchema.safeParse(baseManifest);

    expect(result.success).toBe(true);
    expect(result.data!.manifestVersion).toBe(1);
    expect(result.data!.files.parsers).toEqual([]);
  });

  it.each(["../outside", "/absolute", "_leading-underscore"])(
    "rejects unsafe package ID %s",
    (id) => {
      const result = ManifestSchema.safeParse({
        ...baseManifest,
        package: {
          ...baseManifest.package,
          id,
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(["package", "id"]);
    }
  );

  it.each(["Uppercase", "legacy_id", "two--hyphens", "trailing-", "vendor.pipe"])(
    "keeps path-safe legacy package ID %s compatible",
    (id) => {
      const result = ManifestSchema.safeParse({
        ...baseManifest,
        package: {
          ...baseManifest.package,
          id,
        },
      });

      expect(result.success).toBe(true);
    }
  );

  it("rejects manifestVersion outside allowed range", () => {
    const badManifest = {
      ...baseManifest,
      manifestVersion: 0,
    };

    const result = ManifestSchema.safeParse(badManifest);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["manifestVersion"]);
  });

  it("rejects runtime environment names that the executor would ignore", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      execution: {
        ...baseManifest.execution,
        runtime: {
          env: {
            "NXF-FOO": "enabled",
          },
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual([
      "execution",
      "runtime",
      "env",
      "NXF-FOO",
    ]);
  });

  it("accepts a declarative same-study prior-run artifact contract", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      execution: {
        ...baseManifest.execution,
        priorRunArtifacts: {
          scope: "study",
          configKey: "qcDir",
          sources: {
            fastqc: ["sample_qc_data"],
            nanoplot: ["sample_stats"],
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data!.execution.priorRunArtifacts?.configKey).toBe("qcDir");
  });

  it.each([
    {
      scope: "order",
      configKey: "qcDir",
      sources: { fastqc: ["sample_qc_data"] },
    },
    {
      scope: "study",
      configKey: "../qcDir",
      sources: { fastqc: ["sample_qc_data"] },
    },
    {
      scope: "study",
      configKey: "qcDir",
      sources: {},
    },
  ])("rejects an unsafe prior-run artifact contract %#", (priorRunArtifacts) => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      execution: {
        ...baseManifest.execution,
        priorRunArtifacts,
      },
    });

    expect(result.success).toBe(false);
  });

  it.each(["   ", "workflow/main.nf"])(
    "rejects ambiguous execution pipeline reference %j",
    (pipeline) => {
      const result = ManifestSchema.safeParse({
        ...baseManifest,
        execution: {
          ...baseManifest.execution,
          pipeline,
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual([
        "execution",
        "pipeline",
      ]);
    }
  );

  it("accepts an explicit local Nextflow file entrypoint", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      execution: {
        ...baseManifest.execution,
        pipeline: "./workflow/main.nf",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects unsupported output destinations", () => {
    const badManifest = {
      ...baseManifest,
      outputs: [
        {
          id: "out",
          scope: "sample",
          destination: "bad_destination",
          discovery: {
            pattern: "*.txt",
          },
        },
      ],
    };

    const result = ManifestSchema.safeParse(badManifest);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["outputs", 0, "destination"]);
  });

  it("accepts an output explicitly declared optional", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      outputs: [
        {
          id: "conditional_report",
          scope: "sample",
          required: false,
          destination: "run_artifact",
          discovery: {
            pattern: "reports/*.html",
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data!.outputs[0].required).toBe(false);
  });

  it.each(["../outside/*.txt", "/etc/*.txt", "C:\\outside\\*.txt"])(
    "rejects output discovery outside the run directory: %s",
    (pattern) => {
      const result = ManifestSchema.safeParse({
        ...baseManifest,
        outputs: [
          {
            id: "escaping",
            scope: "run",
            destination: "run_artifact",
            discovery: { pattern },
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual([
        "outputs",
        0,
        "discovery",
        "pattern",
      ]);
    }
  );

  it.each([
    {
      paramMap: { threads: "--threads; false #" },
    },
    {
      paramRules: [
        {
          when: { enabled: true },
          add: ["--enabled; false #"],
        },
      ],
    },
    {
      paramRules: [
        {
          when: { enabled: true },
          add: [{ flag: "--enabled $(false)", value: true }],
        },
      ],
    },
  ])("rejects unsafe execution flags %#", (executionOverride) => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      execution: {
        ...baseManifest.execution,
        ...executionOverride,
      },
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["read-cleaning", "removed_reads"],
    ["kraken2-bracken", "krona_html"],
  ])(
    "accepts the built-in %s optional output declaration",
    (pipelineId, outputId) => {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "../../../pipelines", pipelineId, "manifest.json"),
          "utf8"
        )
      );

      const result = ManifestSchema.safeParse(manifest);

      expect(result.success).toBe(true);
      expect(
        result.data!.outputs.find(
          (output: { id: string }) => output.id === outputId
        )?.required
      ).toBe(false);
    }
  );

  it("rejects unknown top-level keys when strict mode is enabled", () => {
    const badManifest = {
      ...baseManifest,
      unknownRoot: "nope",
    } as unknown;

    const result = ManifestSchema.safeParse(badManifest);

    expect(result.success).toBe(false);
    const unknownKeyIssue = result.error?.issues.find(
      (entry) => entry.code === "unrecognized_keys"
    ) as { keys: string[] } | undefined;
    expect(unknownKeyIssue?.keys).toContain("unknownRoot");
  });

  it("accepts optional runtime compatibility flags for execution", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      execution: {
        ...baseManifest.execution,
        runtime: {
          allowMacOsArmConda: true,
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data!.execution.runtime?.allowMacOsArmConda).toBe(true);
  });

  it("accepts manifest targets and Read writeback contracts", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      targets: {
        supported: ["order"],
      },
      outputs: [
        {
          id: "sample_reads",
          scope: "sample",
          destination: "sample_reads",
          discovery: {
            pattern: "*.json",
          },
          writeback: {
            target: "Read",
            mode: "merge",
            fields: {
              checksum1: "checksum1",
              avgQuality1: "avgQuality1",
            },
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data!.targets?.supported).toEqual(["order"]);
    expect(result.data!.outputs[0].writeback?.fields).toEqual({
      checksum1: "checksum1",
      avgQuality1: "avgQuality1",
    });
  });

  it("accepts explicit result contracts for staged read candidates", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      outputs: [
        {
          id: "cleaned_read_candidates",
          scope: "sample",
          destination: "run_artifact",
          type: "artifact",
          discovery: {
            pattern: "filter/filtered/*_filtered.fastq.gz",
            matchSampleBy: "filename",
          },
          result: {
            kind: "sample_read_candidate",
            writebackPolicy: "admin_review",
            preview: {
              label: "Cleaned reads",
              previewable: false,
            },
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data!.outputs[0].result).toEqual({
      kind: "sample_read_candidate",
      writebackPolicy: "admin_review",
      preview: {
        label: "Cleaned reads",
        previewable: false,
      },
    });
  });

  it("rejects unsupported Read writeback fields", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      outputs: [
        {
          id: "sample_reads",
          scope: "sample",
          destination: "sample_reads",
          discovery: {
            pattern: "*.json",
          },
          writeback: {
            target: "Read",
            fields: {
              checksum1: "notAReadField",
            },
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual([
      "outputs",
      0,
      "writeback",
      "fields",
      "checksum1",
    ]);
  });

  it("accepts manifest-defined sample result previews", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      ui: {
        sampleResult: {
          columnLabel: "Checksums",
          emptyText: "Not computed",
          layout: "columns",
          values: [
            {
              label: "R1",
              path: "read.checksum1",
              whenPathExists: "read.file1",
              format: "hash_prefix",
              truncate: 8,
            },
            {
              label: "R2",
              path: "read.checksum2",
              whenPathExists: "read.file2",
              format: "hash_prefix",
              truncate: 8,
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data!.ui?.sampleResult?.columnLabel).toBe("Checksums");
    expect(result.data!.ui?.sampleResult?.layout).toBe("columns");
    expect(result.data!.ui?.sampleResult?.values).toHaveLength(2);
  });

  it("accepts filename format in sample result previews", () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      ui: {
        sampleResult: {
          columnLabel: "QC Reports",
          emptyText: "Not generated",
          values: [
            {
              label: "R1",
              path: "read.fastqcReport1",
              whenPathExists: "read.file1",
              format: "filename",
            },
            {
              label: "R2",
              path: "read.fastqcReport2",
              whenPathExists: "read.file2",
              format: "filename",
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.data!.ui?.sampleResult?.columnLabel).toBe("QC Reports");
    expect(result.data!.ui?.sampleResult?.values[0].format).toBe("filename");
  });
});
