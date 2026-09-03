"use client";

import { createContext, type ReactNode, useContext } from "react";

import {
  getDeploymentProfileDefinition,
  type DeploymentProfileDefinition,
} from "@/lib/deployment-profile";

const DeploymentProfileContext = createContext<DeploymentProfileDefinition | null>(null);

export function DeploymentProfileProvider({
  profile,
  children,
}: {
  profile: DeploymentProfileDefinition;
  children: ReactNode;
}) {
  return (
    <DeploymentProfileContext.Provider value={profile}>
      {children}
    </DeploymentProfileContext.Provider>
  );
}

export function useDeploymentProfile(): DeploymentProfileDefinition {
  return (
    useContext(DeploymentProfileContext) ??
    getDeploymentProfileDefinition("sequencing-center")
  );
}
