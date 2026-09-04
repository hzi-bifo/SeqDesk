import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isExploreModuleEnabled: vi.fn(),
  requireTargetAccess: vi.fn(),
  listDatasets: vi.fn(),
  createDataset: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.isExploreModuleEnabled }));
vi.mock("@/lib/explore/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/authorization")>("@/lib/explore/authorization");
  return { ...actual, requireTargetAccess: mocks.requireTargetAccess };
});
vi.mock("@/lib/explore/datasets", () => ({
  listDatasets: mocks.listDatasets,
  createDataset: mocks.createDataset,
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { ExploreAuthorizationError } from "@/lib/explore/authorization";
import { GET, POST } from "./route";

describe("/api/explore/datasets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isExploreModuleEnabled.mockResolvedValue(true);
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1", role: "RESEARCHER" } });
    mocks.requireTargetAccess.mockResolvedValue({ type: "study", id: "s1" });
    mocks.listDatasets.mockResolvedValue([{ id: "d1" }]);
    mocks.createDataset.mockResolvedValue({ id: "d2" });
  });

  it("lists datasets of an accessible scope", async () => {
    const response = await GET(new NextRequest("http://localhost/api/explore/datasets?targetKey=study:s1"));
    expect(response.status).toBe(200);
    expect(mocks.requireTargetAccess).toHaveBeenCalledWith(expect.anything(), "study:s1", "read");
    expect(await response.json()).toEqual({ datasets: [{ id: "d1" }] });
  });

  it("maps authorization failures to their status", async () => {
    mocks.requireTargetAccess.mockRejectedValue(new ExploreAuthorizationError(404, "Not found"));
    const response = await GET(new NextRequest("http://localhost/api/explore/datasets?targetKey=study:other"));
    expect(response.status).toBe(404);
  });

  it("validates the kind before creating", async () => {
    const bad = await POST(
      new NextRequest("http://localhost/api/explore/datasets", {
        method: "POST",
        body: JSON.stringify({ targetKey: "study:s1", kind: "nope", name: "x" }),
      })
    );
    expect(bad.status).toBe(400);
    expect(mocks.createDataset).not.toHaveBeenCalled();

    const ok = await POST(
      new NextRequest("http://localhost/api/explore/datasets", {
        method: "POST",
        body: JSON.stringify({ targetKey: "study:s1", kind: "external", name: "Imported", tableKind: "taxon-profile-long" }),
      })
    );
    expect(ok.status).toBe(201);
    expect(mocks.requireTargetAccess).toHaveBeenCalledWith(expect.anything(), "study:s1", "write");
    expect(mocks.createDataset).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "external", name: "Imported", tableKind: "taxon-profile-long", createdById: "user-1" })
    );
  });
});
