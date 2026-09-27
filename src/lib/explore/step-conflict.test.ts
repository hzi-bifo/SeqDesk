import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ analysisFind: vi.fn(), revisionFindMany: vi.fn(), userFindMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreAnalysis: { findUnique: mocks.analysisFind }, exploreAnalysisRevision: { findMany: mocks.revisionFindMany }, user: { findMany: mocks.userFindMany } } }));

import { packagesConflictError, stepConflictError } from "./step-conflict";

const revision = (id: string, number: number, params: Record<string, unknown>, code: string, authorUserId: string) => ({
  id, analysisId: "step-1", number, params: JSON.stringify(params), code, inputs: "[]", message: `rev ${number}`, createdAt: new Date(`2026-09-27T10:0${number}:00Z`), authorUserId,
});

describe("step conflicts", () => {
  beforeEach(() => {
    mocks.analysisFind.mockResolvedValue({ currentRevisionId: "rev-3" });
    mocks.revisionFindMany.mockResolvedValue([revision("rev-2", 2, { lfc_cutoff: 1 }, "a <- 1\n", "u-me"), revision("rev-3", 3, { lfc_cutoff: 1.5 }, "a <- 2\n", "u-anna")]);
    mocks.userFindMany.mockResolvedValue([{ id: "u-anna", firstName: "Anna", lastName: "Berg" }, { id: "u-me", firstName: "Me", lastName: "" }]);
  });

  it("names the revision the save was based on and the one that replaced it", async () => {
    const error = await stepConflictError("step-1", "rev-2", "This step changed in another session.");
    expect(error.status).toBe(409);
    expect(error.code).toBe("step_conflict");
    expect(error.extra).toMatchObject({
      stepId: "step-1",
      base: { id: "rev-2", number: 2, params: { lfc_cutoff: 1 }, code: "a <- 1\n", by: { name: "Me" } },
      current: { id: "rev-3", number: 3, params: { lfc_cutoff: 1.5 }, code: "a <- 2\n", by: { name: "Anna Berg" }, createdAt: "2026-09-27T10:03:00.000Z" },
    });
    // Only this step's revisions are read.
    expect(mocks.revisionFindMany).toHaveBeenCalledWith({ where: { analysisId: "step-1", id: { in: ["rev-2", "rev-3"] } } });
  });

  it("keeps a missing base as null and an unknown author as Someone", async () => {
    mocks.revisionFindMany.mockResolvedValue([revision("rev-3", 3, {}, "", "u-gone")]);
    mocks.userFindMany.mockResolvedValue([]);
    const error = await stepConflictError("step-1", "rev-x", "changed");
    expect(error.extra).toMatchObject({ base: null, current: { by: { name: "Someone" } } });
  });

  it("returns the packages now on the step", () => {
    const error = packagesConflictError("step-1", { packages: ["r-ggplot2"], channels: [] });
    expect(error.status).toBe(409);
    expect(error.extra).toEqual({ stepId: "step-1", packages: { packages: ["r-ggplot2"], channels: [] } });
  });
});
