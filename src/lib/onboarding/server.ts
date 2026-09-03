import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { loadConfig } from "@/lib/config/loader";
import {
  checkManagedStorageReadiness,
  MANAGED_STORAGE_READINESS_VERSION,
  resolveManagedStorageFingerprint,
} from "@/lib/files/managed-storage-readiness";
import { lockSiteSettingsExtraSettings } from "@/lib/seed/extra-settings-flag";
import {
  checkWorkflowRuntimeReadiness,
  resolveWorkflowRuntimeFingerprint,
  WORKFLOW_RUNTIME_READINESS_VERSION,
} from "./workflow-runtime-readiness";
import { getOnboardingItems, ONBOARDING_SCHEMA_VERSION } from "./definitions";
import { buildOnboardingStatus, parseStoredOnboardingState } from "./status";
import type {
  OnboardingAutomaticCheck,
  OnboardingAutomaticVerification,
  OnboardingStatus,
  StoredOnboardingState,
} from "./types";

const ONBOARDING_EXTRA_SETTINGS_KEY = "profileOnboarding";
const STORAGE_ITEM_ID = "verify-storage";
const WORKFLOW_RUNTIME_ITEM_ID = "verify-workflow-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseExtraSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

function requiredOnboardingVersion(): number {
  const value = loadConfig().config.deployment?.onboardingVersion;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function unverifiedCheck(summary: string): OnboardingAutomaticCheck {
  return { status: "unverified", summary };
}

function storedVerificationMatches(args: {
  verification: OnboardingAutomaticVerification | undefined;
  verifierVersion: number;
  fingerprint: string;
}): boolean {
  return Boolean(
    args.verification &&
      args.verification.verifierVersion === args.verifierVersion &&
      args.verification.configurationFingerprint === args.fingerprint
  );
}

async function resolveStoredAutomaticChecks(args: {
  profile: ReturnType<typeof getServerDeploymentProfile>;
  stored?: StoredOnboardingState;
}): Promise<Partial<Record<string, OnboardingAutomaticCheck>>> {
  const checks: Partial<Record<string, OnboardingAutomaticCheck>> = {};
  const storageIdentity = await resolveManagedStorageFingerprint();
  const storageVerification =
    args.stored?.automaticVerifications?.[STORAGE_ITEM_ID];
  checks[STORAGE_ITEM_ID] = storedVerificationMatches({
    verification: storageVerification,
    verifierVersion: MANAGED_STORAGE_READINESS_VERSION,
    fingerprint: storageIdentity.fingerprint,
  })
    ? {
        status: "verified",
        summary: "Managed storage was verified for the current configuration.",
        checkedAt: storageVerification?.completedAt,
      }
    : unverifiedCheck(
        storageIdentity.configurationState === "unavailable"
          ? "Managed storage configuration could not be read. Run the check again."
          : "Run the automatic managed-storage check for this configuration."
      );

  if (args.profile.id === "research-workbench") {
    const runtimeVerification =
      args.stored?.automaticVerifications?.[WORKFLOW_RUNTIME_ITEM_ID];
    try {
      const fingerprint = await resolveWorkflowRuntimeFingerprint();
      checks[WORKFLOW_RUNTIME_ITEM_ID] = storedVerificationMatches({
        verification: runtimeVerification,
        verifierVersion: WORKFLOW_RUNTIME_READINESS_VERSION,
        fingerprint,
      })
        ? {
            status: "verified",
            summary:
              "The workflow runtime was verified for the current configuration.",
            checkedAt: runtimeVerification?.completedAt,
          }
        : unverifiedCheck(
            "Run the automatic workflow-runtime check for this configuration."
          );
    } catch {
      checks[WORKFLOW_RUNTIME_ITEM_ID] = unverifiedCheck(
        "Workflow runtime configuration could not be read. Run the check again."
      );
    }
  }

  return checks;
}

async function readStoredOnboardingState(
  profileId: ReturnType<typeof getServerDeploymentProfile>["id"]
): Promise<{
  extra: Record<string, unknown>;
  stored?: StoredOnboardingState;
}> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });
  const extra = parseExtraSettings(settings?.extraSettings);
  return {
    extra,
    stored: parseStoredOnboardingState(
      extra[ONBOARDING_EXTRA_SETTINGS_KEY],
      profileId
    ),
  };
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const profile = getServerDeploymentProfile();
  const { stored } = await readStoredOnboardingState(profile.id);
  const automaticChecks = await resolveStoredAutomaticChecks({
    profile,
    stored,
  });
  return buildOnboardingStatus({
    profile: profile.id,
    requiredVersion: requiredOnboardingVersion(),
    stored,
    automaticChecks,
  });
}

