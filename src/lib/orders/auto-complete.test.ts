import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    statusNote: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { checkAndCompleteOrder } from "./auto-complete";

describe("checkAndCompleteOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-18T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false when the order is missing or not submitted", async () => {
    mocks.db.order.findUnique.mockResolvedValueOnce(null);
    await expect(checkAndCompleteOrder("order-1")).resolves.toBe(false);

    mocks.db.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      status: "DRAFT",
      samples: [],
    });
    await expect(checkAndCompleteOrder("order-1")).resolves.toBe(false);

    expect(mocks.db.order.update).not.toHaveBeenCalled();
    expect(mocks.db.statusNote.create).not.toHaveBeenCalled();
  });

  it("returns false when there are no samples or when a sample has no assigned file", async () => {
    mocks.db.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      status: "SUBMITTED",
      samples: [],
    });

    await expect(checkAndCompleteOrder("order-1")).resolves.toBe(false);

    mocks.db.order.findUnique.mockResolvedValueOnce({
      id: "order-1",
      status: "SUBMITTED",
      samples: [
        { reads: [{ file1: "/tmp/sample-1.fastq.gz" }] },
        { reads: [{ file1: null }] },
      ],
    });

    await expect(checkAndCompleteOrder("order-1")).resolves.toBe(false);
    expect(mocks.db.order.update).not.toHaveBeenCalled();
  });

  it("marks the order completed and writes a status note once every sample has files", async () => {
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "SUBMITTED",
      samples: [
        { reads: [{ file1: "/tmp/sample-1.fastq.gz" }] },
        { reads: [{ file1: null }, { file1: "/tmp/sample-2.fastq.gz" }] },
      ],
    });

    await expect(checkAndCompleteOrder("order-1")).resolves.toBe(true);

    expect(mocks.db.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        status: "COMPLETED",
        statusUpdatedAt: new Date("2026-03-18T12:00:00.000Z"),
      },
    });
    expect(mocks.db.statusNote.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-1",
        noteType: "STATUS_CHANGE",
        content: "Automatically completed - all samples have sequencing files",
      },
    });
  });
});
