import type {
  FacilitySampleStatus,
  SequencingArtifactStage,
  SequencingArtifactType,
  SequencingIntegrityStatus,
} from "./constants";

export interface SequencingRunSummary {
  id: string;
  runId: string;
  runName: string | null;
}

export interface SequencingReadSummary {
  id: string;
  file1: string | null;
  file2: string | null;
  checksum1: string | null;
  checksum2: string | null;
  readCount1: number | null;
  readCount2: number | null;
  fileSize1: number | null;
  fileSize2: number | null;
  fastqcReport1: string | null;
  fastqcReport2: string | null;
  pipelineRunId: string | null;
  pipelineRunNumber: string | null;
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
  sequencingRun: SequencingRunSummary | null;
  artifactCount: number;
  qcArtifactCount: number;
  latestArtifactStage: string | null;
  artifacts: SequencingArtifactSummary[];
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
}

export interface SequencingDiscoveryResult {
  sampleId: string;
  sampleAlias: string | null;
  suggestion: SequencingDiscoverySuggestion;
  autoAssigned: boolean;
}

export interface SequencingChecksumSummary {
  updatedReads: number;
  updatedArtifacts: number;
  failed: number;
  skippedMissingFiles: number;
}
