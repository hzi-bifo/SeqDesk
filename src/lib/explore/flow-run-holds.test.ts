import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(), existing: vi.fn(), create: vi.fn(), list: vi.fn(), remove: vi.fn(), check: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  exploreFlowRun: { findUnique: mocks.run },
  exploreRunHold: { findUnique: mocks.existing, create: mocks.create, findMany: mocks.list, deleteMany: mocks.remove },
} }));
vi.mock("./conversation", () => ({ appendCheckTurn: mocks.check }));
import { addHold, removeHold } from "./flow-runs";

const actor = { userId: "user-1", memberId: "member-1" };
const paper = 'writer:["workspace-1","document-1"]';

describe("Writer run holds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.run.mockResolvedValue({ status: "completed", kind: "full" });
    mocks.existing.mockResolvedValue(null);
    mocks.list.mockResolvedValue([]);
  });

  it("persists a paper hold and retries without creating another hold", async () => {
    const row = { id: "hold-1", kind: "writer", key: paper, memberId: actor.memberId, createdAt: new Date("2026-09-26T12:00:00Z") };
    mocks.list.mockResolvedValue([row]);
    expect(await addHold("run-1", "writer", paper, actor)).toEqual([{ ...row, createdAt: row.createdAt.toISOString() }]);
    expect(mocks.create).toHaveBeenCalledWith({ data: { flowRunId: "run-1", kind: "writer", key: paper, memberId: "member-1", createdById: "user-1" } });
    mocks.existing.mockResolvedValue({ id: row.id });
    await addHold("run-1", "writer", paper, actor);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("keeps workspace and document identities distinct and removes only the named hold", async () => {
    for (const key of [paper, 'writer:["workspace-2","document-1"]', 'writer:["workspace-1","document-2"]']) {
      await addHold("run-1", "writer", key, actor);
      expect(mocks.existing).toHaveBeenLastCalledWith({ where: { flowRunId_kind_key: { flowRunId: "run-1", kind: "writer", key } }, select: { id: true } });
    }
    await removeHold("run-1", "writer", paper);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { flowRunId: "run-1", kind: "writer", key: paper } });
  });

  it.each([
    'writer:', 'writer:null', 'writer:{}', 'writer:["workspace"]',
    'writer:["workspace","document","extra"]', 'writer:[null,"document"]',
    'writer:["workspace",2]', 'writer:["","document"]', 'writer:["workspace","  "]',
    'writer: ["workspace","document"]', 'writer:["workspace", "document"]',
    'writer:["workspace","document"]trailing', `writer:${JSON.stringify(["workspace", "x".repeat(2048)])}`,
    'labdesk://value/other/step/metric', 'labdesk://output/other/step/figure',
  ])("rejects malformed or foreign-run keys: %s", async key => {
    await expect(addHold("run-1", "writer", key, actor)).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("preserves value, output and check holds", async () => {
    await addHold("run-1", "writer", "labdesk://value/run-1/step/metric", actor);
    await addHold("run-1", "writer", "labdesk://output/run-1/step/figure", actor);
    await addHold("run-1", "check", "labdesk://run/run-1", actor);
    expect(mocks.create).toHaveBeenCalledTimes(3);
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith("run-1", "labdesk://run/run-1", actor);
  });

  it("refuses missing and trial runs", async () => {
    mocks.run.mockResolvedValue(null);
    await expect(addHold("missing", "writer", paper, actor)).rejects.toMatchObject({ code: "not_found" });
    mocks.run.mockResolvedValue({ status: "completed", kind: "trial" });
    await expect(addHold("trial", "writer", paper, actor)).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("tolerates a concurrent duplicate but surfaces storage failures", async () => {
    mocks.create.mockRejectedValueOnce({ code: "P2002" });
    await expect(addHold("run-1", "writer", paper, actor)).resolves.toEqual([]);
    mocks.create.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(addHold("run-1", "writer", paper, actor)).rejects.toThrow("database unavailable");
  });
});
