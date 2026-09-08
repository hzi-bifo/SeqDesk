import { z } from "zod";
import { EXPLORE_ROLES } from "../types";

const RoleSchema = z.enum(EXPLORE_ROLES as unknown as [string, ...string[]]);

export const KitInputSchema = z
  .object({
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
    description: z.string().max(500).optional(),
  })
  .strict();

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
    citation: z.string().max(4000).optional(),
    tags: z.array(z.string().min(1).max(40)).default([]),
    provider: z.string().max(120).optional(),
    version: z.string().max(40).optional(),
  })
  .strict();

export type KitManifest = z.infer<typeof KitSchema>;
export type KitInput = z.infer<typeof KitInputSchema>;
