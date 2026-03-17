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

  const runtimeDetails = `${runtimePlatform.raw} (${runtimePlatform.source})`;
  return `Conda runtime on macOS ARM is not supported for ${manifest.package.name} (detected: ${runtimeDetails}). Use a Linux/SLURM server instead.`;
}
