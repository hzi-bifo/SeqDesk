import type { SequencingSampleRow } from "@/lib/sequencing/types";
import type {
  PipelineSampleResult,
  PipelineSampleResultValue,
} from "./types";

export interface SampleResultPreviewItem {
  label?: string;
  value: string;
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

  if (format === "hash_prefix") {
    const truncate = descriptor.truncate ?? 8;
    if (text.length > truncate) {
      text = `${text.slice(0, truncate)}...`;
    }
  } else if (descriptor.truncate && text.length > descriptor.truncate) {
    text = `${text.slice(0, descriptor.truncate)}...`;
  }

  return text;
}

export function getSampleResultPreview(
  sample: SequencingSampleRow,
  config: PipelineSampleResult | null | undefined,
): SampleResultPreview | null {
  if (!config) {
    return null;
  }

  const items = config.values
    .filter((descriptor) => {
      if (!descriptor.whenPathExists) {
        return true;
      }

      return hasDisplayValue(getValueAtPath(sample, descriptor.whenPathExists));
    })
    .map<SampleResultPreviewItem | null>((descriptor) => {
      const formatted = formatPreviewValue(
        getValueAtPath(sample, descriptor.path),
        descriptor,
      );

      if (!formatted) {
        return null;
      }

      return descriptor.label
        ? {
            label: descriptor.label,
            value: formatted,
          }
        : {
            value: formatted,
          };
    })
    .filter((item): item is SampleResultPreviewItem => item !== null);

  return {
    columnLabel: config.columnLabel,
    emptyText: config.emptyText ?? "No result yet",
    items,
  };
}
