import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET } from "./route";

describe("GET /api/settings/instructions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns stored post-submission instructions when present", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      postSubmissionInstructions: "Ship samples on dry ice",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      instructions: "Ship samples on dry ice",
    });
  });

  it("falls back to default instructions when unset or when the query fails", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      postSubmissionInstructions: null,
    });

    const unsetResponse = await GET();
    const unsetPayload = (await unsetResponse.json()) as { instructions: string };
    expect(unsetPayload.instructions).toContain("Thank you for your submission!");

    mocks.db.siteSettings.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failedResponse = await GET();
    const failedPayload = (await failedResponse.json()) as { instructions: string };
    expect(failedPayload.instructions).toContain("Thank you for your submission!");
  });
});
