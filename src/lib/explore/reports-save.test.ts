import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    exploreReport: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { saveReport } from "./reports";

const input = { title: "Cohort", blocks: [{ id: "t1", type: "text", markdown: "Hello" }], filters: [] };

describe("saving a page against the version the editor saw", () => {
  beforeEach(() => {
    mocks.db.exploreReport.findUnique.mockReset();
    mocks.db.exploreReport.updateMany.mockReset();
    mocks.db.exploreReport.findUnique.mockResolvedValue({ id: "r1", updatedAt: new Date("2026-09-06T10:00:00.000Z") });
  });

  it("writes only where the stored version matches, and answers 409 when it does not", async () => {
    mocks.db.exploreReport.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveReport("r1", { ...input, expectedUpdatedAt: "2026-09-06T09:00:00.000Z" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.exploreReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", updatedAt: new Date("2026-09-06T09:00:00.000Z") } }));
  });

  it("refuses a version that is not a date and a page it cannot find", async () => {
    await expect(saveReport("r1", { ...input, expectedUpdatedAt: "yesterday" })).rejects.toMatchObject({ status: 400 });
    mocks.db.exploreReport.findUnique.mockResolvedValue(null);
    await expect(saveReport("nope", input)).rejects.toMatchObject({ status: 404 });
    expect(mocks.db.exploreReport.updateMany).not.toHaveBeenCalled();
  });
});
