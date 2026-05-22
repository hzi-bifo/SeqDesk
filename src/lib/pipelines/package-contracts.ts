export const PACKAGE_TARGET_TYPES = ["study", "order"] as const;
export type PackageTargetType = (typeof PACKAGE_TARGET_TYPES)[number];

export const PIPELINE_CATALOGS = PACKAGE_TARGET_TYPES;
export type PipelineCatalog = PackageTargetType;

export const READ_WRITEBACK_FIELDS = [
  "file1",
  "file2",
  "checksum1",
  "checksum2",
  "readCount1",
  "readCount2",
  "avgQuality1",
  "avgQuality2",
  "fastqcReport1",
  "fastqcReport2",
] as const;
export type ReadWritebackField = (typeof READ_WRITEBACK_FIELDS)[number];

export const READ_STRING_WRITEBACK_FIELDS = [
  "file1",
  "file2",
  "checksum1",
  "checksum2",
  "fastqcReport1",
  "fastqcReport2",
] as const satisfies readonly ReadWritebackField[];

export const READ_NUMBER_WRITEBACK_FIELDS = [
  "readCount1",
  "readCount2",
  "avgQuality1",
  "avgQuality2",
] as const satisfies readonly ReadWritebackField[];

export type ReadWritebackMode = "merge" | "replace";

export interface PackageOutputWriteback {
  target: "Read";
  mode?: ReadWritebackMode;
  fields: Record<string, ReadWritebackField>;
}

export const PIPELINE_RESULT_KINDS = [
  "run_artifact",
  "study_report",
  "order_report",
  "order_file",
  "download",
  "sample_assembly",
  "sample_bin",
  "sample_annotation",
  "sample_qc",
  "sample_metadata",
  "sample_read_metadata",
  "sample_read_candidate",
  "sample_read_replace",
] as const;
export type PipelineResultKind = (typeof PIPELINE_RESULT_KINDS)[number];

export const PIPELINE_WRITEBACK_POLICIES = [
  "none",
  "metadata_only",
  "stage_only",
  "admin_review",
  "promote_on_success",
  "replace_on_success",
] as const;
export type PipelineWritebackPolicy = (typeof PIPELINE_WRITEBACK_POLICIES)[number];

export interface PackageOutputResultPreview {
  label?: string;
  primary?: boolean;
  previewable?: boolean;
}

export interface PackageOutputResultContract {
  kind: PipelineResultKind;
  writebackPolicy?: PipelineWritebackPolicy;
  preview?: PackageOutputResultPreview;
}

export interface PipelineCapabilities {
  requiresLinkedReads: boolean;
  writesCanonicalReadMetadata: boolean;
  writesCanonicalReadFiles: boolean;
  stagesReadCandidates: boolean;
  requiresAdminReadPromotion: boolean;
}

type CompatibleSupportedScope = "study" | "order" | "samples" | "sample";

interface ManifestLike {
  targets?: {
    supported?: PackageTargetType[];
  };
  inputs?: Array<{
    scope?: string;
    source?: string;
  }>;
  outputs?: Array<{
    destination?: string;
    type?: string;
    writeback?: PackageOutputWriteback;
    result?: PackageOutputResultContract;
  }>;
}

interface RegistryLike {
  input?: {
    supportedScopes?: CompatibleSupportedScope[];
    perSample?: {
      reads?: boolean;
    };
  };
}

function uniqueValues<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function deriveManifestTargets(
  manifest?: ManifestLike | null,
  registry?: RegistryLike | null
): PackageTargetType[] {
  const declaredTargets = manifest?.targets?.supported;
  if (declaredTargets && declaredTargets.length > 0) {
    return uniqueValues(declaredTargets);
  }

  const scopes = registry?.input?.supportedScopes ?? [];
  const targets: PackageTargetType[] = [];

  if (scopes.includes("study") || scopes.includes("sample") || scopes.includes("samples")) {
    targets.push("study");
  }
  if (scopes.includes("order")) {
    targets.push("order");
  }

  return uniqueValues(targets);
}

export function deriveCompatibleInputScopes(
  manifest?: ManifestLike | null,
  registry?: RegistryLike | null
): CompatibleSupportedScope[] {
  const targets = deriveManifestTargets(manifest, registry);
  if (targets.length === 0) {
    return registry?.input?.supportedScopes ?? [];
  }

  const scopes: CompatibleSupportedScope[] = [];
  if (targets.includes("study")) {
    scopes.push("study");
  }
  if (targets.includes("order")) {
    scopes.push("order");
  }
  return scopes;
}

