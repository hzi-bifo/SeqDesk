import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveConfig: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
}));

vi.mock("@/lib/config/database-merge", () => ({
  getEffectiveConfig: mocks.getEffectiveConfig,
}));

vi.mock("./server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import { getServerEnrollmentPolicy } from "./enrollment.server";

describe("getServerEnrollmentPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveConfig.mockResolvedValue({
      config: { auth: { allowRegistration: true } },
      sources: { "auth.allowRegistration": "default" },
    });
  });

  it.each([
    ["sequencing-center", "self-registration", true],
    ["shared-lab", "invite-only", false],
    ["research-workbench", "invite-only", false],
  ] as const)("uses the %s profile default", async (_id, policy, allowed) => {
    mocks.getServerDeploymentProfile.mockReturnValue({
      enrollment: { defaultPolicy: policy },
    });

    await expect(getServerEnrollmentPolicy()).resolves.toEqual({
      policy,
      allowSelfRegistration: allowed,
      source: "profile-default",
    });
  });

  it("honors a deliberate database override", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue({
      enrollment: { defaultPolicy: "invite-only" },
    });
    mocks.getEffectiveConfig.mockResolvedValue({
      config: { auth: { allowRegistration: true } },
      sources: { "auth.allowRegistration": "database" },
    });

    await expect(getServerEnrollmentPolicy()).resolves.toEqual({
      policy: "self-registration",
      allowSelfRegistration: true,
      source: "database",
    });
  });

  it.each(["team-server", "advanced"] as const)(
    "keeps a %s Sequencing Center invite-only until registration is explicitly enabled",
    async (accessAudience) => {
      mocks.getServerDeploymentProfile.mockReturnValue({
        enrollment: { defaultPolicy: "self-registration" },
      });
      mocks.getEffectiveConfig.mockResolvedValue({
        config: {
          app: { accessAudience },
          auth: { allowRegistration: true },
        },
        sources: {
          "app.accessAudience": "file",
          "auth.allowRegistration": "default",
        },
      });

      await expect(getServerEnrollmentPolicy()).resolves.toEqual({
        policy: "invite-only",
        allowSelfRegistration: false,
        source: "access-topology",
      });
    }
  );

  it("keeps local and legacy Sequencing Center registration behavior", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue({
      enrollment: { defaultPolicy: "self-registration" },
    });

    for (const app of [{ accessAudience: "local" }, {}]) {
      mocks.getEffectiveConfig.mockResolvedValue({
        config: { app, auth: { allowRegistration: true } },
        sources: { "auth.allowRegistration": "default" },
      });

      await expect(getServerEnrollmentPolicy()).resolves.toEqual({
        policy: "self-registration",
        allowSelfRegistration: true,
        source: "profile-default",
      });
    }
  });
});
