import { z } from "zod";
import {
  PACKAGE_TARGET_TYPES,
  PIPELINE_RESULT_KINDS,
  PIPELINE_WRITEBACK_POLICIES,
  READ_WRITEBACK_FIELDS,
} from "./package-contracts";
import {
  isSafePackageRuntimePattern,
  isSafePipelineFlagToken,
} from "./package-patterns";

export const PackageScope = z.enum(["sample", "study", "order", "run"]);
export const PackageTargetType = z.enum(PACKAGE_TARGET_TYPES);

export const StandardDestination = z.enum([
  "sample_reads",
  "sample_assemblies",
  "sample_bins",
  "sample_annotations",
  "sample_qc",
  "sample_metadata",
  "study_report",
  "order_report",
  "order_files",
  "run_artifact",
  "download_only",
]);

export const OutputType = z.enum([
  "assembly",
  "bin",
  "report",
  "qc",
  "artifact",
]);

const ReadWritebackField = z.enum(READ_WRITEBACK_FIELDS);
const PipelineResultKind = z.enum(PIPELINE_RESULT_KINDS);
const PipelineWritebackPolicy = z.enum(PIPELINE_WRITEBACK_POLICIES);
const RuntimePattern = z
  .string()
  .min(1)
  .refine(isSafePackageRuntimePattern, {
    message: "Pattern must stay inside the pipeline output directory",
  });
const PipelineFlagToken = z.string().refine(isSafePipelineFlagToken, {
  message: "Flag must be a single safe command-line token",
});
const ParamMapFlag = z.string().refine(
  (value) => value === "" || isSafePipelineFlagToken(value),
  {
    message: "Mapping must be empty or a single safe command-line flag",
  }
);
const RuntimeEnvironmentName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, {
    message: "Environment variable name must be a valid shell identifier",
  });
const NextflowPipelineReference = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      const normalized = value.replace(/\\/g, "/");
      const explicitLocalReference =
        normalized === "." ||
        normalized === ".." ||
        normalized.startsWith("./") ||
        normalized.startsWith("../") ||
        normalized.startsWith("/") ||
        /^[A-Za-z]:\//.test(normalized);
      return explicitLocalReference || !normalized.toLowerCase().endsWith(".nf");
    },
    {
      message:
        'Local Nextflow entrypoint files must use an explicit path such as "./workflow/main.nf"',
    }
  );

