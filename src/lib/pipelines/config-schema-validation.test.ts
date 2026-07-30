import { describe, expect, it } from "vitest";

import { validatePipelineConfigSchema } from "./config-schema-validation";
import type { PipelineConfigSchema } from "./types";

const schema: PipelineConfigSchema = {
  type: "object",
  required: ["name", "replicates", "flags"],
  properties: {
    name: {
      type: "string",
      title: "Display name",
    },
    ratio: {
      type: "number",
      title: "Sample ratio",
      minimum: 0,
      maximum: 1,
    },
    replicates: {
      type: "integer",
      title: "Replicate count",
      minimum: 1,
      maximum: 10,
    },
    enabled: {
      type: "boolean",
      title: "Enable filtering",
    },
    flags: {
      type: "array",
      title: "Selected flags",
    },
    mode: {
      type: "string",
      title: "Execution mode",
      enum: ["safe", "fast"],
    },
  },
};

describe("validatePipelineConfigSchema", () => {
  it("accepts supported values and ignores undeclared properties", () => {
    expect(
      validatePipelineConfigSchema(schema, {
        name: "Example",
        ratio: 0.5,
        replicates: 2,
        enabled: false,
        flags: ["trim"],
        mode: "safe",
        installedByNewerSeqDesk: { enabled: true },
      })
    ).toEqual({
      missingFields: [],
      requiredIssues: [],
      valueIssues: [],
      issues: [],
    });
  });

  it("reports required fields by title without duplicate type errors", () => {
    expect(
      validatePipelineConfigSchema(schema, {
        name: "   ",
        replicates: null,
        flags: [],
      })
    ).toEqual({
      missingFields: ["Display name", "Replicate count", "Selected flags"],
      requiredIssues: [
        "Display name is required.",
        "Replicate count is required.",
        "Selected flags is required.",
      ],
      valueIssues: [],
      issues: [
        "Display name is required.",
        "Replicate count is required.",
        "Selected flags is required.",
      ],
    });
  });

  it("validates string, number, integer, boolean, and array types", () => {
    const result = validatePipelineConfigSchema(schema, {
      name: 42,
      ratio: "0.5",
      replicates: 1.5,
      enabled: "true",
      flags: "trim",
    });

    expect(result.valueIssues).toEqual([
      "Display name must be a string.",
      "Sample ratio must be a number.",
      "Replicate count must be an integer.",
      "Enable filtering must be true or false.",
      "Selected flags must be an array.",
    ]);
  });

  it("validates enum membership and numeric minimum/maximum", () => {
    const belowMinimum = validatePipelineConfigSchema(schema, {
      name: "Example",
      ratio: -0.1,
      replicates: 11,
      flags: ["trim"],
      mode: "turbo",
    });

    expect(belowMinimum.valueIssues).toEqual([
      "Sample ratio must be at least 0.",
      "Replicate count must be at most 10.",
      "Execution mode must be one of: safe, fast.",
    ]);
  });

  it("treats null as unset for optional descriptor values", () => {
    const result = validatePipelineConfigSchema(schema, {
      name: "Example",
      ratio: null,
      replicates: 1,
      flags: ["trim"],
      mode: null,
    });

    expect(result.issues).toEqual([]);
  });
});
