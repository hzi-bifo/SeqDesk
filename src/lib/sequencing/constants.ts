export const FILES_ASSIGNABLE_STATUSES = ["SUBMITTED", "COMPLETED"] as const;

export const FACILITY_SAMPLE_STATUSES = [
  "WAITING",
  "PROCESSING",
  "SEQUENCED",
  "QC_REVIEW",
  "READY",
  "ISSUE",
] as const;

export type FacilitySampleStatus = (typeof FACILITY_SAMPLE_STATUSES)[number];

export const FACILITY_SAMPLE_STATUS_LABELS: Record<FacilitySampleStatus, string> = {
  WAITING: "Waiting",
  PROCESSING: "Processing",
  SEQUENCED: "Sequenced",
  QC_REVIEW: "QC Review",
  READY: "Ready",
  ISSUE: "Issue",
};

export const FACILITY_SAMPLE_STATUS_BADGE_CLASSNAMES: Record<FacilitySampleStatus, string> = {
  WAITING: "border-slate-200 bg-slate-50 text-slate-700",
  PROCESSING: "border-blue-200 bg-blue-50 text-blue-700",
  SEQUENCED: "border-indigo-200 bg-indigo-50 text-indigo-700",
  QC_REVIEW: "border-amber-200 bg-amber-50 text-amber-700",
  READY: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ISSUE: "border-rose-200 bg-rose-50 text-rose-700",
};

export const SEQUENCING_ARTIFACT_STAGES = [
  "sample_receipt",
  "sequencing",
  "raw_reads",
  "qc",
  "delivery",
] as const;

export type SequencingArtifactStage = (typeof SEQUENCING_ARTIFACT_STAGES)[number];

export const SEQUENCING_ARTIFACT_STAGE_LABELS: Record<SequencingArtifactStage, string> = {
  sample_receipt: "Sample Receipt",
  sequencing: "Sequencing",
  raw_reads: "Raw Reads",
  qc: "QC",
  delivery: "Delivery",
};

export const SEQUENCING_ARTIFACT_TYPES = [
  "qc_report",
  "multiqc_report",
  "demux_stats",
  "sample_sheet",
  "delivery_report",
  "attachment",
] as const;

export type SequencingArtifactType = (typeof SEQUENCING_ARTIFACT_TYPES)[number];

export const SEQUENCING_ARTIFACT_TYPE_LABELS: Record<SequencingArtifactType, string> = {
  qc_report: "QC Report",
  multiqc_report: "MultiQC Report",
  demux_stats: "Demux Stats",
  sample_sheet: "Sample Sheet",
  delivery_report: "Delivery Report",
  attachment: "Attachment",
};

export const SEQUENCING_UPLOAD_STATUSES = [
  "PENDING",
  "UPLOADING",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
] as const;

export type SequencingUploadStatus = (typeof SEQUENCING_UPLOAD_STATUSES)[number];

export type SequencingIntegrityStatus = "empty" | "missing" | "partial" | "complete";

export interface SequencingReadIntegrityInput {
  file1?: string | null;
  file2?: string | null;
  checksum1?: string | null;
  checksum2?: string | null;
}

export function isFacilitySampleStatus(value: string): value is FacilitySampleStatus {
  return FACILITY_SAMPLE_STATUSES.includes(value as FacilitySampleStatus);
}

export function getSequencingIntegrityStatus(
  input: SequencingReadIntegrityInput
): SequencingIntegrityStatus {
  const linkedFiles = [input.file1, input.file2].filter(Boolean).length;
  if (linkedFiles === 0) {
    return "empty";
  }

  const checksums = [
    input.file1 ? input.checksum1 : null,
    input.file2 ? input.checksum2 : null,
  ].filter((value) => value !== null);
  const presentChecksums = checksums.filter(Boolean).length;

  if (presentChecksums === 0) {
    return "missing";
  }

  if (presentChecksums < linkedFiles) {
    return "partial";
  }

  return "complete";
}

export function getSequencingIntegrityLabel(status: SequencingIntegrityStatus): string {
  switch (status) {
    case "complete":
      return "All linked files have checksums";
    case "partial":
      return "Some linked files have checksums";
    case "missing":
      return "Linked files are missing checksums";
    default:
      return "No linked files";
  }
}

export function getSequencingIntegrityIndicatorClassName(
  status: SequencingIntegrityStatus
): string {
  switch (status) {
    case "complete":
      return "bg-emerald-500";
    case "partial":
      return "bg-amber-500";
    case "missing":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}
