import { loadConfig } from "@/lib/config/loader";

import { assertDeploymentProfileCompatible } from "./compatibility";
import { isDeploymentProfileId, resolveDeploymentProfile } from "./resolve";
import type { DeploymentProfileDefinition } from "./types";

/**
 * Resolve the installation-wide profile on the server.
 *
 * Canonical `deployment.profile` configuration wins. Legacy surface variables
 * are considered only while the canonical value still comes from the default,
 * so existing installations retain their previous behaviour during migration.
 */
export function getServerDeploymentProfile(): DeploymentProfileDefinition {
  const resolvedConfig = loadConfig();
  const configuredProfile =
    resolvedConfig.sources["deployment.profile"] === "default"
      ? undefined
      : resolvedConfig.config.deployment?.profile;

  if (configuredProfile !== undefined && !isDeploymentProfileId(configuredProfile)) {
    throw new Error(
      `Invalid deployment.profile "${String(configuredProfile)}". Expected sequencing-center, shared-lab, or research-workbench.`
    );
  }

  const profile = resolveDeploymentProfile({
    configuredProfile,
    legacyPublicSurface: process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE,
    legacyServerSurface: process.env.SEQDESK_APP_SURFACE,
    legacyWorkbenchOnly: process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY,
  });

  assertDeploymentProfileCompatible(profile, {
    pipelinesEnabled: resolvedConfig.config.pipelines?.enabled === true,
  });

  return profile;
}
