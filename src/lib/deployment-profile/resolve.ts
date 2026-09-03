import {
  DEFAULT_DEPLOYMENT_PROFILE_ID,
  getDeploymentProfileDefinition,
} from "./definitions";
import {
  DEPLOYMENT_PROFILE_IDS,
  type DeploymentProfileDefinition,
  type DeploymentProfileId,
} from "./types";

const LEGACY_PROFILE_ALIASES: Readonly<Record<string, DeploymentProfileId>> = {
  lab: "sequencing-center",
  workbench: "research-workbench",
};

export interface DeploymentProfileResolutionInput {
  configuredProfile?: string | null;
  legacyPublicSurface?: string | null;
  legacyServerSurface?: string | null;
  legacyWorkbenchOnly?: string | null;
}

export function isDeploymentProfileId(
  value: unknown
): value is DeploymentProfileId {
  return (
    typeof value === "string" &&
    (DEPLOYMENT_PROFILE_IDS as readonly string[]).includes(value)
  );
}

export function normalizeDeploymentProfileId(
  value: string | null | undefined
): DeploymentProfileId | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;

  if (isDeploymentProfileId(normalized)) {
    return normalized as DeploymentProfileId;
  }

  return LEGACY_PROFILE_ALIASES[normalized] ?? null;
}

export function resolveDeploymentProfileId({
  configuredProfile,
  legacyPublicSurface,
  legacyServerSurface,
  legacyWorkbenchOnly,
}: DeploymentProfileResolutionInput = {}): DeploymentProfileId {
  return (
    normalizeDeploymentProfileId(configuredProfile) ??
    normalizeDeploymentProfileId(legacyPublicSurface) ??
    normalizeDeploymentProfileId(legacyServerSurface) ??
    (legacyWorkbenchOnly === "1" || legacyWorkbenchOnly === "true"
      ? "research-workbench"
      : DEFAULT_DEPLOYMENT_PROFILE_ID)
  );
}

export function resolveDeploymentProfile(
  input?: DeploymentProfileResolutionInput
): DeploymentProfileDefinition {
  return getDeploymentProfileDefinition(resolveDeploymentProfileId(input));
}
