import { SEQUENCING_ARTIFACT_STAGE_LABELS } from "./constants";
import type { SequencingReadSummary, SequencingSampleRow } from "./types";

export interface FastqcMetricItem {
  label: string;
  value: number;
}

export function formatAvgQuality(value?: number | null): string {
  if (value == null) return "-";
  return value.toFixed(1);
}

export function getSequencingReportCount(
  sample: Pick<SequencingSampleRow, "artifacts" | "read">,
): number {
  const reportPaths = new Set<string>();

  for (const artifact of sample.artifacts) {
    if (artifact.path) {
      reportPaths.add(artifact.path);
    }
  }

  if (sample.read?.fastqcReport1) {
    reportPaths.add(sample.read.fastqcReport1);
  }

  if (sample.read?.fastqcReport2) {
    reportPaths.add(sample.read.fastqcReport2);
  }

  return reportPaths.size;
}

export function hasSequencingReports(
  sample: Pick<SequencingSampleRow, "artifacts" | "read">,
): boolean {
  return getSequencingReportCount(sample) > 0;
}

export function getSequencingReportSummary(
  sample: Pick<SequencingSampleRow, "artifacts" | "read">,
): string {
  const reportCount = getSequencingReportCount(sample);
  if (reportCount === 0) {
    return "No reports";
  }
  if (reportCount === 1) {
    return "1 report";
  }
  return `${reportCount} reports`;
}

export function getSequencingReportStageLabel(
  sample: Pick<SequencingSampleRow, "latestArtifactStage" | "read">,
): string | null {
  if (sample.latestArtifactStage) {
    return SEQUENCING_ARTIFACT_STAGE_LABELS[
      sample.latestArtifactStage as keyof typeof SEQUENCING_ARTIFACT_STAGE_LABELS
    ] ?? sample.latestArtifactStage;
  }

  if (sample.read?.fastqcReport1 || sample.read?.fastqcReport2) {
    return "FastQC";
  }

  return null;
}

export function getFastqcMetricItems(
  read: SequencingReadSummary | null | undefined,
): FastqcMetricItem[] {
  if (!read) {
    return [];
  }

  return [
    { label: "R1 Q", value: read.avgQuality1 },
    { label: "R2 Q", value: read.avgQuality2 },
  ].filter((metric): metric is FastqcMetricItem => metric.value != null);
}
