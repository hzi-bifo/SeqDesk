import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ db: { exploreDataset: { findMany: (...args: unknown[]) => findMany(...args) }, exploreDatasetVersion: { findUnique: vi.fn() } } }));

import { listDatasets } from "./datasets";

const row = (id: string, name: string, contentHash: string, rowCount: number) => ({
  id, targetKey: "project:p1", kind: "external", tableKind: null, name, description: null, sensitivity: "standard", roles: null, sourceConfig: null,
  sourceFileId: null, currentVersionId: `${id}-v1`, createdById: "u1", createdAt: new Date("2026-09-28T10:00:00Z"), updatedAt: new Date("2026-09-28T10:00:00Z"),
  versions: [{ id: `${id}-v1`, number: 1, rowCount, contentHash, schema: JSON.stringify({ columns: [] }), provenance: JSON.stringify({ profileChecked: 99 }), createdAt: new Date("2026-09-28T10:00:00Z"), buildSource: "import" }],
});

describe("listDatasets", () => {
  beforeEach(() => findMany.mockReset());

  it("leaves out a table whose import is still running", async () => {
    findMany.mockResolvedValue([row("d1", "counts", "abc123", 10), row("d2", "importing", "pending", 0)]);
    const listed = await listDatasets("project:p1");
    expect(listed.map((dataset) => dataset.name)).toEqual(["counts"]);
  });
});
