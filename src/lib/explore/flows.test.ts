import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreFlow: { findMany: mocks.findMany, findUnique: mocks.findUnique, create: mocks.create, count: mocks.count, update: mocks.update, delete: mocks.delete } } }));
import { createFlow, deleteFlow, listFlows, updateFlow } from "./flows";

const at = (iso: string) => new Date(iso);
const results = (value: unknown) => JSON.stringify(value);

describe("flows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("summarises each flow: steps, the run that matters, and what the latest finished runs produced", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "f1", targetKey: "project:p1", name: "Diversity", description: null, createdAt: at("2026-09-17T08:00:00Z"), updatedAt: at("2026-09-17T09:00:00Z"),
      analyses: [
        { id: "a1", runs: [
          { runNumber: "EXP-3", status: "failed", completedAt: at("2026-09-17T09:00:00Z"), createdAt: at("2026-09-17T08:59:00Z"), results: null },
          { runNumber: "EXP-2", status: "completed", completedAt: at("2026-09-17T08:30:00Z"), createdAt: at("2026-09-17T08:29:00Z"), results: results({ figures: 2, tables: [{}], reports: 1, notes: ["n"], metrics: { a: 1, b: 2 } }) },
        ] },
        { id: "a2", runs: [{ runNumber: "EXP-4", status: "running", completedAt: null, createdAt: at("2026-09-17T08:00:00Z"), results: null }] },
        { id: "a3", runs: [] },
      ],
    }]);
    const [flow] = await listFlows("project:p1");
    expect(flow).toMatchObject({ id: "f1", name: "Diversity", stepCount: 3, outputs: { figures: 2, tables: 1, findings: 2, metrics: 2 } });
    expect(flow.latestRun).toEqual({ runNumber: "EXP-4", status: "running", completedAt: null }); // a running step wins over a newer failed one
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ targetKey: "project:p1" });
  });

  it("numbers unnamed flows and validates renames", async () => {
    mocks.count.mockResolvedValue(2);
    mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: "f3", description: data.description, createdAt: at("2026-09-17T08:00:00Z"), updatedAt: at("2026-09-17T08:00:00Z"), analyses: [] }));
    expect((await createFlow("project:p1", "u1", null, "  ")).name).toBe("Flow 3");
    expect((await createFlow("project:p1", "u1", "  Alpha diversity ", "Compare groups")).name).toBe("Alpha diversity");
    expect(mocks.create.mock.calls[1][0].data).toMatchObject({ targetKey: "project:p1", createdById: "u1", description: "Compare groups" });
    mocks.findUnique.mockResolvedValue({ id: "f3" });
    await expect(updateFlow("f3", { name: "   " })).rejects.toMatchObject({ status: 400 });
    mocks.findUnique.mockResolvedValue(null);
    await expect(deleteFlow("missing")).rejects.toMatchObject({ status: 404 });
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
