import { z } from "zod";

const Identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);
const ConfigKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,119}$/)
  .refine(key => !["__proto__", "prototype", "constructor"].includes(key));
const Bytes = z.number().int().positive().max(1024 ** 4);
const PublicHttpsUrl = z.string().url().refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.hash && (!url.port || url.port === "443") &&
      !/^(localhost|127\.|\[|\d+\.)/i.test(url.hostname);
  } catch { return false; }
}, "Resources require a credential-free public HTTPS URL on port 443");

/** Declarative data only. No downloaded scripts, shell snippets or pickle loading. */
export const PipelineResourceSchema = z.object({
  id: Identifier,
  label: z.string().min(1),
  description: z.string().optional(),
  version: Identifier,
  type: z.literal("archive-set"),
  assets: z.array(z.object({
    fileName: Identifier,
    url: PublicHttpsUrl,
    bytes: Bytes,
    format: z.enum(["tar", "tar.gz"]),
    checksum: z.object({
      algorithm: z.enum(["sha256", "md5"]),
      value: z.string().regex(/^[a-fA-F0-9]+$/),
    }).strict().refine(value => value.value.length === (value.algorithm === "sha256" ? 64 : 32), "Invalid checksum length"),
  }).strict()).min(1).max(16),
  // Exact root-level filenames only; no archive paths are materialized.
  requiredFiles: z.array(Identifier).min(1).max(128),
  /** Optional publisher-observed sizes also reject partial linked installations. */
  fileSizes: z.record(Identifier, Bytes).optional(),
  maxExtractedBytes: Bytes,
  config: z.object({
    pathKey: ConfigKey,
    values: z.record(ConfigKey, z.union([z.string(), z.number(), z.boolean()])).default({}),
  }).strict(),
}).strict().superRefine((resource, context) => {
  if (Object.keys(resource.fileSizes ?? {}).some(file => !resource.requiredFiles.includes(file))) {
    context.addIssue({ code: 'custom', path: ['fileSizes'], message: 'File sizes must reference required files' });
  }
  if (Object.values(resource.fileSizes ?? {}).reduce((sum, bytes) => sum + bytes, 0) > resource.maxExtractedBytes) {
    context.addIssue({ code: 'custom', path: ['fileSizes'], message: 'Required files exceed the extraction bound' });
  }
  for (const [key, values] of [
    ["assets", resource.assets.map(asset => asset.fileName)],
    ["requiredFiles", resource.requiredFiles],
  ] as const) {
    if (new Set(values.map(value => value.toLowerCase())).size !== values.length) {
      context.addIssue({ code: "custom", path: [key], message: "Resource filenames must be unique" });
    }
  }
  if (resource.requiredFiles.some(file => file.startsWith(".seqdesk-"))) {
    context.addIssue({ code: "custom", path: ["requiredFiles"], message: "Reserved resource filename" });
  }
  if (Object.hasOwn(resource.config.values, resource.config.pathKey)) {
    context.addIssue({ code: "custom", path: ["config"], message: "Path binding cannot be overwritten by config values" });
  }
});

export type PipelineResource = z.infer<typeof PipelineResourceSchema>;
