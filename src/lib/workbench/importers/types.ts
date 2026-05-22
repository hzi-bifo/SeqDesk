import type { z } from "zod";
import type { WorkbenchImportStoragePaths } from "@/lib/workbench/storage";

export type WorkbenchImportJobStatus = "queued" | "running" | "success" | "error" | "cancelled";

export interface WorkbenchImporterPreflight {
  ok: boolean;
  message?: string;
  details?: string;
}

export interface WorkbenchGenomePreviewItem {
  accession: string;
  organismName?: string;
  taxId?: number;
  assemblyName?: string;
  assemblyLevel?: string;
  sourceDatabase?: string;
  representativeCategory?: string;
  totalSequenceLength?: number;
}

export interface WorkbenchImportPreview {
  providerId: string;
  summary: {
    label: string;
    requestedTaxon?: string;
    totalFound: number;
    selectedCount: number;
    capped: boolean;
    cap: number;
    hardMax: number;
  };
  genomes: WorkbenchGenomePreviewItem[];
  warnings?: string[];
}

export interface WorkbenchImportResult {
  cacheKey: string;
  name: string;
  description?: string;
  sourceType: string;
  sourceMetadata: unknown;
  storagePath: string;
  sizeBytes?: number;
  checksumSha256?: string;
  genomeCount?: number;
}

export interface WorkbenchImportStartContext<TInput> {
  jobId: string;
  workspaceId: string;
  userId: string;
  input: TInput;
  preview: WorkbenchImportPreview;
  cacheKey: string;
  storage: WorkbenchImportStoragePaths;
  update: (update: {
    status?: WorkbenchImportJobStatus;
    phase?: string | null;
    progress?: number | null;
    targetPath?: string | null;
    error?: string | null;
  }) => Promise<void>;
  log: (line: string) => Promise<void>;
}

export interface WorkbenchImporterProvider<TInput = unknown> {
  id: string;
  label: string;
  description: string;
  category: string;
  inputSchema: z.ZodType<TInput>;
  preflight(): Promise<WorkbenchImporterPreflight>;
  preview(input: TInput): Promise<WorkbenchImportPreview>;
  getCacheKey(input: TInput, preview: WorkbenchImportPreview): string;
  start(context: WorkbenchImportStartContext<TInput>): Promise<WorkbenchImportResult>;
  cancel?(jobId: string): Promise<void>;
}
