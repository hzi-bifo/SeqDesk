import { isProtectedReadDataClass } from "@/lib/sequencing/constants";
import { selectPipelineInputRead } from "./input-read-selection";
import { pipelineRequiresPairedReads } from "./read-mode";

/** Client-safe input checks. Runtime, databases and run configuration are checked separately. */
export interface PipelineSequencingCompatibility {
  readLengthClass?: "short" | "long" | "both" | "unknown";
  readLayouts?: Array<"single" | "paired">;
  platformFamilies?: string[];
}

export interface PipelineInputRequirements {
  pipelineId?: string;
  input?: {
    minSamples?: number;
    maxSamples?: number;
    perSample?: {
      reads?: boolean;
      pairedEnd?: boolean;
      readMode?: "single_or_paired" | "paired_only";
      assemblies?: boolean;
      bins?: boolean;
    };
  } | null;
  sequencingCompatibility?: PipelineSequencingCompatibility | null;
  inputCompatibilityWarnings?: string[];
  inputSelection?: "standard" | "read-cleaning" | "custom";
  config?: Record<string, unknown>;
}

export interface PipelineCompatibilityRead {
  id?: string;
  file1?: string | null;
  file2?: string | null;
  filesMissing?: boolean | null;
  dataClass?: string | null;
  isActive?: boolean | null;
  isSimulated?: boolean;
  pipelineSources?: string | Record<string, string> | null;
}

export interface PipelineCompatibilitySample {
  read?: PipelineCompatibilityRead | null;
  reads?: PipelineCompatibilityRead[] | null;
  sequencingTechnology?: {
    technologyId?: string;
    platformFamily?: string;
    readLengthClass?: "short" | "long" | "both" | "unknown";
    readLayout?: "single" | "paired";
  } | null;
  preferredAssemblyId?: string | null;
  assemblies?: Array<{ id?: string; assemblyFile?: string | null }> | null;
  bins?: Array<{ binFile?: string | null }> | null;
}

export interface PipelineSampleCompatibility {
  status: "compatible" | "incompatible" | "unknown";
  reason?: string;
}

export interface PipelineInputCompatibility {
  status: PipelineSampleCompatibility["status"] | "partial";
  compatibleSamples: number;
  totalSamples: number;
  summary: string;
  reasons: Array<{ reason: string; count: number }>;
}

const hasText = (value: string | null | undefined) => Boolean(value?.trim());

function hasSimulatedProvenance(read: PipelineCompatibilityRead | null | undefined): boolean {
  if (read?.isSimulated) return true;
  try {
    const sources = typeof read?.pipelineSources === "string" ? JSON.parse(read.pipelineSources) : read?.pipelineSources;
    return Boolean(sources && typeof sources === "object" && Object.hasOwn(sources, "simulate-reads"));
  } catch {
    return false;
  }
}

export function getPipelineSampleCountIssue(pipeline: PipelineInputRequirements | null | undefined, count: number): string | null {
  const min = Math.max(1, pipeline?.input?.minSamples ?? 1);
  const max = pipeline?.input?.maxSamples;
  if (count < min) return `Requires at least ${min} sample${min === 1 ? "" : "s"} per run`;
  if (max && count > max) return `Accepts at most ${max} sample${max === 1 ? "" : "s"} per run`;
  return null;
}

