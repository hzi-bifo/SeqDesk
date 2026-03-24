import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
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

import {
  requireFacilityAdminSequencingSession,
  SequencingApiError,
} from "./server";

describe("requireFacilityAdminSequencingSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isDemoSession.mockReturnValue(false);
  });

  it("throws a 401 error when no session exists", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    await expect(requireFacilityAdminSequencingSession()).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("rejects demo sessions even for facility admins", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(true);

    await expect(requireFacilityAdminSequencingSession()).rejects.toMatchObject({
      status: 403,
      message: "Sequencing data management is disabled in the public demo.",
    });
  });

  it("rejects non-admin sessions", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    await expect(requireFacilityAdminSequencingSession()).rejects.toMatchObject({
      status: 403,
      message: "Only facility admins can manage sequencing data",
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

  it("exposes the custom error status", () => {
    const error = new SequencingApiError(418, "teapot");

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(418);
    expect(error.message).toBe("teapot");
  });
});
