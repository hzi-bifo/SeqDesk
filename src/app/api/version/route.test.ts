import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentVersion: vi.fn(),
}));

vi.mock("@/lib/updater", () => ({
  getCurrentVersion: mocks.getCurrentVersion,
}));

import { GET } from "./route";

describe("GET /api/version", () => {
  it("returns the current version from getCurrentVersion()", async () => {
    mocks.getCurrentVersion.mockReturnValue("1.2.3");

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ version: "1.2.3" });
    expect(mocks.getCurrentVersion).toHaveBeenCalledTimes(1);
  });

  it("returns whatever version string getCurrentVersion provides", async () => {
    mocks.getCurrentVersion.mockReturnValue("0.0.1-beta");

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ version: "0.0.1-beta" });
  });
});
