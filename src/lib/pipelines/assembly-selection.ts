export interface AssemblySelectionRun {
  id?: string | null;
  runNumber?: string | null;
  createdAt?: Date | string | null;
}

export interface AssemblySelectionAssembly {
  id: string;
  assemblyFile: string | null;
  assemblyName?: string | null;
  createdByPipelineRunId?: string | null;
  createdByPipelineRun?: AssemblySelectionRun | null;
}

export interface AssemblySelectionSample {
  preferredAssemblyId?: string | null;
  assemblies: AssemblySelectionAssembly[];
}

export interface ResolveAssemblySelectionOptions {
  strictPreferred?: boolean;
}

export interface ResolveAssemblySelectionResult {
  assembly: AssemblySelectionAssembly | null;
  fallbackAssembly: AssemblySelectionAssembly | null;
  source: "preferred" | "auto" | "missing_preferred" | "none";
  preferredMissing: boolean;
}

function parseRunCreatedAt(value: Date | string | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasAssemblyFile(assembly: AssemblySelectionAssembly): boolean {
  return typeof assembly.assemblyFile === "string" && assembly.assemblyFile.trim().length > 0;
}

export function getAvailableAssemblies(
  sample: AssemblySelectionSample
): AssemblySelectionAssembly[] {
  return sample.assemblies
    .filter(hasAssemblyFile)
    .slice()
    .sort((left, right) => {
      const leftTs = parseRunCreatedAt(left.createdByPipelineRun?.createdAt);
      const rightTs = parseRunCreatedAt(right.createdByPipelineRun?.createdAt);
      if (leftTs !== rightTs) return rightTs - leftTs;

      const leftHasRun = Boolean(left.createdByPipelineRunId || left.createdByPipelineRun?.id);
      const rightHasRun = Boolean(
        right.createdByPipelineRunId || right.createdByPipelineRun?.id
      );
      if (leftHasRun !== rightHasRun) return rightHasRun ? 1 : -1;

      return right.id.localeCompare(left.id);
    });
}

export function resolveAssemblySelection(
  sample: AssemblySelectionSample,
  options?: ResolveAssemblySelectionOptions
): ResolveAssemblySelectionResult {
  const strictPreferred = options?.strictPreferred ?? false;
  const availableAssemblies = getAvailableAssemblies(sample);
  const fallbackAssembly = availableAssemblies[0] || null;
  const preferredAssemblyId = sample.preferredAssemblyId || null;

  if (!preferredAssemblyId) {
    return {
      assembly: fallbackAssembly,
      fallbackAssembly,
      source: fallbackAssembly ? "auto" : "none",
      preferredMissing: false,
    };
  }

  const preferredAssembly =
    availableAssemblies.find((assembly) => assembly.id === preferredAssemblyId) || null;

  if (preferredAssembly) {
    return {
      assembly: preferredAssembly,
      fallbackAssembly,
      source: "preferred",
      preferredMissing: false,
    };
  }

  return {
    assembly: strictPreferred ? null : fallbackAssembly,
    fallbackAssembly,
    source: "missing_preferred",
    preferredMissing: true,
  };
}
