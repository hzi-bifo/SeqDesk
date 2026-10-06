import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";

const mocks = vi.hoisted(() => ({ flowFind: vi.fn(), analysisCount: vi.fn(), deleteFlow: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreFlow: { findUnique: mocks.flowFind }, exploreAnalysis: { count: mocks.analysisCount } } }));
vi.mock("./flows", () => ({ createFlow: vi.fn(async () => { throw new Error("must not create"); }), deleteFlow: mocks.deleteFlow }));

import { createFlowFromTemplate } from "./templates";

const base = { targetKey: "project:p1", templateId: "rnaseq-deseq2", slots: {}, actor: { userId: "u1" }, requestId: "flow_abcdefghijklmnop1234" };

describe("flows/from-template idempotency", () => {
  beforeEach(() => { process.env.SEQDESK_EXPLORE_TEMPLATES_DIR = path.join(process.cwd(), "explore", "templates"); vi.clearAllMocks(); });
  afterEach(() => { delete process.env.SEQDESK_EXPLORE_TEMPLATES_DIR; });

  it("returns the flow a finished request already made instead of a second analysis", async () => {
    mocks.flowFind.mockResolvedValue({ id: base.requestId, targetKey: "project:p1", createdById: "u1" });
    mocks.analysisCount.mockResolvedValue(4);
    await expect(createFlowFromTemplate(base)).resolves.toBe(base.requestId);
    expect(mocks.deleteFlow).not.toHaveBeenCalled();
  });

  it("refuses a request id that belongs to another study or person", async () => {
    mocks.flowFind.mockResolvedValue({ id: base.requestId, targetKey: "project:other", createdById: "u1" });
    await expect(createFlowFromTemplate(base)).rejects.toThrow(/another analysis/);
    mocks.flowFind.mockResolvedValue({ id: base.requestId, targetKey: "project:p1", createdById: "u2" });
    await expect(createFlowFromTemplate(base)).rejects.toThrow(/another analysis/);
  });

  it("clears a flow a crash left without steps before making it again", async () => {
    mocks.flowFind.mockResolvedValue({ id: base.requestId, targetKey: "project:p1", createdById: "u1" });
    mocks.analysisCount.mockResolvedValue(0);
    // No table is given, so the retry stops at validation after the empty flow is cleared.
    await expect(createFlowFromTemplate(base)).rejects.toBeTruthy();
    expect(mocks.deleteFlow).toHaveBeenCalledWith(base.requestId);
  });
});
