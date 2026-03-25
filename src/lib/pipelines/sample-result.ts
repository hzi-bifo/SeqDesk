import type { SequencingSampleRow } from "@/lib/sequencing/types";
import type {
  PipelineSampleResult,
  PipelineSampleResultValue,
} from "./types";

export interface SampleResultPreviewItem {
  label?: string;
  value: string;
  /** Absolute path to the file for preview — only set when previewable */
  previewPath?: string;
}

export interface SampleResultPreview {
  columnLabel: string;
  emptyText: string;
  items: SampleResultPreviewItem[];
}

function getValueAtPath(
  sample: SequencingSampleRow,
  path: string,
): unknown {
  return path
    .split(".")
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      return (current as Record<string, unknown>)[segment];
    }, sample);
}

function hasDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return typeof value === "number" || typeof value === "boolean";
}

function formatPreviewValue(
  value: unknown,
  descriptor: PipelineSampleResultValue,
): string | null {
  if (!hasDisplayValue(value)) {
    return null;
  }

  let text = typeof value === "string" ? value.trim() : String(value);
  const format = descriptor.format ?? "text";

  if (format === "filename") {
    // Extract just the filename from a path
    const lastSlash = text.lastIndexOf("/");
    if (lastSlash >= 0) {
      text = text.slice(lastSlash + 1);
    }

    // Compress common FastQC report names for table display.
    const fastqcSuffixMatch = text.match(/(?:^|_)(R[12])_fastqc\.html$/i);
    if (fastqcSuffixMatch) {
      text = `${fastqcSuffixMatch[1].toUpperCase()} report`;
    }
  } else if (format === "hash_prefix") {
    const truncate = descriptor.truncate ?? 8;
    if (text.length > truncate) {
      text = `${text.slice(0, truncate)}...`;
    }
  } else if (descriptor.truncate && text.length > descriptor.truncate) {
    text = `${text.slice(0, descriptor.truncate)}...`;
  }

  return text;
}

function shouldIncludeDescriptor(
  sample: SequencingSampleRow,
  descriptor: PipelineSampleResultValue,
): boolean {
  if (!descriptor.whenPathExists) {
    return true;
  }

  return hasDisplayValue(getValueAtPath(sample, descriptor.whenPathExists));
}

export function getSampleResultPreviewItem(
  sample: SequencingSampleRow,
  descriptor: PipelineSampleResultValue,
): SampleResultPreviewItem | null {
  if (!shouldIncludeDescriptor(sample, descriptor)) {
    return null;
  }

  const rawValue = getValueAtPath(sample, descriptor.path);
  const formatted = formatPreviewValue(rawValue, descriptor);

  if (!formatted) {
    return null;
  }

  const item: SampleResultPreviewItem = { value: formatted };
  if (descriptor.label) item.label = descriptor.label;
  if (descriptor.previewable && typeof rawValue === "string" && rawValue.trim()) {
    item.previewPath = rawValue.trim();
  }
  return item;
}

export function getSampleResultPreview(
  sample: SequencingSampleRow,
  config: PipelineSampleResult | null | undefined,
): SampleResultPreview | null {
  if (!config) {
    return null;
  }

  const items = config.values
    .map<SampleResultPreviewItem | null>((descriptor) =>
      getSampleResultPreviewItem(sample, descriptor)
    )
    .filter((item): item is SampleResultPreviewItem => item !== null);

  return {
    columnLabel: config.columnLabel,
    emptyText: config.emptyText ?? "No result yet",
    items,
  };
}