const PipelineResultContractSchema = z
  .object({
    kind: PipelineResultKind,
    writebackPolicy: PipelineWritebackPolicy.optional(),
    preview: z
      .object({
        label: z.string().min(1).optional(),
        primary: z.boolean().optional(),
        previewable: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const PipelineSampleResultValueSchema = z
  .object({
    label: z.string().min(1).optional(),
    path: z.string().regex(/^[a-zA-Z0-9_.]+$/),
    whenPathExists: z.string().regex(/^[a-zA-Z0-9_.]+$/).optional(),
    format: z.enum(["text", "hash_prefix", "filename"]).optional(),
    truncate: z.number().int().min(1).max(64).optional(),
    previewable: z.boolean().optional(),
  })
  .strict();

export const ManifestSchema = z
  .object({
    manifestVersion: z.number().int().min(1),
    package: z
      .object({
        id: z
          .string()
          .min(1)
          .max(128)
          .regex(
            /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
            "Package ID must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens"
          ),
        name: z.string().min(1),
        version: z.string().min(1),
        description: z.string().min(1),
        website: z.string().optional(),
        provider: z.string().optional(),
      })
      .strict(),
    files: z
      .object({
        definition: z.string().min(1),
        registry: z.string().min(1),
        samplesheet: z.string().min(1),
        parsers: z.array(z.string()).optional(),
        readme: z.string().optional(),
        scripts: z
          .object({
            samplesheet: z.string().optional(),
            discoverOutputs: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    targets: z
      .object({
        supported: z.array(PackageTargetType).min(1),
      })
      .strict()
      .optional(),
    sequencingCompatibility: z
      .object({
        readLengthClass: z.enum(["short", "long", "both", "unknown"]).optional(),
        readLayouts: z.array(z.enum(["single", "paired"])).optional(),
        platformFamilies: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    inputs: z.array(
      z
        .object({
          id: z.string().min(1),
          scope: PackageScope,
          source: z.string().min(1),
          required: z.boolean(),
          filters: z.record(z.string(), z.unknown()).optional(),
          transform: z
            .object({
              type: z.string().min(1),
              mapping: z.record(z.string(), z.string()).optional(),
            })
            .passthrough()
            .optional(),
        })
        .strict()
    ),
    execution: z
      .object({
        type: z.literal("nextflow"),
        pipeline: NextflowPipelineReference,
        version: z.string().min(1),
        profiles: z.array(z.string()),
        defaultParams: z.record(z.string(), z.unknown()),
        priorRunArtifacts: z
          .object({
            scope: z.literal("study"),
            configKey: z
              .string()
              .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
            sources: z
              .record(z.string().min(1), z.array(z.string().min(1)).min(1))
              .refine(
                (sources) => Object.keys(sources).length > 0,
                "At least one prior-run artifact source is required"
              ),
          })
          .strict()
          .optional(),
        runtime: z
          .object({
            allowMacOsArmConda: z.boolean().optional(),
            allowMacOsArmLocal: z.boolean().optional(),
            env: z.record(RuntimeEnvironmentName, z.string()).optional(),
          })
          .strict()
          .optional(),
        paramMap: z.record(z.string(), ParamMapFlag).optional(),
        paramRules: z
          .array(
            z
              .object({
                when: z.record(z.string(), z.unknown()),
                add: z.array(
                  z.union([
                    PipelineFlagToken,
                    z
                      .object({
                        flag: PipelineFlagToken,
                        value: z.unknown(),
                      })
                      .strict(),
                  ])
                ),
              })
              .strict()
          )
          .optional(),
      })
      .passthrough(),
    outputs: z.array(
      z
        .object({
          id: z.string().min(1),
          scope: PackageScope,
          required: z.boolean().optional(),
          destination: StandardDestination,
          type: OutputType.optional(),
          fromStep: z.string().min(1).optional(),
          discovery: z
            .object({
              pattern: RuntimePattern,
              fallbackPattern: RuntimePattern.optional(),
              matchSampleBy: z.enum(["filename", "parent_dir", "path"]).optional(),
              dependsOn: z.string().min(1).optional(),
            })
            .strict(),
          parsed: z
            .object({
              from: z.string().min(1),
              matchBy: z.string().min(1),
              map: z.record(z.string(), z.string()),
            })
            .strict()
            .optional(),
          result: PipelineResultContractSchema.optional(),
          // Declares that this output is a delimited table Explore can turn
          // into a dataset. `roles` maps Explore column roles to column names.
          table: z
            .object({
              tableKind: z.string().min(1),
              format: z.enum(["tsv", "csv"]).optional(),
              sampleColumn: z.string().min(1).optional(),
              roles: z.record(z.string().min(1), z.string().min(1)).optional(),
              skipLinesStartingWith: z.string().min(1).optional(),
            })
            .strict()
            .optional(),
          writeback: z
            .object({
              target: z.literal("Read"),
              mode: z.enum(["merge", "replace"]).optional(),
              fields: z.record(z.string().min(1), ReadWritebackField),
            })
            .strict()
            .optional(),
        })
        .strict()
    ),
    schema_requirements: z
      .object({
        tables: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
    ui: z
      .object({
        sampleResult: z
          .object({
            columnLabel: z.string().min(1),
            emptyText: z.string().min(1).optional(),
            layout: z.enum(["stack", "columns"]).optional(),
            values: z.array(PipelineSampleResultValueSchema).min(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
