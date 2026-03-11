import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

describe("ticketReferencesSupported", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("detects PostgreSQL ticket reference columns", async () => {
    mocks.db.$queryRawUnsafe.mockResolvedValue([
      { name: "orderId" },
      { name: "studyId" },
    ]);

    const { ticketReferencesSupported } = await import("./reference-support");
    const result = await ticketReferencesSupported();

    expect(result).toBe(true);
    expect(mocks.db.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("information_schema.columns")
    );
  });

  it("returns false when the schema probe fails", async () => {
    mocks.db.$queryRawUnsafe.mockRejectedValue(new Error("probe failed"));

    const { ticketReferencesSupported } = await import("./reference-support");
    const result = await ticketReferencesSupported();

    expect(result).toBe(false);
  });
});
