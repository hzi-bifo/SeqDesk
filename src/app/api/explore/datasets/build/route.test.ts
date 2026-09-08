import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isExploreModuleEnabled: vi.fn(),
  requireTargetAccess: vi.fn(),
  buildDataset: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.isExploreModuleEnabled }));
vi.mock("@/lib/explore/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/authorization")>("@/lib/explore/authorization");
  return { ...actual, requireTargetAccess: mocks.requireTargetAccess };
});
vi.mock("@/lib/explore/build", () => ({ buildDataset: mocks.buildDataset }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "./route";
import { ExploreBuildInputError } from "@/lib/explore/builders/types";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/explore/datasets/build", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/explore/datasets/build", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isExploreModuleEnabled.mockResolvedValue(true);
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1", role: "FACILITY_ADMIN" } });
    mocks.requireTargetAccess.mockResolvedValue({ type: "study", id: "s1" });
    mocks.buildDataset.mockResolvedValue({
      dataset: { id: "d1" },
      version: { versionId: "v1", number: 1, rowCount: 3, contentHash: "abc", unchanged: false },
      warnings: [],
    });
  });

  it("rejects kinds that cannot be built", async () => {
    const response = await POST(request({ targetKey: "study:s1", kind: "external" }));
    expect(response.status).toBe(400);
    expect(mocks.buildDataset).not.toHaveBeenCalled();
  });

  it("builds with write access and passes the admin flag", async () => {
    const response = await POST(request({ targetKey: "study:s1", kind: "pipeline-table", options: { pipelineId: "metaxpath", outputId: "sample_profile" } }));
    expect(response.status).toBe(201);
    expect(mocks.requireTargetAccess).toHaveBeenCalledWith(expect.anything(), "study:s1", "write");
    expect(mocks.buildDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "pipeline-table",
        options: { pipelineId: "metaxpath", outputId: "sample_profile" },
        createdById: "user-1",
        context: expect.objectContaining({ targetKey: "study:s1", isFacilityAdmin: true }),
      })
    );
  });

  it("answers 200 when nothing changed and 404 when there is nothing to build", async () => {
    mocks.buildDataset.mockResolvedValueOnce({ dataset: { id: "d1" }, version: { unchanged: true, rowCount: 3 }, warnings: [] });
    expect((await POST(request({ targetKey: "study:s1", kind: "samples" }))).status).toBe(200);
    mocks.buildDataset.mockResolvedValueOnce(null);
    expect((await POST(request({ targetKey: "study:s1", kind: "samples" }))).status).toBe(404);
  });

  it("turns builder validation errors into 400", async () => {
    mocks.buildDataset.mockRejectedValueOnce(new Error("pipelineId and outputId are required for a pipeline table"));
    const response = await POST(request({ targetKey: "study:s1", kind: "pipeline-table" }));
    expect(response.status).toBe(400);
  });

  it("derives the builder identity from the session, not client-supplied scope flags", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "owner", role: "FACILITY_ADMIN", systemRole: "ADMIN", facilityWorkflowRole: "REQUESTER" } });
    const response = await POST(request({ targetKey: "study:s1", kind: "samples", userId: "foreign", installation: true,
      options: { userId: "foreign", installation: true, isFacilityAdmin: true } }));
    expect(response.status).toBe(201);
    expect(mocks.buildDataset).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({
      userId: "owner", installation: false, isFacilityAdmin: false,
    }) }));
  });

  it("returns actionable input errors and rejects invalidated sessions before building", async () => {
    mocks.buildDataset.mockRejectedValueOnce(new ExploreBuildInputError("Check the sample labels"));
    const response = await POST(request({ targetKey: "study:s1", kind: "pipeline-table" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Check the sample labels" });
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1", role: "FACILITY_ADMIN", authorizationValid: false } });
    expect((await POST(request({ targetKey: "study:s1", kind: "samples" }))).status).toBe(401);
    expect(mocks.buildDataset).toHaveBeenCalledTimes(1);
  });
});
