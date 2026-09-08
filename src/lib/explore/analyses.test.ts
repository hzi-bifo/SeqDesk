import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    exploreAnalysis: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    exploreAnalysisRevision: { create: vi.fn(), findUnique: vi.fn() },
    exploreAnalysisRun: { findFirst: vi.fn() },
  },
  getKit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("./kits/loader", () => ({ getKit: mocks.getKit }));

import { allocateRunNumber, createAnalysis, createRevision, parseInputBindings } from "./analyses";

describe("explore analyses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.exploreAnalysis.create.mockResolvedValue({ id: "a1" });
    mocks.db.exploreAnalysis.update.mockResolvedValue({});
    mocks.db.exploreAnalysisRevision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "r1", createdAt: new Date(), ...data }));
    mocks.db.exploreAnalysis.findUnique.mockResolvedValue({
      id: "a1",
      targetKey: "study:s1",
      name: "Table summary",
      description: null,
      kitId: "table-summary",
      language: "python",
      environmentName: "seqdesk-explore-python",
      currentRevisionId: "r1",
      createdAt: new Date(),
      updatedAt: new Date(),
      revisions: [{ id: "r1", number: 1, code: "print(1)", params: '{"top":5}', inputs: '[{"alias":"table","datasetId":"d1","versionId":null}]', author: "user", authorUserId: "u1", message: null, prompt: null, createdAt: new Date() }],
      runs: [],
    });
  });

  it("creates an analysis from a kit with the kit code and default params", async () => {
    mocks.getKit.mockResolvedValue({
      manifest: { id: "table-summary", name: "Table summary", description: "d", language: "python", environment: "seqdesk-explore-python", params: { type: "object", properties: { top: { type: "integer", default: 5 } } } },
      code: "print('kit')",
    });
    const analysis = await createAnalysis({ targetKey: "study:s1", kitId: "table-summary", inputs: [{ alias: "table", datasetId: "d1", versionId: null }], params: { extra: true }, createdById: "u1" });
    expect(mocks.db.exploreAnalysis.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kitId: "table-summary", language: "python", environmentName: "seqdesk-explore-python", createdById: "u1" }) }));
    const revision = mocks.db.exploreAnalysisRevision.create.mock.calls[0][0].data;
    expect(revision.code).toBe("print('kit')");
    expect(JSON.parse(revision.params)).toEqual({ top: 5, extra: true });
    expect(revision.number).toBe(1);
    expect(analysis.currentRevision?.inputs).toEqual([{ alias: "table", datasetId: "d1", versionId: null }]);
  });

  it("rejects unknown kits and falls back to a blank script without a kit", async () => {
    mocks.getKit.mockResolvedValue(null);
    await expect(createAnalysis({ targetKey: "study:s1", kitId: "nope", inputs: [], createdById: "u1" })).rejects.toThrow(/Unknown kit/);
    await createAnalysis({ targetKey: "study:s1", inputs: [], createdById: "u1" });
    expect(mocks.db.exploreAnalysisRevision.create.mock.calls[0][0].data.code).toMatch(/seqdesk_explore/);
  });

  it("creates revisions that inherit unchanged code, params and inputs", async () => {
    mocks.db.exploreAnalysisRevision.findUnique.mockResolvedValue({ id: "r1", number: 1, code: "print(1)", params: '{"top":5}', inputs: '[{"alias":"table","datasetId":"d1","versionId":null}]' });
    const revision = await createRevision({ analysisId: "a1", params: { top: 9 }, author: "agent", authorUserId: "u1", prompt: "make it faster" });
    const data = mocks.db.exploreAnalysisRevision.create.mock.calls[0][0].data;
    expect(data.number).toBe(2);
    expect(data.code).toBe("print(1)");
    expect(JSON.parse(data.params)).toEqual({ top: 9 });
    expect(JSON.parse(data.inputs)).toEqual([{ alias: "table", datasetId: "d1", versionId: null }]);
    expect(data.author).toBe("agent");
    expect(revision.prompt).toBe("make it faster");
    expect(mocks.db.exploreAnalysis.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { currentRevisionId: "r1" } });
  });

  it("allocates daily run numbers", async () => {
    mocks.db.exploreAnalysisRun.findFirst.mockResolvedValue({ runNumber: "EXP-20260904-007" });
    const number = await allocateRunNumber();
    expect(number).toMatch(/^EXP-\d{8}-008$/);
    mocks.db.exploreAnalysisRun.findFirst.mockResolvedValue(null);
    expect(await allocateRunNumber()).toMatch(/^EXP-\d{8}-001$/);
  });

  it("parses input bindings defensively", () => {
    expect(parseInputBindings('[{"alias":"a","datasetId":"d"},{"alias":"","datasetId":"x"},5]')).toEqual([{ alias: "a", datasetId: "d", versionId: null }]);
    expect(parseInputBindings("not json")).toEqual([]);
  });
});