export function assessPipelineSampleCompatibility(
  pipeline: PipelineInputRequirements | null | undefined,
  sample: PipelineCompatibilitySample
): PipelineSampleCompatibility {
  const required = pipeline?.input?.perSample;
  if (!required || typeof required.reads !== "boolean") {
    return { status: "unknown", reason: "Pipeline input requirements are not declared" };
  }
  if (pipeline?.inputSelection === "custom") {
    return { status: "unknown", reason: "Custom pipeline input selection has not been checked" };
  }

  const unknown: string[] = [...(pipeline?.inputCompatibilityWarnings ?? [])];
  const blocked: string[] = [];
  let technology = sample.sequencingTechnology;
  const allowedTechnologies = Array.isArray(pipeline?.config?.allowedSequencingTechnologies)
    ? pipeline.config.allowedSequencingTechnologies.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    : [];
  if (allowedTechnologies.length > 0) {
    if (!technology?.technologyId) unknown.push("Sequencing technology is unknown");
    else if (!allowedTechnologies.includes(technology.technologyId)) {
      blocked.push("Sequencing technology is not allowed by pipeline settings");
    }
  }

  if (required.assemblies) {
    if (!sample.assemblies) unknown.push("Assembly inputs have not been checked");
    else if (sample.preferredAssemblyId && !sample.assemblies.some((assembly) => assembly.id === sample.preferredAssemblyId && hasText(assembly.assemblyFile))) blocked.push("Selected assembly is missing");
    else if (!sample.assemblies.some((assembly) => hasText(assembly.assemblyFile))) blocked.push("Missing assembly");
  }
  if (required.bins) {
    if (!sample.bins) unknown.push("Bin inputs have not been checked");
    else if (!sample.bins.some((bin) => hasText(bin.binFile))) blocked.push("Missing bins");
  }

  if (required.reads) {
    const readCleaning = pipeline?.pipelineId === "read-cleaning";
    const read = sample.reads !== undefined
      ? selectPipelineInputRead(sample.reads ?? [], readCleaning ? { dataClassIn: ["raw", "unknown"] } : undefined)
      : sample.read?.isActive === false ? null : sample.read;
    if (readCleaning && !read && selectPipelineInputRead(sample.reads ?? [])) {
      return { status: "incompatible", reason: "Needs raw or unknown reads" };
    }
    // Generated inputs can use a different mode from the original order. The
    // Read record does not persist that mode; do not mistake planned metadata
    // for the shape of the generated data.
    if (hasSimulatedProvenance(read)) {
      technology = null;
      unknown.push("Generated read layout and length have not been verified");
    }
    if (!hasText(read?.file1)) return { status: "incompatible", reason: "Missing reads" };
    if (readCleaning && !isProtectedReadDataClass(read?.dataClass)) {
      return { status: "incompatible", reason: "Needs raw or unknown reads" };
    }
    const pairedRequired = pipelineRequiresPairedReads({
      reads: true,
      pairedEnd: required.pairedEnd ?? false,
      readMode: required.readMode,
    });
    const hasMate = hasText(read?.file2);
    if ((pairedRequired || technology?.readLayout === "paired") && !hasMate) {
      return { status: "incompatible", reason: "Missing R2 file" };
    }
    if (read?.filesMissing === true) return { status: "incompatible", reason: "Files missing" };
    if (read?.filesMissing !== false) unknown.push("Linked file availability has not been verified");

    // Two associated mates establish paired input. A lone file does not establish
    // single-end input: it may be an incomplete pair. Never guess from filenames.
    const layout = hasMate ? "paired" : technology?.readLayout;
    if (hasMate && technology?.readLayout === "single") {
      unknown.push("Read files and single-end metadata disagree");
    } else if (!layout) {
      unknown.push("Single-end or paired-end layout is unknown");
    }

    const compatibility = pipeline?.sequencingCompatibility;
    if (!compatibility) {
      unknown.push("Pipeline sequencing compatibility is not declared");
    } else {
      const length = compatibility.readLengthClass;
      if (!length || length === "unknown") {
        unknown.push("Pipeline read-length requirements are not declared");
      } else if (length !== "both") {
        if (!technology?.readLengthClass || technology.readLengthClass === "unknown" || technology.readLengthClass === "both") {
          unknown.push("Short-read or long-read metadata is unknown");
        } else if (technology.readLengthClass !== length) {
          blocked.push(`Requires ${length} reads; available data is ${technology.readLengthClass}-read`);
        }
      }
      if (compatibility.readLayouts?.length && layout && !compatibility.readLayouts.includes(layout)) {
        blocked.push(`Requires ${compatibility.readLayouts.join(" or ")}-end reads`);
      }
      if (compatibility.platformFamilies?.length) {
        if (!technology?.platformFamily || technology.platformFamily === "other") unknown.push("Sequencing platform is unknown");
        else if (!compatibility.platformFamilies.includes(technology.platformFamily)) {
          blocked.push(`Sequencing platform ${technology.platformFamily} is not supported`);
        }
      }
    }
  }

  if (blocked.length) return { status: "incompatible", reason: blocked.join("; ") };
  if (unknown.length) return { status: "unknown", reason: unknown.join("; ") };
  return { status: "compatible" };
}

export function assessPipelineInputCompatibility(
  pipeline: PipelineInputRequirements | null | undefined,
  samples: PipelineCompatibilitySample[] | null
): PipelineInputCompatibility {
  if (samples === null) {
    return { status: "unknown", compatibleSamples: 0, totalSamples: 0, summary: "Input compatibility could not be checked", reasons: [] };
  }
  if (!samples.length) {
    return { status: "incompatible", compatibleSamples: 0, totalSamples: 0, summary: "No samples available", reasons: [] };
  }
  const results = samples.map((sample) => assessPipelineSampleCompatibility(pipeline, sample));
  const compatibleSamples = results.filter((result) => result.status === "compatible").length;
  const unknownSamples = results.filter((result) => result.status === "unknown").length;
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.reason) counts.set(result.reason, (counts.get(result.reason) ?? 0) + 1);
  }
  const reasons = Array.from(counts, ([reason, count]) => ({ reason, count }));
  const totalSamples = samples.length;
  const minSamples = Math.max(1, pipeline?.input?.minSamples ?? 1);
  const maxSamples = pipeline?.input?.maxSamples;
  let status: PipelineInputCompatibility["status"] = compatibleSamples === totalSamples
    ? "compatible"
    : compatibleSamples > 0 ? "partial" : unknownSamples > 0 ? "unknown" : "incompatible";
  let summary = status === "compatible"
    ? `Compatible inputs for all ${totalSamples} sample${totalSamples === 1 ? "" : "s"}`
    : status === "unknown" ? "Input compatibility is unknown"
    : `${compatibleSamples} of ${totalSamples} samples have compatible inputs`;
  if (compatibleSamples < minSamples) {
    if (compatibleSamples + unknownSamples < minSamples) {
      status = "incompatible";
      if (minSamples > 1) summary = `Requires at least ${minSamples} compatible samples; ${compatibleSamples} available`;
    } else {
      status = "unknown";
      summary = "Input compatibility is unknown";
    }
  }
  if (maxSamples && compatibleSamples > maxSamples) {
    status = "partial";
    summary = `${compatibleSamples} samples have compatible inputs; select at most ${maxSamples} per run`;
  }
  return { status, compatibleSamples, totalSamples, summary, reasons };
}
