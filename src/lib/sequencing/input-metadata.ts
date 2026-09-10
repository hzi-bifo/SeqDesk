import { resolveOrderSequencingTechnology } from "@/lib/pipelines/order-platform";
import type { SequencingTechnology } from "@/types/sequencing-technology";
import type { SampleSequencingTechnology } from "./types";

export function parseSequencingMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseSequencingMetadata(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readLayout(value: unknown): "single" | "paired" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[ _-]+/g, "");
  if (["single", "singleend", "se"].includes(normalized)) return "single";
  if (["paired", "pairedend", "pe"].includes(normalized)) return "paired";
  return undefined;
}

function explicitLayout(metadata: Record<string, unknown>) {
  for (const key of ["readLayout", "read_layout", "libraryLayout", "library_layout", "library layout"]) {
    const layout = readLayout(metadata[key]);
    if (layout) return layout;
  }
  // The sequencing technology chooser stores concrete cycle choices (e.g. 2x150).
  for (const key of ["read_length", "readLength"]) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    if (/^2\s*[x×]\s*\d+(?:\s*bp)?$/i.test(value.trim())) return "paired";
    if (/^1\s*[x×]\s*\d+(?:\s*bp)?$/i.test(value.trim())) return "single";
  }
  return undefined;
}

function readLengthClass(value: unknown): SampleSequencingTechnology["readLengthClass"] {
  return value === "short" || value === "long" || value === "both" || value === "unknown"
    ? value
    : undefined;
}

/** Never infer single-end data from the absence of an R2 file. */
export function resolveSampleSequencingTechnology(args: {
  orderCustomFields?: unknown;
  sampleCustomFields?: unknown;
  sampleChecklistData?: unknown;
  technologies?: ReadonlyMap<string, SequencingTechnology>;
}): SampleSequencingTechnology | null {
  const orderFields = parseSequencingMetadata(args.orderCustomFields);
  const sampleFields = parseSequencingMetadata(args.sampleCustomFields);
  const selection =
    resolveOrderSequencingTechnology({ customFields: sampleFields }) ??
    resolveOrderSequencingTechnology({ customFields: orderFields });
  const technologyId = selection?.technologyId.trim();
  const technology = technologyId ? args.technologies?.get(technologyId) : undefined;
  const platformFamily = typeof selection?.platformFamily === "string" && selection.platformFamily.trim()
    ? selection.platformFamily.trim()
    : technology?.platformFamily;
  const length = readLengthClass(selection?.readLengthClass) ?? readLengthClass(technology?.readLengthClass);
  const supportedLayouts = selection?.supportedReadLayouts ?? technology?.supportedReadLayouts;
  const layout =
    explicitLayout(parseSequencingMetadata(args.sampleChecklistData)) ??
    explicitLayout(sampleFields) ??
    explicitLayout(selection ?? {}) ??
    explicitLayout(orderFields) ??
    (supportedLayouts?.length === 1 ? readLayout(supportedLayouts[0]) : undefined);

  const result: SampleSequencingTechnology = {
    ...(technologyId ? { technologyId } : {}),
    ...(platformFamily ? { platformFamily } : {}),
    ...(length ? { readLengthClass: length } : {}),
    ...(layout ? { readLayout: layout } : {}),
  };
  return Object.keys(result).length ? result : null;
}
