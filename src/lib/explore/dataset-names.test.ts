import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ db: { exploreDataset: { findMany: (...args: unknown[]) => findMany(...args) } } }));

import { freeImportName } from "./datasets";

describe("freeImportName", () => {
  beforeEach(() => findMany.mockReset());

  it("keeps a free name and numbers a taken one, ignoring case", async () => {
    findMany.mockResolvedValue([{ name: "Counts" }, { name: "counts (2)" }, { name: "other" }]);
    expect(await freeImportName("project:p1", "fresh")).toBe("fresh");
    expect(await freeImportName("project:p1", "counts")).toBe("counts (3)");
    expect(await freeImportName("project:p1", "  ")).toBe("Untitled dataset");
    expect(findMany).toHaveBeenCalledWith({ where: { targetKey: "project:p1", kind: "external" }, select: { name: true } });
  });

  it("stays within the name limit when numbering a long name", async () => {
    const long = "x".repeat(200);
    findMany.mockResolvedValue([{ name: long }]);
    const next = await freeImportName("project:p1", long);
    expect(next.length).toBeLessThanOrEqual(200);
    expect(next.endsWith(" (2)")).toBe(true);
  });
});
