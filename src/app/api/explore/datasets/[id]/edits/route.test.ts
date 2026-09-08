import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isExploreModuleEnabled: vi.fn(),
  requireTargetAccess: vi.fn(),
  getDatasetRecord: vi.fn(),
  createEdit: vi.fn(),
  listAllEdits: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.isExploreModuleEnabled }));
vi.mock("@/lib/explore/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/authorization")>("@/lib/explore/authorization");
  return { ...actual, requireTargetAccess: mocks.requireTargetAccess };
});
vi.mock("@/lib/explore/datasets", () => ({ getDatasetRecord: mocks.getDatasetRecord }));
vi.mock("@/lib/explore/edits", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/edits")>("@/lib/explore/edits");
  return { ...actual, createEdit: mocks.createEdit, listAllEdits: mocks.listAllEdits };
});
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ id: "d1" }) };

describe("/api/explore/datasets/[id]/edits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isExploreModuleEnabled.mockResolvedValue(true);
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1", role: "RESEARCHER" } });
    mocks.requireTargetAccess.mockResolvedValue({ type: "study", id: "s1" });
    mocks.getDatasetRecord.mockResolvedValue({ id: "d1", targetKey: "study:s1", versions: [] });
    mocks.listAllEdits.mockResolvedValue([]);
    mocks.createEdit.mockImplementation(async (input: unknown) => ({ id: "e1", ...(input as object) }));
  });

  it("404s for unknown datasets", async () => {
    mocks.getDatasetRecord.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost"), context)).status).toBe(404);
  });

  it("lists edits with read access", async () => {
    const response = await GET(new NextRequest("http://localhost"), context);
    expect(response.status).toBe(200);
    expect(mocks.requireTargetAccess).toHaveBeenCalledWith(expect.anything(), "study:s1", "read");
  });

  it("validates and creates a cell edit with write access", async () => {
    const bad = await POST(
      new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ kind: "cell", target: { rowKey: "s:S1" } }) }),
      context
    );
    expect(bad.status).toBe(400);

    const ok = await POST(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ kind: "cell", target: { rowKey: "s:S1|k:562", column: "reads" }, value: { value: 12 }, reason: "typo" }),
      }),
      context
    );
    expect(ok.status).toBe(201);
    expect(mocks.requireTargetAccess).toHaveBeenLastCalledWith(expect.anything(), "study:s1", "write");
    expect(mocks.createEdit).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: "d1", kind: "cell", target: { rowKey: "s:S1|k:562", column: "reads" }, value: { value: 12 }, reason: "typo", createdById: "user-1" })
    );
  });
});
