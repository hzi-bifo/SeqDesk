import { z } from "zod";
import {
  isSafePackageRuntimeFilePath,
  isSafePackageRuntimePattern,
} from "./package-patterns";

const NonEmptyString = z.string().min(1);
const OptionalString = z.string().optional();
const OptionalStringArray = z.array(z.string()).optional();
const SafeRelativeRuntimePath = NonEmptyString.refine(
  isSafePackageRuntimePattern,
  {
    message: "Path must stay inside its pipeline runtime directory",
  }
);
const RuntimePattern = SafeRelativeRuntimePath;
const SafeRelativeRuntimeFilePath = NonEmptyString.refine(
  isSafePackageRuntimeFilePath,
  {
    message: "File path must stay inside its pipeline runtime directory",
  }
);

export const DefinitionStepRuntimeSchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
    description: NonEmptyString,
    category: NonEmptyString,
    dependsOn: z.array(z.string()),
    processMatchers: OptionalStringArray,
    tools: OptionalStringArray,
    outputs: OptionalStringArray,
    docs: OptionalString,
    parameters: OptionalStringArray,
  })
  .passthrough();

export const DefinitionInputRuntimeSchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
    description: OptionalString,
    fileTypes: OptionalStringArray,
    source: OptionalString,
    sourceDescription: OptionalString,
  })
  .passthrough();

export const DefinitionOutputRuntimeSchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
    description: OptionalString,
    fromStep: NonEmptyString,
    fileTypes: OptionalStringArray,
    destination: OptionalString,
    destinationField: OptionalString,
    destinationDescription: OptionalString,
  })
  .passthrough();

const DefinitionParameterRuntimeSchema = z
  .object({
    name: NonEmptyString,
    type: NonEmptyString,
    description: OptionalString,
    default: z.unknown().optional(),
    required: z.boolean().optional(),
    enum: z.array(z.unknown()).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  })
  .passthrough();

const DefinitionParameterGroupRuntimeSchema = z
  .object({
    name: NonEmptyString,
    description: OptionalString,
    parameters: z.array(DefinitionParameterRuntimeSchema),
  })
  .passthrough();

export const DefinitionRuntimeSchema = z
  .object({
    pipeline: NonEmptyString,
    name: NonEmptyString,
    description: NonEmptyString,
    version: NonEmptyString,
    steps: z.array(DefinitionStepRuntimeSchema),
    inputs: z.array(DefinitionInputRuntimeSchema).optional(),
    outputs: z.array(DefinitionOutputRuntimeSchema).optional(),
    parameterGroups: z.array(DefinitionParameterGroupRuntimeSchema).optional(),
  })
  .passthrough();

export const RegistryOutputRuntimeSchema = z
  .object({
    type: z.enum(["data", "metric", "report"]),
    name: NonEmptyString,
    description: NonEmptyString,
    model: OptionalString,
    visibility: z.enum(["admin", "user", "both"]),
    downloadable: z.boolean().optional(),
  })
  .passthrough();

const PipelineConfigPropertyRuntimeSchema = z
  .object({
    type: NonEmptyString,
    title: NonEmptyString,
    description: OptionalString,
    default: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    "x-seqdesk": z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const PipelineConfigRuntimeSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(
      z.string(),
      PipelineConfigPropertyRuntimeSchema
    ),
    required: z.array(z.string().trim().min(1)).optional(),
  })
  .passthrough()
  .superRefine((schema, context) => {
    for (const [index, requiredKey] of (schema.required || []).entries()) {
      if (!Object.prototype.hasOwnProperty.call(schema.properties, requiredKey)) {
        context.addIssue({
          code: "custom",
          path: ["required", index],
          message: `Required configuration key "${requiredKey}" is not declared in properties`,
        });
      }
    }
  });

export const RegistryRuntimeSchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString,
    description: NonEmptyString,
    category: z.enum(["analysis", "submission", "qc"]),
    version: NonEmptyString,
    sortOrder: z.number().optional(),
    website: z.string().optional(),
    requires: z.record(z.string(), z.boolean()),
    outputs: z.array(RegistryOutputRuntimeSchema),
    visibility: z
      .object({
        showToUser: z.boolean(),
        userCanStart: z.boolean(),
      })
      .passthrough(),
    input: z
      .object({
        supportedScopes: z
          .array(z.enum(["study", "order", "samples", "sample"]))
          .min(1),
        minSamples: z.number().int().min(1).optional(),
        perSample: z
          .object({
            reads: z.boolean(),
            pairedEnd: z.boolean(),
            readMode: z
              .enum(["paired_only", "single_or_paired"])
              .optional(),
            assemblies: z.boolean().optional(),
            bins: z.boolean().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
    samplesheet: z
      .object({
        format: NonEmptyString,
        generator: NonEmptyString,
      })
      .passthrough(),
    configSchema: PipelineConfigRuntimeSchema,
    defaultConfig: z.record(z.string(), z.unknown()),
    icon: NonEmptyString,
  })
  .passthrough();

const ParserColumnRuntimeSchema = z
  .object({
    name: NonEmptyString,
    index: z.number().int().nonnegative(),
    type: z.enum(["string", "int", "float", "boolean"]).optional(),
  })
  .passthrough();

export const ParserRuntimeSchema = z
  .object({
    parser: z
      .object({
        id: NonEmptyString,
        type: z.enum(["tsv", "csv", "json"]),
        description: NonEmptyString,
        trigger: z
          .object({
            filePattern: RuntimePattern,
          })
          .passthrough(),
        skipHeader: z.boolean().optional(),
        columns: z.array(ParserColumnRuntimeSchema).min(1),
      })
      .passthrough(),
  })
  .passthrough();

const SamplesheetTransformRuntimeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("map_value"),
      mapping: z.record(z.string(), z.string()),
      strict: z.boolean().optional(),
    })
    .passthrough(),
  z.object({ type: z.literal("to_upper") }).passthrough(),
  z.object({ type: z.literal("to_lower") }).passthrough(),
  z
    .object({
      type: z.literal("prepend_path"),
      base: NonEmptyString,
    })
    .passthrough(),
]);

const SUPPORTED_SAMPLESHEET_SOURCES = new Set([
  "sample.sampleId",
  "study.id",
  "study.title",
  "order.id",
  "order.platform",
  "read.file1",
  "read.file2",
]);

const SamplesheetSourceRuntimeSchema = z.string().refine(
  (source) =>
    SUPPORTED_SAMPLESHEET_SOURCES.has(source) ||
    /^sample\.reads\[(paired|single)\]\.(file1|file2)$/.test(source),
  {
    message: "Unsupported samplesheet source",
  }
);

const SamplesheetColumnRuntimeSchema = z
  .object({
    name: NonEmptyString,
    source: SamplesheetSourceRuntimeSchema.nullable(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.string().optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    transform: SamplesheetTransformRuntimeSchema.optional(),
  })
  .passthrough();

export const SamplesheetRuntimeSchema = z
  .object({
    samplesheet: z
      .object({
        format: z.enum(["csv", "tsv"]),
        filename: SafeRelativeRuntimeFilePath,
        rows: z
          .object({
            scope: z.literal("sample"),
          })
          .passthrough(),
        columns: z.array(SamplesheetColumnRuntimeSchema).min(1),
      })
      .passthrough(),
  })
  .passthrough();
