import { z } from "zod";

/** Shared, declarative data contracts. Safe to import in browsers; never loads a package or file. */
export const DataColumnTypeSchema = z.enum(["string", "number", "boolean", "date", "json"]);
export const DataColumnSchema = z.object({
  type: DataColumnTypeSchema,
  label: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  unit: z.string().min(1).max(80).optional(),
  /** Required column presence; nullable controls its values separately. */
  required: z.boolean().optional(),
  nullable: z.boolean().optional(),
}).strict();

export const TableContractSchema = z.object({
  schemaId: z.string().min(1).max(160).optional(),
  schemaVersion: z.string().min(1).max(80).optional(),
  /** Open vocabulary: sample, read-mate, taxon, variant, run, … */
  rowEntity: z.string().min(1).max(120).optional(),
  columns: z.record(z.string().min(1).max(200), DataColumnSchema).optional(),
}).strict();
export type TableContract = z.infer<typeof TableContractSchema>;

export const ColumnRequirementSchema = z.object({
  type: DataColumnTypeSchema,
  unit: z.string().min(1).max(80).optional(),
}).strict();
export const InputRequirementsSchema = z.object({
  requiredColumns: z.record(z.string().min(1).max(200), ColumnRequirementSchema).optional(),
  /** Match semantic roles when a template does not depend on literal column names. */
  requiredRoleTypes: z.record(z.string().min(1).max(80), ColumnRequirementSchema).optional(),
  schemaId: z.string().min(1).max(160).optional(),
  schemaVersions: z.array(z.string().min(1).max(80)).min(1).optional(),
  rowEntity: z.string().min(1).max(120).optional(),
}).strict();
export type InputRequirements = z.infer<typeof InputRequirementsSchema>;
