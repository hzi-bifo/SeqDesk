import type { DeploymentProfileId } from "@/lib/deployment-profile";
import type { OnboardingItem } from "./definitions";

export type OnboardingCompletion = {
  completedAt: string;
  completedByUserId: string;
};

export type StoredOnboardingState = {
  schemaVersion: number;
  profile: DeploymentProfileId;
  items: Record<string, OnboardingCompletion>;
  completedAt?: string;
  completedByUserId?: string;
};

export type OnboardingStatusItem = OnboardingItem & {
  complete: boolean;
  completion?: OnboardingCompletion;
};

export type OnboardingStatus = {
  schemaVersion: number;
  requiredVersion: number;
  required: boolean;
  profile: DeploymentProfileId;
  complete: boolean;
  completedAt?: string;
  completedByUserId?: string;
  completedCount: number;
  totalCount: number;
  items: OnboardingStatusItem[];
};
