import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const siteSettings = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  return {
    profile: {
      id: "shared-lab",
      experience: "sequencing",
    } as { id: string; experience: string },
    siteSettings,
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ siteSettings })
    ),
    loadConfig: vi.fn(),
    lockSiteSettingsExtraSettings: vi.fn(),
    resolveManagedStorageFingerprint: vi.fn(),
    checkManagedStorageReadiness: vi.fn(),
    resolveWorkflowRuntimeFingerprint: vi.fn(),
    checkWorkflowRuntimeReadiness: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    siteSettings: mocks.siteSettings,
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: () => mocks.profile,
}));

vi.mock("@/lib/config/loader", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("@/lib/seed/extra-settings-flag", () => ({
  lockSiteSettingsExtraSettings: mocks.lockSiteSettingsExtraSettings,
}));

vi.mock("@/lib/files/managed-storage-readiness", () => ({
  MANAGED_STORAGE_READINESS_VERSION: 1,
  resolveManagedStorageFingerprint: mocks.resolveManagedStorageFingerprint,
  checkManagedStorageReadiness: mocks.checkManagedStorageReadiness,
}));

vi.mock("./workflow-runtime-readiness", () => ({
  WORKFLOW_RUNTIME_READINESS_VERSION: 1,
  resolveWorkflowRuntimeFingerprint: mocks.resolveWorkflowRuntimeFingerprint,
  checkWorkflowRuntimeReadiness: mocks.checkWorkflowRuntimeReadiness,
}));

import {
  getOnboardingStatus,
  setOnboardingItemCompletion,
  verifyAutomaticOnboarding,
} from "./server";

const storageFingerprint = "a".repeat(64);
const runtimeFingerprint = "b".repeat(64);
const checkedAt = "2026-09-03T18:00:00.000Z";

function storedState(
  automaticVerifications: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    profileOnboarding: {
      schemaVersion: 1,
      profile: mocks.profile.id,
      items: {},
      automaticVerifications,
    },
  });
}

