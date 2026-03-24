import type { PackageManifest } from "./package-loader";
import type { RuntimePlatformInfo } from "./runtime-platform";
import { isMacOsArmRuntime } from "./runtime-platform";

interface LocalCondaCompatibilityOptions {
  manifest: Pick<PackageManifest, "package" | "execution">;
  runtimeMode?: "conda";
  useSlurm: boolean;
  runtimePlatform: RuntimePlatformInfo;
}

export function getLocalCondaCompatibilityBlockMessage(
  options: LocalCondaCompatibilityOptions
): string | null {
  const { manifest, runtimeMode, useSlurm, runtimePlatform } = options;

  if (runtimeMode !== "conda" || useSlurm || !isMacOsArmRuntime(runtimePlatform)) {
    return null;
  }

  if (manifest.execution.runtime?.allowMacOsArmConda) {
    return null;
  }

  // Pipeline opts into local execution without Conda (tools installed via Homebrew)
  if (manifest.execution.runtime?.allowMacOsArmLocal) {
    return null;
  }

  const runtimeDetails = `${runtimePlatform.raw} (${runtimePlatform.source})`;
  return `Conda runtime on macOS ARM is not supported for ${manifest.package.name} (detected: ${runtimeDetails}). To run this pipeline locally, install the required tools via Homebrew (e.g. "brew install fastqc") and set the Nextflow profile to "standard" instead of "conda". Alternatively, use a Linux/SLURM server.`;
}

/**
 * Check whether the conda profile should be skipped on macOS ARM.
 * Returns true when on macOS ARM, using conda runtime, not using SLURM,
 * and the manifest opts in via `allowMacOsArmLocal`.
 */
export function shouldSkipCondaOnMacArm(options: {
  manifest: Pick<PackageManifest, "execution">;
  runtimeMode?: "conda";
  useSlurm: boolean;
  runtimePlatform: RuntimePlatformInfo;
}): boolean {
  if (options.runtimeMode !== "conda" || options.useSlurm) return false;
  if (!isMacOsArmRuntime(options.runtimePlatform)) return false;
  return options.manifest.execution.runtime?.allowMacOsArmLocal === true;
}
