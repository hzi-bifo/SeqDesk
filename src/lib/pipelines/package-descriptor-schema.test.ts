import { describe, expect, it } from "vitest";
import {
  DefinitionRuntimeSchema,
  ParserRuntimeSchema,
  RegistryRuntimeSchema,
  SamplesheetRuntimeSchema,
} from "./package-descriptor-schema";

const validDefinition = {
  pipeline: "demo",
  name: "Demo",
  description: "Demo pipeline",
  version: "1.0.0",
  steps: [],
  inputs: [],
  outputs: [],
};

const validRegistry = {
  id: "demo",
  name: "Demo",
  description: "Demo pipeline",
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
};

describe("package descriptor runtime schemas", () => {
  it("rejects malformed definition collections and entries", () => {
    expect(
      DefinitionRuntimeSchema.safeParse({
        ...validDefinition,
        steps: [null],
      }).success
    ).toBe(false);
    expect(
      DefinitionRuntimeSchema.safeParse({
        ...validDefinition,
        inputs: {},
      }).success
    ).toBe(false);
    expect(
      DefinitionRuntimeSchema.safeParse({
        ...validDefinition,
        outputs: [{ id: "report", name: "Report" }],
      }).success
    ).toBe(false);
  });

  it("rejects malformed registry outputs", () => {
    expect(
      RegistryRuntimeSchema.safeParse({
        ...validRegistry,
        outputs: [null],
      }).success
    ).toBe(false);
  });

  it("rejects configuration properties that the settings UI cannot render", () => {
    expect(
      RegistryRuntimeSchema.safeParse({
        ...validRegistry,
        configSchema: {
          type: "object",
          properties: {
            broken: null,
          },
        },
      }).success
    ).toBe(false);
  });

  it("validates required configuration keys against declared properties", () => {
    expect(
      RegistryRuntimeSchema.safeParse({
        ...validRegistry,
        configSchema: {
          type: "object",
          required: ["databasePath"],
          properties: {
            databasePath: {
              type: "string",
              title: "Database path",
            },
          },
        },
      }).success
    ).toBe(true);

    expect(
      RegistryRuntimeSchema.safeParse({
        ...validRegistry,
        configSchema: {
          type: "object",
          required: ["missingPath"],
          properties: {},
        },
      }).success
    ).toBe(false);
  });

  it("rejects read modes that the runtime cannot interpret", () => {
    expect(
      RegistryRuntimeSchema.safeParse({
        ...validRegistry,
        input: {
          ...validRegistry.input,
          perSample: {
            reads: true,
            pairedEnd: false,
            readMode: "single_only",
          },
        },
      }).success
    ).toBe(false);
  });

  it("rejects registry entries that cannot be started in any scope", () => {
    expect(
      RegistryRuntimeSchema.safeParse({
        ...validRegistry,
        input: {
          ...validRegistry.input,
          supportedScopes: [],
        },
      }).success
    ).toBe(false);
  });

  it("requires the parser fields used by the parser runtime", () => {
    expect(
      ParserRuntimeSchema.safeParse({
        parser: {
          id: "incomplete",
          type: "tsv",
        },
      }).success
    ).toBe(false);
    expect(
      ParserRuntimeSchema.safeParse({
        parser: {
          id: "complete",
          type: "tsv",
          description: "Complete parser",
          trigger: { filePattern: "results/*.tsv" },
          columns: [{ name: "sample", index: 0 }],
        },
      }).success
    ).toBe(true);
  });

  it("rejects parser patterns outside the run output directory", () => {
    expect(
      ParserRuntimeSchema.safeParse({
        parser: {
          id: "escaping",
          type: "tsv",
          description: "Escaping parser",
          trigger: { filePattern: "../secrets/*.tsv" },
          columns: [{ name: "sample", index: 0 }],
        },
      }).success
    ).toBe(false);
  });

  it("validates the samplesheet fields consumed by the generator", () => {
    expect(
      SamplesheetRuntimeSchema.safeParse({
        samplesheet: {
          format: "csv",
          filename: "samples.csv",
          rows: { scope: "sample" },
          columns: [{ name: "sample", source: 42 }],
        },
      }).success
    ).toBe(false);
    expect(
      SamplesheetRuntimeSchema.safeParse({
        samplesheet: {
          format: "csv",
          filename: "samples.csv",
          rows: { scope: "sample" },
          columns: [{ name: "sample", source: "sample.sampleId" }],
        },
      }).success
    ).toBe(true);
  });

  it.each(["read.file3", "sample.typo", "sample.reads[other].file1"])(
    "rejects unsupported samplesheet source %s",
    (source) => {
      expect(
        SamplesheetRuntimeSchema.safeParse({
          samplesheet: {
            format: "csv",
            filename: "samples.csv",
            rows: { scope: "sample" },
            columns: [{ name: "sample", source }],
          },
        }).success
      ).toBe(false);
    }
  );

  it("rejects row scopes the samplesheet generator does not implement", () => {
    expect(
      SamplesheetRuntimeSchema.safeParse({
        samplesheet: {
          format: "csv",
          filename: "studies.csv",
          rows: { scope: "study" },
          columns: [{ name: "study", source: "study.id" }],
        },
      }).success
    ).toBe(false);
  });

  it.each([
    { type: "map_value", strict: true },
    { type: "prepend_path" },
  ])("rejects incomplete samplesheet transform $type", (transform) => {
    expect(
      SamplesheetRuntimeSchema.safeParse({
        samplesheet: {
          format: "csv",
          filename: "samples.csv",
          rows: { scope: "sample" },
          columns: [
            {
              name: "sample",
              source: "sample.sampleId",
              transform,
            },
          ],
        },
      }).success
    ).toBe(false);
  });

  it.each(["../samples.tsv", ".", "./.", "nested/"])(
    "rejects invalid samplesheet filename %s",
    (filename) => {
      expect(
        SamplesheetRuntimeSchema.safeParse({
          samplesheet: {
            format: "tsv",
            filename,
            rows: { scope: "sample" },
            columns: [{ name: "sample", source: "sample.sampleId" }],
          },
        }).success
      ).toBe(false);
    }
  );

  it("accepts complete definition and registry descriptors", () => {
    expect(DefinitionRuntimeSchema.safeParse(validDefinition).success).toBe(true);
    expect(RegistryRuntimeSchema.safeParse(validRegistry).success).toBe(true);
  });
});
