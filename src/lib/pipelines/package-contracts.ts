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

export interface PipelineCapabilities {
  requiresLinkedReads: boolean;
  writesCanonicalReadMetadata: boolean;
  writesCanonicalReadFiles: boolean;
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
    writeback?: PackageOutputWriteback;
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

  const writesCanonicalReadFiles = readWritebackFields.some(
    (field) => field === "file1" || field === "file2"
  );
  const writesCanonicalReadMetadata = readWritebackFields.some(
    (field) => field !== "file1" && field !== "file2"
  );

  return {
    requiresLinkedReads,
    writesCanonicalReadMetadata,
    writesCanonicalReadFiles,
  };
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
