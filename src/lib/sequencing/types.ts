import type {
  FacilitySampleStatus,
  ReadDataClass,
  ReadDataClassSource,
  ReadOrigin,
  SequencingArtifactStage,
  SequencingArtifactType,
  SequencingIntegrityStatus,
} from "./constants";

export interface SequencingRunSummary {
  id: string;
  runId: string;
  runName: string | null;
}

export type SequencingPlannedBarcodeSource = "run-plan" | "sample-barcode" | null;

export interface SequencingTechSelectionSummary {
  id: string | null;
  name: string | null;
  label: string | null;
  platform: string | null;
}

export interface SequencingReadSummary {
  id: string;
  file1: string | null;
  file2: string | null;
  checksum1: string | null;
  checksum2: string | null;
  readCount1: number | null;
  readCount2: number | null;
  avgQuality1?: number | null;
  avgQuality2?: number | null;
  fileSize1: number | null;
  fileSize2: number | null;
  fastqcReport1: string | null;
  fastqcReport2: string | null;
  pipelineRunId: string | null;
  pipelineRunNumber: string | null;
  pipelineSources: Record<string, string> | null;
  dataClass: ReadDataClass;
  dataClassLabel: string;
  dataClassSource: ReadDataClassSource;
  readOrigin: ReadOrigin;
  readOriginLabel: string;
  isSimulated: boolean;
  isProtectedRaw: boolean;
  isActive: boolean;
  supersededByReadId: string | null;
  classifiedAt: string | null;
  classifiedById: string | null;
  classificationNote: string | null;
  /** True when linked read files no longer exist on disk */
  filesMissing: boolean;
}

export interface SequencingArtifactSummary {
  id: string;
  orderId: string;
  sampleId: string | null;
  sequencingRunId: string | null;
  stage: SequencingArtifactStage | string;
  artifactType: SequencingArtifactType | string;
  source: string;
  visibility: string;
  path: string;
  originalName: string;
  size: number | null;
  checksum: string | null;
  mimeType: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SequencingDeliveryFileSummary {
  id: string;
  kind: "read" | "artifact";
  label: string;
  path: string;
  fileName: string;
  sampleId: string | null;
  sampleCode: string | null;
  sampleTitle: string | null;
  size: number | null;
  checksum: string | null;
  readId?: string;
  readDirection?: "R1" | "R2";
  readCount?: number | null;
  artifactId?: string;
  stage?: string;
  artifactType?: string;
}

export interface SequencingDeliverySummary {
  orderId: string;
  orderName: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  publishedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  dataBasePathConfigured: boolean;
  readFiles: SequencingDeliveryFileSummary[];
  artifactFiles: SequencingDeliveryFileSummary[];
  excluded: {
    missingCleanedReadFiles: number;
    rawOrUnknownReadFiles: number;
    missingCustomerArtifacts: number;
    unsupportedCustomerArtifacts: number;
    facilityArtifacts: number;
  };
}

export interface SequencingSampleRow {
  id: string;
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  facilityStatus: FacilitySampleStatus | string;
  facilityStatusUpdatedAt: string | null;
  updatedAt: string;
  read: SequencingReadSummary | null;
  integrityStatus: SequencingIntegrityStatus;
  hasReads: boolean;
  protectedProvenanceCount: number;
  protectedProvenance: SequencingReadSummary[];
  plannedBarcode?: string | null;
  plannedBarcodeSource?: SequencingPlannedBarcodeSource;
  plannedBarcodeRunId?: string | null;
  sequencingRun: SequencingRunSummary | null;
  artifactCount: number;
  qcArtifactCount: number;
  latestArtifactStage: string | null;
  artifacts: SequencingArtifactSummary[];
  /**
   * Aggregated stats over any FASTQ files this sample has ingested via the
   * MinKNOW stream watcher. Null when no stream has ever touched this sample.
   * `activeRunId` is set while an ACTIVE stream is still writing — the UI uses
   * it to show a live "streaming" badge.
   */
  stream: {
    fileCount: number;
    totalReads: number;
    totalBases: number;
    lastFileAt: string | null;
    activeRunId: string | null;
  } | null;
}

export interface SequencingStatusCounts {
  WAITING: number;
  PROCESSING: number;
  SEQUENCED: number;
  QC_REVIEW: number;
  READY: number;
  ISSUE: number;
}

export interface OrderSequencingSummaryResponse {
  orderId: string;
  orderName: string | null;
  orderStatus: string;
  canManage: boolean;
  dataBasePathConfigured: boolean;
  config: {
    allowedExtensions: string[];
    allowSingleEnd: boolean;
  };
  sequencingTechSelection?: SequencingTechSelectionSummary | null;
  summary: {
    totalSamples: number;
    readsLinkedSamples: number;
    qcArtifactSamples: number;
    missingChecksumSamples: number;
    orderArtifactCount: number;
    statusCounts: SequencingStatusCounts;
  };
  samples: SequencingSampleRow[];
  orderArtifacts: SequencingArtifactSummary[];
}

export interface SequencingDiscoveryAlternative {
  identifier: string;
  read1: {
    relativePath: string;
    filename: string;
  };
  read2: {
    relativePath: string;
    filename: string;
  } | null;
}

export interface SequencingDiscoverySuggestion {
  status: "exact" | "partial" | "ambiguous" | "none";
  read1: {
    relativePath: string;
    filename: string;
  } | null;
  read2: {
    relativePath: string;
    filename: string;
  } | null;
  confidence: number;
  alternatives: SequencingDiscoveryAlternative[];
  matchedBy?: "run-plan-barcode" | "sample-barcode" | "sample-id" | null;
}

export interface SequencingDiscoveryScanWarnings {
  inaccessibleDirectories: Array<{ relativePath: string; error: string }>;
  ignoredEntries: number;
  truncated: boolean;
  activeWritesSkipped: number;
  skippedRecentFiles: Array<{ relativePath: string; modifiedAt: string }>;
  maxFiles: number | null;
  maxDepth: number;
}

export interface SequencingDiscoveryResult {
  sampleId: string;
  sampleAlias: string | null;
  plannedBarcode?: string | null;
  plannedBarcodeSource?: SequencingPlannedBarcodeSource;
  plannedBarcodeRunId?: string | null;
  suggestion: SequencingDiscoverySuggestion;
  autoAssigned: boolean;
  dataClass?: ReadDataClass;
  dataClassLabel?: string;
  isProtectedRaw?: boolean;
}

export interface SequencingChecksumSummary {
  updatedReads: number;
  updatedArtifacts: number;
  failed: number;
  skippedMissingFiles: number;
}
