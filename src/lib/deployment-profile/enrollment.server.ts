import { getEffectiveConfig } from "@/lib/config/database-merge";

import { getServerDeploymentProfile } from "./server";

export interface EnrollmentPolicy {
  policy: "self-registration" | "invite-only";
  allowSelfRegistration: boolean;
  source:
    | "profile-default"
    | "access-topology"
    | "database"
    | "file"
    | "env";
}

export async function getServerEnrollmentPolicy(): Promise<EnrollmentPolicy> {
  const profile = getServerDeploymentProfile();
  const resolved = await getEffectiveConfig();
  const configuredSource = resolved.sources["auth.allowRegistration"];

  if (
    configuredSource === "database" ||
    configuredSource === "file" ||
    configuredSource === "env"
  ) {
    const allowSelfRegistration =
      resolved.config.auth?.allowRegistration === true;
    return {
      policy: allowSelfRegistration ? "self-registration" : "invite-only",
      allowSelfRegistration,
      source: configuredSource,
    };
  }

  // A new team-facing installation must not become publicly claimable merely
  // because Sequencing Center historically defaulted to self-registration.
  // The installer persists its topology choice in app.accessAudience. Keep
  // legacy installations with no recorded audience on the historical profile
  // default, while requiring an administrator to deliberately opt in through
  // auth.allowRegistration for team-server/advanced deployments.
  if (
    profile.enrollment.defaultPolicy === "self-registration" &&
    resolved.config.app?.accessAudience &&
    resolved.config.app.accessAudience !== "local"
  ) {
    return {
      policy: "invite-only",
      allowSelfRegistration: false,
      source: "access-topology",
    };
  }

  const allowSelfRegistration =
    profile.enrollment.defaultPolicy === "self-registration";
  return {
    policy: profile.enrollment.defaultPolicy,
    allowSelfRegistration,
    source: "profile-default",
  };
}
