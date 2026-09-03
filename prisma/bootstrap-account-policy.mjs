const DEPLOYMENT_PROFILES = new Set([
  "sequencing-center",
  "shared-lab",
  "research-workbench",
]);

export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/**
 * bcrypt only considers the first 72 bytes of a password. Reject longer
 * bootstrap plaintext before hashing so two distinct configured passwords can
 * never silently authenticate as the same credential.
 *
 * Keep the error deliberately free of the supplied password: this helper runs
 * in both installer and application seed paths, whose errors may be logged.
 */
export function assertBootstrapPlaintextPasswordSupported(password, kind) {
  if (Buffer.byteLength(password, "utf8") <= BCRYPT_MAX_PASSWORD_BYTES) {
    return;
  }

  const accountLabel = kind === "researcher" ? "researcher" : "administrator";
  throw new Error(
    `Bootstrap ${accountLabel} password exceeds bcrypt's ${BCRYPT_MAX_PASSWORD_BYTES}-byte UTF-8 limit`,
  );
}

function configuredProfile(config) {
  const deployment =
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    config.deployment &&
    typeof config.deployment === "object" &&
    !Array.isArray(config.deployment)
      ? config.deployment
      : null;
  return typeof deployment?.profile === "string"
    ? deployment.profile.trim()
    : "";
}

export function resolveBootstrapDeploymentProfile(config, environmentProfile) {
  const requested =
    typeof environmentProfile === "string" && environmentProfile.trim()
      ? environmentProfile.trim()
      : configuredProfile(config) || "sequencing-center";
  if (!DEPLOYMENT_PROFILES.has(requested)) {
    throw new Error(`Unsupported SeqDesk deployment profile: ${requested}`);
  }
  return requested;
}

export function resolveBootstrapAdminFacilityWorkflowRole(
  config,
  environmentProfile,
) {
  return resolveBootstrapDeploymentProfile(config, environmentProfile) ===
    "sequencing-center"
    ? "OPERATOR"
    : "REQUESTER";
}