describe("automatic profile onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = { id: "shared-lab", experience: "sequencing" };
    mocks.loadConfig.mockReturnValue({
      config: { deployment: { onboardingVersion: 1 } },
    });
    mocks.siteSettings.findUnique.mockResolvedValue({
      extraSettings: storedState(),
    });
    mocks.siteSettings.update.mockResolvedValue({});
    mocks.resolveManagedStorageFingerprint.mockResolvedValue({
      fingerprint: storageFingerprint,
      configurationState: "resolved",
      configured: true,
      source: "file",
      implicit: false,
    });
    mocks.checkManagedStorageReadiness.mockResolvedValue({
      ready: true,
      status: "ready",
      checkedAt,
      summary: "Managed storage is ready for SeqDesk writes.",
      fingerprint: storageFingerprint,
      checks: [
        {
          id: "write-probe",
          status: "pass",
          message: "Write probe passed.",
        },
      ],
      metrics: {
        configured: true,
        source: "file",
        implicit: false,
        readable: true,
        writable: true,
        availableBytes: "1024",
      },
    });
    mocks.resolveWorkflowRuntimeFingerprint.mockResolvedValue(
      runtimeFingerprint
    );
    mocks.checkWorkflowRuntimeReadiness.mockResolvedValue({
      ready: true,
      status: "ready",
      checkedAt,
      summary: "Workflow runtime is ready.",
      fingerprint: runtimeFingerprint,
      executor: "local",
      checks: [
        {
          id: "nextflow",
          label: "Nextflow",
          status: "ready",
          blocking: true,
          detail: "Installed.",
          href: "/admin/pipeline-runtime",
        },
      ],
    });
  });

  it("uses matching persisted evidence without rerunning write or process probes", async () => {
    mocks.siteSettings.findUnique.mockResolvedValue({
      extraSettings: storedState({
        "verify-storage": {
          completedAt: checkedAt,
          completedByUserId: "admin-1",
          verifierVersion: 1,
          configurationFingerprint: storageFingerprint,
        },
      }),
    });

    const status = await getOnboardingStatus();

    expect(status.complete).toBe(true);
    expect(status.requiredCompletedCount).toBe(1);
    expect(mocks.checkManagedStorageReadiness).not.toHaveBeenCalled();
    expect(mocks.checkWorkflowRuntimeReadiness).not.toHaveBeenCalled();
  });

  it("invalidates evidence when the effective configuration fingerprint changes", async () => {
    mocks.siteSettings.findUnique.mockResolvedValue({
      extraSettings: storedState({
        "verify-storage": {
          completedAt: checkedAt,
          completedByUserId: "admin-1",
          verifierVersion: 1,
          configurationFingerprint: "old-fingerprint",
        },
      }),
    });

    const status = await getOnboardingStatus();

    expect(status.complete).toBe(false);
    expect(status.items.find((item) => item.id === "verify-storage"))
      .toMatchObject({
        complete: false,
        automaticCheck: { status: "unverified" },
      });
  });

  it("adds the workflow-runtime evidence gate only for Research Workbench", async () => {
    mocks.profile = {
      id: "research-workbench",
      experience: "workbench",
    };
    mocks.siteSettings.findUnique.mockResolvedValue({
      extraSettings: storedState({
        "verify-storage": {
          completedAt: checkedAt,
          completedByUserId: "admin-1",
          verifierVersion: 1,
          configurationFingerprint: storageFingerprint,
        },
        "verify-workflow-runtime": {
          completedAt: checkedAt,
          completedByUserId: "admin-1",
          verifierVersion: 1,
          configurationFingerprint: runtimeFingerprint,
        },
      }),
    });

    const status = await getOnboardingStatus();

    expect(status.complete).toBe(true);
    expect(status.requiredCompletedCount).toBe(2);
    expect(mocks.resolveWorkflowRuntimeFingerprint).toHaveBeenCalledTimes(1);
  });

  it("persists successful automatic evidence and returns detailed admin results", async () => {
    const status = await verifyAutomaticOnboarding({
      actorUserId: "admin-1",
    });

    expect(status.complete).toBe(true);
    expect(status.completedAt).toEqual(expect.any(String));
    expect(status.completedByUserId).toBe("admin-1");
    expect(status.items.find((item) => item.id === "verify-storage"))
      .toMatchObject({
        complete: true,
        automaticCheck: {
          status: "verified",
          checks: [
            expect.objectContaining({
              id: "write-probe",
              label: "Service write access",
            }),
          ],
        },
      });
    const update = mocks.siteSettings.update.mock.calls[0][0];
    const persisted = JSON.parse(update.data.extraSettings);
    expect(
      persisted.profileOnboarding.automaticVerifications["verify-storage"]
    ).toEqual({
      completedAt: checkedAt,
      completedByUserId: "admin-1",
      verifierVersion: 1,
      configurationFingerprint: storageFingerprint,
    });
    expect(persisted.profileOnboarding).toEqual(
      expect.objectContaining({
        completedAt: expect.any(String),
        completedByUserId: "admin-1",
      })
    );
    expect(JSON.stringify(persisted)).not.toContain("Write probe passed");
  });

  it("removes stale evidence when a fresh automatic check fails", async () => {
    mocks.siteSettings.findUnique.mockResolvedValue({
      extraSettings: storedState({
        "verify-storage": {
          completedAt: checkedAt,
          completedByUserId: "admin-1",
          verifierVersion: 1,
          configurationFingerprint: storageFingerprint,
        },
      }),
    });
    mocks.checkManagedStorageReadiness.mockResolvedValue({
      ready: false,
      status: "not-ready",
      checkedAt,
      summary: "The SeqDesk service cannot safely write managed storage.",
      fingerprint: storageFingerprint,
      checks: [
        {
          id: "write-probe",
          status: "fail",
          message: "Write probe failed.",
        },
      ],
      metrics: {
        configured: true,
        source: "file",
        implicit: false,
        readable: true,
        writable: false,
        availableBytes: "1024",
      },
    });

    const status = await verifyAutomaticOnboarding({
      actorUserId: "admin-1",
    });

    expect(status.complete).toBe(false);
    const update = mocks.siteSettings.update.mock.calls[0][0];
    const persisted = JSON.parse(update.data.extraSettings);
    expect(
      persisted.profileOnboarding.automaticVerifications["verify-storage"]
    ).toBeUndefined();
    expect(persisted.profileOnboarding.completedAt).toBeUndefined();
    expect(persisted.profileOnboarding.completedByUserId).toBeUndefined();
  });

  it("preserves aggregate completion metadata when a recommendation changes", async () => {
    mocks.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        profileOnboarding: {
          schemaVersion: 1,
          profile: "shared-lab",
          items: {},
          automaticVerifications: {
            "verify-storage": {
              completedAt: checkedAt,
              completedByUserId: "admin-1",
              verifierVersion: 1,
              configurationFingerprint: storageFingerprint,
            },
          },
          completedAt: checkedAt,
          completedByUserId: "admin-1",
        },
      }),
    });

    await setOnboardingItemCompletion({
      itemId: "acknowledge-backups",
      complete: true,
      actorUserId: "admin-2",
    });

    const update = mocks.siteSettings.update.mock.calls[0][0];
    const persisted = JSON.parse(update.data.extraSettings);
    expect(persisted.profileOnboarding).toEqual(
      expect.objectContaining({
        completedAt: checkedAt,
        completedByUserId: "admin-1",
      })
    );
  });

  it("preserves first-completion audit metadata on a repeat successful check", async () => {
    mocks.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        profileOnboarding: {
          schemaVersion: 1,
          profile: "shared-lab",
          items: {},
          automaticVerifications: {
            "verify-storage": {
              completedAt: checkedAt,
              completedByUserId: "admin-1",
              verifierVersion: 1,
              configurationFingerprint: storageFingerprint,
            },
          },
          completedAt: checkedAt,
          completedByUserId: "admin-1",
        },
      }),
    });

    const status = await verifyAutomaticOnboarding({
      actorUserId: "admin-2",
    });

    expect(status.completedAt).toBe(checkedAt);
    expect(status.completedByUserId).toBe("admin-1");
    const update = mocks.siteSettings.update.mock.calls[0][0];
    const persisted = JSON.parse(update.data.extraSettings);
    expect(persisted.profileOnboarding).toEqual(
      expect.objectContaining({
        completedAt: checkedAt,
        completedByUserId: "admin-1",
      })
    );
  });

  it("rejects manual completion of an automatic item before writing", async () => {
    await expect(
      setOnboardingItemCompletion({
        itemId: "verify-storage",
        complete: true,
        actorUserId: "admin-1",
      })
    ).rejects.toThrow("cannot be changed manually");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
