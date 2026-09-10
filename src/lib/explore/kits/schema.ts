import { z } from "zod";
import { EXPLORE_ROLES, type ExploreRole } from "../types";
import { InputRequirementsSchema } from "../table-contract";

const RoleSchema = z.enum(EXPLORE_ROLES as [ExploreRole, ...ExploreRole[]]);

export const KitInputSchema = InputRequirementsSchema
  .extend({
    alias: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "alias must be a short snake_case identifier"),
    label: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    /** Accept only datasets of this table kind; null accepts any table. */
    tableKind: z.string().min(1).nullable().optional(),
    requiredRoles: z.array(RoleSchema).default([]),
    optionalRoles: z.array(RoleSchema).default([]),
    optional: z.boolean().optional(),
  })
  .strict();

export const KitParamsSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()).default({}),
    required: z.array(z.string()).optional(),
  })
  .passthrough();

export const KitOutputSchema = z
  .object({
    name: z.string().min(1).max(80),
    kind: z.enum(["figure", "table", "report"]),
    label: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional(),
    optional: z.boolean().optional(),
    /** Declarative page hints; no custom renderers or executable UI code. */
    report: z.object({ include: z.boolean().optional(), span: z.union([z.literal(1), z.literal(2)]).optional() }).strict().optional(),
  })
  .strict();

export const KitReportSchema = z.object({
  introduction: z.string().max(4000).optional(),
  metrics: z.array(z.object({
    key: z.string().min(1).max(120),
    label: z.string().min(1).max(80),
    unit: z.string().max(24).optional(),
    digits: z.number().int().min(0).max(6).optional(),
  }).strict()).max(8).optional(),
}).strict();

export const KitSchema = z
  .object({
    kitVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "id must be lowercase letters, digits and dashes"),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    language: z.enum(["python", "r"]),
    environment: z.string().min(1).max(120),
    entrypoint: z.string().min(1).max(120).default("analysis.py"),
    inputs: z.array(KitInputSchema).min(1),
    params: KitParamsSchema.optional(),
    outputs: z.array(KitOutputSchema).default([]),
    report: KitReportSchema.optional(),
    citation: z.string().max(4000).optional(),
    tags: z.array(z.string().min(1).max(40)).default([]),
    provider: z.string().max(120).optional(),
    version: z.string().max(40).optional(),
  })
  .strict();

export type KitManifest = z.infer<typeof KitSchema>;
export type KitInput = z.infer<typeof KitInputSchema>;