export async function setOnboardingItemCompletion(args: {
  itemId: string;
  complete: boolean;
  actorUserId: string;
}): Promise<OnboardingStatus> {
  const profile = getServerDeploymentProfile();
  const definitions = getOnboardingItems(profile.id);
  const definition = definitions.find((item) => item.id === args.itemId);
  if (!definition) {
    throw new Error("Unknown onboarding item.");
  }
  if (definition.completionMode === "automatic") {
    throw new Error("Automatic onboarding items cannot be changed manually.");
  }
  const requiredVersion = requiredOnboardingVersion();
  const now = new Date().toISOString();

  const stored = await db.$transaction(async (tx) => {
    await lockSiteSettingsExtraSettings(tx);
    const settings = await tx.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    if (!settings) {
      throw new Error("Site settings are unavailable.");
    }
    const extra = parseExtraSettings(settings.extraSettings);
    const current = parseStoredOnboardingState(
      extra[ONBOARDING_EXTRA_SETTINGS_KEY],
      profile.id
    );
    const items = { ...(current?.items ?? {}) };
    if (args.complete) {
      items[args.itemId] = {
        completedAt: now,
        completedByUserId: args.actorUserId,
      };
    } else {
      delete items[args.itemId];
    }

    const allRequiredComplete = definitions
      .filter((item) => item.requirement === "required")
      .every((item) => Boolean(items[item.id]));
    const completionAudit =
      current?.completedAt && current.completedByUserId
        ? {
            completedAt: current.completedAt,
            completedByUserId: current.completedByUserId,
          }
        : allRequiredComplete &&
            !definitions.some(
              (item) =>
                item.requirement === "required" &&
                item.completionMode === "automatic"
            )
          ? {
              completedAt: now,
              completedByUserId: args.actorUserId,
            }
          : {};
    const next: StoredOnboardingState = {
      schemaVersion: ONBOARDING_SCHEMA_VERSION,
      profile: profile.id,
      items,
      automaticVerifications: current?.automaticVerifications ?? {},
      ...completionAudit,
    };
    extra[ONBOARDING_EXTRA_SETTINGS_KEY] = next;
    await tx.siteSettings.update({
      where: { id: "singleton" },
      data: { extraSettings: JSON.stringify(extra) },
    });
    return next;
  });

  const automaticChecks = await resolveStoredAutomaticChecks({
    profile,
    stored,
  });
  return buildOnboardingStatus({
    profile: profile.id,
    requiredVersion,
    stored,
    automaticChecks,
  });
}

