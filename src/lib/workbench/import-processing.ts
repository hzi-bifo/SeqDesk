import { z } from "zod";
export const processingStateSchema = z.enum(["unknown", "unprocessed", "cleaned"]);
export const processingDeclarationSchema = z.object({ state: processingStateSchema, details: z.string().trim().min(1).max(2000) }).strict();
export type ProcessingDeclaration = z.infer<typeof processingDeclarationSchema>;
export interface SourceProcessing { state: z.infer<typeof processingStateSchema>; evidence: "repository_metadata" | "module_documentation" | "not_provided"; details: string }
export const processingLabels = { unknown: "Processing unknown", unprocessed: "Unprocessed reads", cleaned: "Cleaned / filtered reads" };
export function sourceProcessing(_providerId: string): SourceProcessing {
  // Safe fallback only. Dataset-specific evidence belongs to the adapter.
  return { state: "unknown", evidence: "not_provided", details: "The import module did not establish processing history. Original repository metadata is retained." };
}
export function resolveImportProcessing(source: SourceProcessing, declaration: ProcessingDeclaration | undefined, userId: string) {
  const parsed = processingDeclarationSchema.optional().parse(declaration);
  return { source, effectiveState: parsed?.state ?? source.state,
    ...(parsed ? { userDeclaration: { ...parsed, userId, recordedAt: new Date().toISOString() } } : {}) };
}
