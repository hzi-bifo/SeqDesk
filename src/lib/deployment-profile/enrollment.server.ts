import { getEffectiveConfig } from "@/lib/config/database-merge";

import { getServerDeploymentProfile } from "./server";

export interface EnrollmentPolicy {
  policy: "self-registration" | "invite-only";
  allowSelfRegistration: boolean;
  source: "profile-default" | "database" | "file" | "env";
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

  const allowSelfRegistration =
    profile.enrollment.defaultPolicy === "self-registration";
  return {
    policy: profile.enrollment.defaultPolicy,
    allowSelfRegistration,
    source: "profile-default",
  };
}
