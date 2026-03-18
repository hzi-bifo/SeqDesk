import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentVersion: vi.fn(),
}));

vi.mock("@/lib/updater", () => ({
  getCurrentVersion: mocks.getCurrentVersion,
}));

import { GET } from "./route";

describe("GET /api/version", () => {
  it("returns the current updater version", async () => {
    mocks.getCurrentVersion.mockReturnValue("1.2.3");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ version: "1.2.3" });
  });
});
