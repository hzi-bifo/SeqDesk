"use client";

import { useSession } from "next-auth/react";

import { hasCapability } from "@/lib/authorization/capabilities";
import { principalFromSession } from "@/lib/authorization/principal";
import type { Capability } from "@/lib/authorization/types";

import { useDeploymentProfile } from "./DeploymentProfileProvider";

export function useCapability(capability: Capability): boolean {
  const { data: session } = useSession();
  const profile = useDeploymentProfile();
  const principal = principalFromSession(session);

  return principal ? hasCapability(profile, principal, capability) : false;
}
