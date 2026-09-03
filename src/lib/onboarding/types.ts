import type { DeploymentProfileId } from "@/lib/deployment-profile";
import type { OnboardingItem } from "./definitions";

export type OnboardingCompletion = {
  completedAt: string;
  completedByUserId: string;
};

export type OnboardingAutomaticVerification = OnboardingCompletion & {
  verifierVersion: number;
  configurationFingerprint: string;
};

export type OnboardingAutomaticCheckDetail = {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
};

export type OnboardingAutomaticCheck = {
  status: "verified" | "needs-attention" | "unverified";
  summary: string;
  checkedAt?: string;
  checks?: OnboardingAutomaticCheckDetail[];
};

export type StoredOnboardingState = {
  schemaVersion: number;
  profile: DeploymentProfileId;
  items: Record<string, OnboardingCompletion>;
  automaticVerifications?: Record<string, OnboardingAutomaticVerification>;
  completedAt?: string;
  completedByUserId?: string;
};

export type OnboardingStatusItem = Omit<OnboardingItem, "completionMode"> & {
  completionMode: "manual" | "automatic";
  complete: boolean;
  completion?: OnboardingCompletion;
  automaticCheck?: OnboardingAutomaticCheck;
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
  requiredCompletedCount: number;
  requiredTotalCount: number;
  recommendedCompletedCount: number;
  recommendedTotalCount: number;
  recommendationsComplete: boolean;
  items: OnboardingStatusItem[];
};
