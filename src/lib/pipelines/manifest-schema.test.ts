import { describe, expect, it } from "vitest";

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
    expect(result.data.manifestVersion).toBe(1);
    expect(result.data.files.parsers).toEqual([]);
  });

  it("rejects manifestVersion outside allowed range", () => {
    const badManifest = {
      ...baseManifest,
      manifestVersion: 0,
    };

    const result = ManifestSchema.safeParse(badManifest);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["manifestVersion"]);
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
    expect(result.data.execution.runtime?.allowMacOsArmConda).toBe(true);
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
    expect(result.data.targets?.supported).toEqual(["order"]);
    expect(result.data.outputs[0].writeback?.fields).toEqual({
      checksum1: "checksum1",
      avgQuality1: "avgQuality1",
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
    expect(result.data.ui?.sampleResult?.columnLabel).toBe("Checksums");
    expect(result.data.ui?.sampleResult?.values).toHaveLength(2);
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
    expect(result.data.ui?.sampleResult?.columnLabel).toBe("QC Reports");
    expect(result.data.ui?.sampleResult?.values[0].format).toBe("filename");
  });
});
