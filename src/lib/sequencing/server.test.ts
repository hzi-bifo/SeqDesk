import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  getServerDeploymentProfile: vi.fn(),
  authOptions: { providers: [] },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: mocks.authOptions,
}));

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import {
  requireFacilityAdminSequencingReadSession,
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "./server";

describe("requireFacilityAdminSequencingSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isDemoSession.mockReturnValue(false);
    mocks.getServerDeploymentProfile.mockReturnValue({
      id: "sequencing-center",
      domains: [
        "core",
        "facility-intake",
        "sample-catalog",
        "sequencing-operations",
        "analysis",
        "publishing",
      ],
    });
  });

  it("throws a 401 error when no session exists", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    await expect(requireFacilityAdminSequencingSession()).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("rejects an invalidated session before applying demo restrictions", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "disabled-demo",
        role: "DISABLED",
        authorizationValid: false,
        isDemo: true,
      },
    });
    mocks.isDemoSession.mockReturnValue(true);

    await expect(requireFacilityAdminSequencingSession()).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
    expect(mocks.isDemoSession).not.toHaveBeenCalled();
  });

  it("rejects an invalidated session in the read-only guard", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "disabled-operator",
        role: "DISABLED",
        authorizationValid: false,
      },
    });

    await expect(
      requireFacilityAdminSequencingReadSession()
    ).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("rejects demo sessions even for facility admins", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(true);

    await expect(requireFacilityAdminSequencingSession()).rejects.toMatchObject({
      status: 403,
      message: "Sequencing data management is disabled in the public demo.",
    });
  });

  it("rejects non-admin sessions", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    await expect(requireFacilityAdminSequencingSession()).rejects.toMatchObject({
      status: 403,
      message: "You do not have permission to manage sequencing data",
    });
  });

  it("returns the session for facility admins", async () => {
    const session = {
      user: { id: "user-1", role: "FACILITY_ADMIN" },
    };
    mocks.getServerSession.mockResolvedValue(session);

    await expect(requireFacilityAdminSequencingSession()).resolves.toBe(session);
    expect(mocks.getServerSession).toHaveBeenCalledWith(mocks.authOptions);
  });

  it("returns the session for Shared Lab members", async () => {
    const session = {
      user: { id: "member-1", role: "RESEARCHER" },
    };
    mocks.getServerSession.mockResolvedValue(session);
    mocks.getServerDeploymentProfile.mockReturnValue({
      id: "shared-lab",
      domains: [
        "core",
        "facility-intake",
        "sample-catalog",
        "sequencing-operations",
        "analysis",
        "publishing",
      ],
    });

    await expect(requireFacilityAdminSequencingSession()).resolves.toBe(session);
  });

  it("returns 404 when sequencing operations are absent from the profile", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "member-1", role: "RESEARCHER" },
    });
    mocks.getServerDeploymentProfile.mockReturnValue({
      id: "research-workbench",
      domains: ["core", "analysis", "publishing", "workbench"],
    });

    await expect(requireFacilityAdminSequencingSession()).rejects.toMatchObject({
      status: 404,
      message: "Sequencing operations are not available",
    });
  });

  it("exposes the custom error status", () => {
    const error = new SequencingApiError(418, "teapot");

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(418);
    expect(error.message).toBe("teapot");
  });
});
