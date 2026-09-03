import type { DeploymentProfileId } from "@/lib/deployment-profile";
import { getOnboardingItems, ONBOARDING_SCHEMA_VERSION } from "./definitions";
import type {
  OnboardingCompletion,
  OnboardingStatus,
  StoredOnboardingState,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readCompletion(value: unknown): OnboardingCompletion | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.completedAt !== "string" || typeof value.completedByUserId !== "string") {
    return undefined;
  }
  return {
    completedAt: value.completedAt,
    completedByUserId: value.completedByUserId,
  };
}

export function parseStoredOnboardingState(
  value: unknown,
  profile: DeploymentProfileId
): StoredOnboardingState | undefined {
  if (!isRecord(value) || value.profile !== profile || !isRecord(value.items)) {
    return undefined;
  }
  const items = Object.fromEntries(
    Object.entries(value.items)
      .map(([id, completion]) => [id, readCompletion(completion)] as const)
      .filter((entry): entry is [string, OnboardingCompletion] => Boolean(entry[1]))
  );
  return {
    schemaVersion:
      typeof value.schemaVersion === "number" ? value.schemaVersion : ONBOARDING_SCHEMA_VERSION,
    profile,
    items,
    ...(typeof value.completedAt === "string" ? { completedAt: value.completedAt } : {}),
    ...(typeof value.completedByUserId === "string"
      ? { completedByUserId: value.completedByUserId }
      : {}),
  };
}

export function buildOnboardingStatus(args: {
  profile: DeploymentProfileId;
  requiredVersion: number;
  stored?: StoredOnboardingState;
}): OnboardingStatus {
  const definitions = getOnboardingItems(args.profile);
  const storedItems = args.stored?.items ?? {};
  const items = definitions.map((item) => ({
    ...item,
    complete: Boolean(storedItems[item.id]),
    ...(storedItems[item.id] ? { completion: storedItems[item.id] } : {}),
  }));
  const completedCount = items.filter((item) => item.complete).length;
  const requiredItems = items.filter((item) => item.requirement === "required");
  const recommendedItems = items.filter(
    (item) => item.requirement === "recommended"
  );
  const requiredCompletedCount = requiredItems.filter(
    (item) => item.complete
  ).length;
  const recommendedCompletedCount = recommendedItems.filter(
    (item) => item.complete
  ).length;
  const required = args.requiredVersion > 0;
  const requiredChecklistComplete =
    requiredCompletedCount === requiredItems.length;
  const recommendationsComplete =
    recommendedCompletedCount === recommendedItems.length;
  const requiredVersionComplete =
    !required || (args.stored?.schemaVersion ?? 0) >= args.requiredVersion;

  return {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    requiredVersion: args.requiredVersion,
    required,
    profile: args.profile,
    complete: required
      ? requiredChecklistComplete && requiredVersionComplete
      : true,
    ...(requiredChecklistComplete &&
    requiredVersionComplete &&
    args.stored?.completedAt
      ? { completedAt: args.stored.completedAt }
      : {}),
    ...(requiredChecklistComplete &&
    requiredVersionComplete &&
    args.stored?.completedByUserId
      ? { completedByUserId: args.stored.completedByUserId }
      : {}),
    completedCount,
    totalCount: items.length,
    requiredCompletedCount,
    requiredTotalCount: requiredItems.length,
    recommendedCompletedCount,
    recommendedTotalCount: recommendedItems.length,
    recommendationsComplete,
    items,
  };
}