export function derivePipelineCatalogs(
  targets: readonly PackageTargetType[]
): PipelineCatalog[] {
  return uniqueValues(
    targets.filter(
      (target): target is PipelineCatalog =>
        target === "study" || target === "order"
    )
  );
}

function inputRequiresLinkedReads(input: { scope?: string; source?: string }): boolean {
  const source = input.source?.trim();
  if (!source) {
    return false;
  }

  if (source === "sample.reads" || source.startsWith("sample.reads.")) {
    return true;
  }

  return input.scope === "sample" && (source === "read" || source.startsWith("read."));
}

export function derivePipelineCapabilities(
  manifest?: ManifestLike | null,
  registry?: RegistryLike | null
): PipelineCapabilities {
  const manifestInputs = manifest?.inputs ?? [];
  const manifestOutputs = manifest?.outputs ?? [];

  const requiresLinkedReads =
    manifestInputs.length > 0
      ? manifestInputs.some(inputRequiresLinkedReads)
      : registry?.input?.perSample?.reads === true;

  const readWritebackFields = manifestOutputs.flatMap((output) =>
    output.writeback?.target === "Read"
      ? Object.values(output.writeback.fields ?? {})
      : []
  );
  const resultContracts = manifestOutputs.map(inferPipelineResultContract);

  const writesCanonicalReadFiles = readWritebackFields.some(
    (field) => field === "file1" || field === "file2"
  );
  const writesCanonicalReadMetadata = readWritebackFields.some(
    (field) => field !== "file1" && field !== "file2"
  );
  const stagesReadCandidates = resultContracts.some(
    (result) => result.kind === "sample_read_candidate"
  );
  const requiresAdminReadPromotion = resultContracts.some(
    (result) => result.writebackPolicy === "admin_review"
  );

  return {
    requiresLinkedReads,
    writesCanonicalReadMetadata,
    writesCanonicalReadFiles,
    stagesReadCandidates,
    requiresAdminReadPromotion,
  };
}

type OutputContractLike = {
  destination?: string;
  type?: string;
  writeback?: PackageOutputWriteback;
  result?: PackageOutputResultContract;
};

function hasReadFileWriteback(output: OutputContractLike): boolean {
  return output.writeback?.target === "Read"
    ? Object.values(output.writeback.fields ?? {}).some(
        (field) => field === "file1" || field === "file2"
      )
    : false;
}

function hasReadMetadataWriteback(output: OutputContractLike): boolean {
  return output.writeback?.target === "Read"
    ? Object.values(output.writeback.fields ?? {}).some(
        (field) => field !== "file1" && field !== "file2"
      )
    : false;
}

export function inferPipelineResultContract(
  output: OutputContractLike
): PackageOutputResultContract {
  if (output.result) {
    return output.result;
  }

  if (output.writeback?.target === "Read") {
    if (hasReadFileWriteback(output)) {
      return {
        kind: "sample_read_replace",
        writebackPolicy:
          output.writeback.mode === "replace"
            ? "replace_on_success"
            : "promote_on_success",
      };
    }

    if (hasReadMetadataWriteback(output)) {
      return {
        kind: "sample_read_metadata",
        writebackPolicy: "metadata_only",
      };
    }
  }

  switch (output.destination) {
    case "sample_assemblies":
      return { kind: "sample_assembly", writebackPolicy: "promote_on_success" };
    case "sample_bins":
      return { kind: "sample_bin", writebackPolicy: "promote_on_success" };
    case "sample_annotations":
      return { kind: "sample_annotation", writebackPolicy: "promote_on_success" };
    case "sample_qc":
      return { kind: "sample_qc", writebackPolicy: "promote_on_success" };
    case "sample_metadata":
      return { kind: "sample_metadata", writebackPolicy: "promote_on_success" };
    case "study_report":
      return { kind: "study_report", writebackPolicy: "none" };
    case "order_report":
      return { kind: "order_report", writebackPolicy: "none" };
    case "order_files":
      return { kind: "order_file", writebackPolicy: "none" };
    case "download_only":
      return { kind: "download", writebackPolicy: "none" };
    case "run_artifact":
    default:
      return {
        kind: "run_artifact",
        writebackPolicy: "none",
        preview: output.type === "report" ? { previewable: true } : undefined,
      };
  }
}

export function matchesPipelineCatalog(
  catalogs: readonly PipelineCatalog[],
  requestedCatalog: string | null | undefined
): boolean {
  if (!requestedCatalog || requestedCatalog === "all") {
    return true;
  }

  return catalogs.includes(requestedCatalog as PipelineCatalog);
}
