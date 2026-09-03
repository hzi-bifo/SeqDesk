import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkDatabaseStatus: vi.fn(),
  getServerEnrollmentPolicy: vi.fn(),
}));

vi.mock("@/lib/db-status", () => ({
  checkDatabaseStatus: mocks.checkDatabaseStatus,
}));

vi.mock("@/lib/deployment-profile/enrollment.server", () => ({
  getServerEnrollmentPolicy: mocks.getServerEnrollmentPolicy,
}));

import { GET, dynamic, revalidate } from "./route";

describe("GET /api/setup/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerEnrollmentPolicy.mockResolvedValue({
      policy: "self-registration",
      allowSelfRegistration: true,
      source: "profile-default",
    });
    process.env.DATABASE_URL =
      "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_test?schema=public";
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  });

  it("exports uncached route settings", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });

  it("returns read-only setup, operating-model, and enrollment status", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
      hasAdministrator: true,
      reason: "configured",
    });

    const response = await GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      exists: true,
      configured: true,
      hasAdministrator: true,
      phase: "ready",
      deploymentProfile: {
        id: "sequencing-center",
        label: "Sequencing center",
      },
      enrollment: {
        policy: "self-registration",
        allowSelfRegistration: true,
      },
      nextAction: {
        href: "/login",
      },
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(1);
  });

  it("reports an unreachable database without attempting any setup mutation", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: false,
      configured: false,
      reason: "unreachable",
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      exists: false,
      configured: false,
      phase: "database-unreachable",
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(1);
  });

  it("directs a configured installation without an administrator back to the installer", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
      hasAdministrator: false,
      reason: "configured",
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      hasAdministrator: false,
      phase: "administrator-missing",
      nextAction: {
        label: "Create administrator",
        command: "seqdesk --reconfigure",
      },
    });
  });

  it("directs a migrated but uninitialized installation to guided setup", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: false,
      reason: "not_seeded",
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      phase: "initial-data-missing",
      nextAction: {
        label: "Complete guided setup",
        command: "seqdesk --reconfigure",
      },
    });
  });
});
