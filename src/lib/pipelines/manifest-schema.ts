import { z } from "zod";

export const PackageScope = z.enum(["sample", "study", "order", "run"]);

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
        id: z.string().min(1),
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
        pipeline: z.string().min(1),
        version: z.string().min(1),
        profiles: z.array(z.string()),
        defaultParams: z.record(z.string(), z.unknown()),
        runtime: z
          .object({
            allowMacOsArmConda: z.boolean().optional(),
            allowMacOsArmLocal: z.boolean().optional(),
          })
          .strict()
          .optional(),
        paramMap: z.record(z.string(), z.string()).optional(),
        paramRules: z
          .array(
            z
              .object({
                when: z.record(z.string(), z.unknown()),
                add: z.array(
                  z.union([
                    z.string(),
                    z
                      .object({
                        flag: z.string().min(1),
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
          destination: StandardDestination,
          type: OutputType.optional(),
          fromStep: z.string().min(1).optional(),
          discovery: z
            .object({
              pattern: z.string().min(1),
              fallbackPattern: z.string().optional(),
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
