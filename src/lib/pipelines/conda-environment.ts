export const DEFAULT_PIPELINE_CONDA_ENV = "seqdesk-pipelines";

export interface CondaEnvironmentReference {
  value: string;
  kind: "name" | "prefix";
  selector: "-n" | "-p";
}

/**
 * Conda accepts either an environment name (`-n`) or a filesystem prefix
 * (`-p`). SeqDesk install profiles support both, including shared cluster
 * prefixes which are intentionally outside the Conda base `envs/` directory.
 */
export function resolveCondaEnvironmentReference(
  value?: string | null
): CondaEnvironmentReference {
  const normalized = value?.trim() || DEFAULT_PIPELINE_CONDA_ENV;
  const isWindowsAbsolutePath = /^[a-zA-Z]:[\\/]/.test(normalized);
  const isPath =
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    isWindowsAbsolutePath ||
    normalized.includes("/") ||
    normalized.includes("\\");

  return {
    value: normalized,
    kind: isPath ? "prefix" : "name",
    selector: isPath ? "-p" : "-n",
  };
}

export function buildCondaRunArgs(
  environment: string | null | undefined,
  command: readonly string[]
): string[] {
  const reference = resolveCondaEnvironmentReference(environment);
  return ["run", reference.selector, reference.value, ...command];
}
