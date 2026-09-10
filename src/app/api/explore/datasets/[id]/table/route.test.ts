import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(), isExploreModuleEnabled: vi.fn(), requireTargetAccess: vi.fn(),
  getDatasetRecord: vi.fn(), fetchAllDatasetRows: vi.fn(), listActiveEdits: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.isExploreModuleEnabled }));
vi.mock("@/lib/explore/authorization", async () => ({
  ...await vi.importActual<typeof import("@/lib/explore/authorization")>("@/lib/explore/authorization"),
  requireTargetAccess: mocks.requireTargetAccess,
}));
vi.mock("@/lib/explore/datasets", () => ({ getDatasetRecord: mocks.getDatasetRecord, fetchAllDatasetRows: mocks.fetchAllDatasetRows }));
vi.mock("@/lib/explore/edits", () => ({ listActiveEdits: mocks.listActiveEdits, applyEditsToRows: (rows: unknown[]) => rows }));

import { ExploreAuthorizationError } from "@/lib/explore/authorization";
import { GET } from "./route";

const columns = [
  { key: "label", label: "Specimen", type: "string", role: "sample" },
  { key: "reading", label: "Signal", type: "number", unit: "mV", role: "value" },
];
const context = { params: Promise.resolve({ id: "measurements" }) };
const request = () => new NextRequest("http://localhost/api/explore/datasets/measurements/table?limit=1");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isExploreModuleEnabled.mockResolvedValue(true);
  mocks.getServerSession.mockResolvedValue({ user: { id: "user-1", role: "RESEARCHER" } });
  mocks.requireTargetAccess.mockResolvedValue({ type: "study", id: "s1" });
  mocks.getDatasetRecord.mockResolvedValue({ id: "measurements", targetKey: "study:s1", currentVersionId: "v2", versions: [
    { id: "v1", number: 1, schema: JSON.stringify({ columns, rowEntity: "old-meaning" }) },
    { id: "v2", number: 2, schema: JSON.stringify({ columns, rowEntity: "specimen-timepoint" }) },
  ] });
  mocks.fetchAllDatasetRows.mockResolvedValue([{ data: { label: "A", reading: 0 } }, { data: { label: "B", reading: null } }]);
  mocks.listActiveEdits.mockResolvedValue([]);
});

describe("saved table chart context", () => {
  it("returns row meaning, labels and units from the current version with bounded rows", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ datasetId: "measurements", version: 2, rowEntity: "specimen-timepoint", columns,
      rows: [{ label: "A", reading: 0 }], total: 2, truncated: true });
    expect(mocks.requireTargetAccess).toHaveBeenCalledWith(expect.anything(), "study:s1", "read");
    expect(mocks.fetchAllDatasetRows).toHaveBeenCalledWith("v2");
  });

  it("keeps older tables usable without inventing a row meaning", async () => {
    mocks.getDatasetRecord.mockResolvedValue({ id: "measurements", targetKey: "study:s1", currentVersionId: "v1",
      versions: [{ id: "v1", number: 1, schema: JSON.stringify({ columns }) }] });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("rowEntity");
  });

  it("requires a session before loading saved metadata", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    expect((await GET(request(), context)).status).toBe(401);
    expect(mocks.getDatasetRecord).not.toHaveBeenCalled();
    expect(mocks.fetchAllDatasetRows).not.toHaveBeenCalled();
  });

  it("does not expose rows or schema to another scope", async () => {
    mocks.requireTargetAccess.mockRejectedValue(new ExploreAuthorizationError(404, "Not found"));
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(mocks.fetchAllDatasetRows).not.toHaveBeenCalled();
    expect(mocks.listActiveEdits).not.toHaveBeenCalled();
  });
});