export async function verifyAutomaticOnboarding(args: {
  actorUserId: string;
}): Promise<OnboardingStatus> {
  const profile = getServerDeploymentProfile();
  const requiredVersion = requiredOnboardingVersion();
  const [storage, runtime] = await Promise.all([
    checkManagedStorageReadiness(),
    profile.id === "research-workbench"
      ? checkWorkflowRuntimeReadiness()
      : Promise.resolve(null),
  ]);

  const automaticChecks: Partial<Record<string, OnboardingAutomaticCheck>> = {
    [STORAGE_ITEM_ID]: {
      status: storage.ready ? "verified" : "needs-attention",
      summary: storage.summary,
      checkedAt: storage.checkedAt,
      checks: storage.checks.map((check) => ({
        id: check.id,
        label:
          check.id === "write-probe"
            ? "Service write access"
            : check.id === "read-access"
              ? "Service read access"
              : check.id === "capacity"
                ? "Available capacity"
                : check.id === "configuration"
                  ? "Storage configuration"
                  : "Storage path",
        status: check.status,
        message: check.message,
      })),
    },
  };

  if (runtime) {
    automaticChecks[WORKFLOW_RUNTIME_ITEM_ID] = {
      status: runtime.ready ? "verified" : "needs-attention",
      summary: runtime.summary,
      checkedAt: runtime.checkedAt,
      checks: runtime.checks.map((check) => ({
        id: check.id,
        label: check.label,
        status:
          check.status === "ready"
            ? "pass"
            : check.status === "warning"
              ? "warning"
              : "fail",
        message: check.detail,
      })),
    };
  }

  const stored = await db.$transaction(async (tx) => {
    await lockSiteSettingsExtraSettings(tx);
    const settings = await tx.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    if (!settings) {
      throw new Error("Site settings are unavailable.");
    }
    const extra = parseExtraSettings(settings.extraSettings);
    const current = parseStoredOnboardingState(
      extra[ONBOARDING_EXTRA_SETTINGS_KEY],
      profile.id
    );
    const automaticVerifications = {
      ...(current?.automaticVerifications ?? {}),
    };

    if (storage.ready) {
      automaticVerifications[STORAGE_ITEM_ID] = {
        completedAt: storage.checkedAt,
        completedByUserId: args.actorUserId,
        verifierVersion: MANAGED_STORAGE_READINESS_VERSION,
        configurationFingerprint: storage.fingerprint,
      };
    } else {
      delete automaticVerifications[STORAGE_ITEM_ID];
    }
    if (runtime?.ready) {
      automaticVerifications[WORKFLOW_RUNTIME_ITEM_ID] = {
        completedAt: runtime.checkedAt,
        completedByUserId: args.actorUserId,
        verifierVersion: WORKFLOW_RUNTIME_READINESS_VERSION,
        configurationFingerprint: runtime.fingerprint,
      };
    } else if (runtime) {
      delete automaticVerifications[WORKFLOW_RUNTIME_ITEM_ID];
    }

    const requiredItems = getOnboardingItems(profile.id).filter(
      (item) => item.requirement === "required"
    );
    const allRequiredComplete = requiredItems
      .every((item) =>
        item.completionMode === "automatic"
          ? Boolean(automaticVerifications[item.id])
          : Boolean(current?.items[item.id])
      );
    const requiredEvidenceChanged = requiredItems
      .filter((item) => item.completionMode === "automatic")
      .some((item) => {
        const previous = current?.automaticVerifications?.[item.id];
        const next = automaticVerifications[item.id];
        return (
          !previous ||
          !next ||
          previous.verifierVersion !== next.verifierVersion ||
          previous.configurationFingerprint !== next.configurationFingerprint
        );
      });
    const completionAudit = allRequiredComplete
      ? current?.completedAt &&
        current.completedByUserId &&
        !requiredEvidenceChanged
        ? {
            completedAt: current.completedAt,
            completedByUserId: current.completedByUserId,
          }
        : {
            completedAt: new Date().toISOString(),
            completedByUserId: args.actorUserId,
          }
      : {};

    const next: StoredOnboardingState = {
      schemaVersion: ONBOARDING_SCHEMA_VERSION,
      profile: profile.id,
      items: current?.items ?? {},
      automaticVerifications,
      ...completionAudit,
    };
    extra[ONBOARDING_EXTRA_SETTINGS_KEY] = next;
    await tx.siteSettings.update({
      where: { id: "singleton" },
      data: { extraSettings: JSON.stringify(extra) },
    });
    return next;
  });

  return buildOnboardingStatus({
    profile: profile.id,
    requiredVersion,
    stored,
    automaticChecks,
  });
}
