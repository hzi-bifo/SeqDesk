import type { SequencingReadSummary } from "./types";

export interface FastqcMetricItem {
  label: string;
  value: number;
}

export function formatAvgQuality(value?: number | null): string {
  if (value == null) return "-";
  return value.toFixed(1);
}

export function getSequencingReportSummary(artifactCount: number): string {
  if (artifactCount === 0) {
    return "No reports";
  }
  if (artifactCount === 1) {
    return "1 report";
  }
  return `${artifactCount} reports`;
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
