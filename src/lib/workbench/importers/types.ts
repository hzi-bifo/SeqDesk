import type { z } from "zod";
import type { WorkbenchImportStoragePaths } from "@/lib/workbench/storage";
import type { ImportCollection } from "../import-collection";

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

export interface WorkbenchFilePreviewItem {
  sourceRecord?: Record<string, string | undefined>;
  runAccession: string;
  sampleAccession?: string;
  studyAccession?: string;
  scientificName?: string;
  instrumentPlatform?: string;
  instrumentModel?: string;
  libraryLayout?: string;
  url: string;
  filename: string;
  md5?: string;
  bytes?: number;
}

export interface WorkbenchImportPreview {
  processing?: import("../import-processing").SourceProcessing;
  contractVersion?: number;
  sampleMetadata?: Record<string, unknown>;
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
  assets?: { url: string; filename: string; bytes: number; etag: string; role: string }[];
  files?: WorkbenchFilePreviewItem[];
  warnings?: string[];
}

export interface WorkbenchImportResult {
  processingDeclaration?: import("../import-processing").ProcessingDeclaration;
  collection?: ImportCollection;
  scientificImports?: NonNullable<WorkbenchImportResult["scientificImport"]>[];
  scientificImport?: {
    processing?: import("../import-processing").SourceProcessing;
    targetStudyId?: string;
    synthetic: boolean;
    metadata?: Record<string, unknown>;
    studyKey: string; studyTitle: string; sampleKey: string; sampleTitle: string;
    technology: "short" | "long" | "single";
    readKey?: string;
    reads: { path: string; sha256: string; md5?: string; bytes: number; records?: number }[];
  };
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
  signal?: AbortSignal;
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
