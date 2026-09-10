/** Shared wire types for the order Files UI. Keep this module client-safe. */
export type OrderDataFileRole = "R1" | "R2" | "single";
export type OrderDataFilesProcessing = "unknown" | "unprocessed" | "cleaned";

export interface OrderDataFile {
  path: string;
  name: string;
  role?: OrderDataFileRole | null;
  exists: boolean;
  size: number | null;
  checksum?: string | null;
}

export interface OrderDataFilesSample {
  id: string;
  sampleId: string;
  sampleTitle: string | null;
}

export interface OrderDataFileReadSet {
  id: string;
  sampleId: string;
  sampleIdentifier: string;
  sampleTitle: string | null;
  files: OrderDataFile[];
  source: string;
  processing: string;
  isActive: boolean;
  supersededByReadId?: string | null;
  runAccessionNumber: string | null;
  metadata: Record<string, unknown>;
}

export interface OrderDataFilesArtifact {
  id: string;
  sampleId: string | null;
  stage: string;
  type: string;
  source: string;
  file: OrderDataFile;
}

export interface OrderDataFilesStream {
  id: string;
  status: string;
  startedAt: string | null;
  files: { id: string; sampleId: string | null; barcode: string | null; file: OrderDataFile }[];
}

export interface OrderDataFilesInventory {
  order: {
    id: string;
    name: string | null;
    dataOrigin: string;
    status: string;
    collectionKey?: string | null;
  };
  canManage: boolean;
  canManageFacility: boolean;
  sequencingSourceEnabled?: boolean;
  storageConfigured: boolean;
  uploadLimitBytes?: number;
  samples: OrderDataFilesSample[];
  readSets: OrderDataFileReadSet[];
  artifacts: OrderDataFilesArtifact[];
  streams: OrderDataFilesStream[];
}

export interface OrderDataFilesStorageEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  size: number | null;
}

export interface OrderDataFilesStorage {
  path: string;
  roots: { path: string; label: string }[];
  entries: OrderDataFilesStorageEntry[];
  truncated: boolean;
}

export interface OrderDataFilesLinkRequest {
  requestId?: string;
  sampleId?: string;
  newSample?: { sampleId: string; sampleTitle?: string };
  read1: string;
  read2?: string;
  processing?: OrderDataFilesProcessing;
  processingNote?: string;
}

export interface OrderDataFilesLinkResult {
  readId: string;
  sampleId: string;
}
