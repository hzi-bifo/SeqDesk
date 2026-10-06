import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ analysisFind: vi.fn(), revisionFind: vi.fn(), updateMany: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreAnalysis: { findUnique: mocks.analysisFind }, exploreAnalysisRevision: { findUnique: mocks.revisionFind }, exploreStepProposal: { updateMany: mocks.updateMany, create: mocks.create } } }));

import { acceptedMethodsSentence, methodsAcceptedBy, parseMethodsDraft, saveMethodsDraft } from "./methods-draft";

describe("methods drafts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates the draft: text, parameter tokens, prompt and notes", () => {
    expect(parseMethodsDraft({ text: " Kept genes with padj below {padj_cutoff}. ", tokens: [{ key: "padj_cutoff", value: 0.05 }], prompt: "p", notVerified: ["DESeq2 1.2 is not in the lock"], model: "m" }))
      .toEqual({ text: "Kept genes with padj below {padj_cutoff}.", tokens: [{ key: "padj_cutoff", value: 0.05 }], prompt: "p", model: "m", notVerified: ["DESeq2 1.2 is not in the lock"] });
    expect(() => parseMethodsDraft({ text: "" })).toThrow(/needs text/);
    expect(() => parseMethodsDraft({ text: "x", tokens: [{ key: "a b" }] })).toThrow(/parameter key/);
    expect(parseMethodsDraft({ text: "x", tokens: [{ key: "genes", value: ["A", "B"] }] }).tokens).toEqual([{ key: "genes", value: ["A", "B"] }]);
    expect(() => parseMethodsDraft({ text: "x", tokens: [{ key: "a", value: "v".repeat(3000) }] })).toThrow(/too large/);
    expect(() => parseMethodsDraft({ text: "x".repeat(1001) })).toThrow(/too long/);
    expect(() => parseMethodsDraft({ text: "x", prompt: "p".repeat(12001) })).toThrow(/prompt/);
  });

  it("keeps one open draft per step with the revision and code it describes", async () => {
    mocks.analysisFind.mockResolvedValue({ id: "a1", flowId: "f1", currentRevisionId: "rev3" });
    mocks.revisionFind.mockResolvedValue({ codeHash: "abc" });
    mocks.create.mockImplementation(async ({ data }) => ({ id: "pm1", createdAt: new Date(0), updatedAt: new Date(0), ...data }));
    const saved = await saveMethodsDraft("a1", { text: "t", tokens: [{ key: "k", value: 1 }], prompt: "p", model: null, notVerified: [] }, { userId: "u1", memberId: "m1" });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { flowId: "f1", kind: "methods", state: "pending", analysisId: "a1" }, data: { state: "discarded", discardReason: "Drafted again" } });
    expect(saved).toMatchObject({ id: "pm1", kind: "methods", state: "pending", analysisId: "a1", text: "t", values: { tokens: [{ key: "k", value: 1 }], prompt: "p", revisionId: "rev3", codeHash: "abc", author: "assistant" } });
    mocks.analysisFind.mockResolvedValue({ id: "a2", flowId: null, currentRevisionId: null });
    await expect(saveMethodsDraft("a2", { text: "t", tokens: [], prompt: "", model: null, notVerified: [] }, { userId: "u1" })).rejects.toThrow(/not part/);
  });

  it("an accepted draft keeps the draft's revision, tokens and prompt; older token lists still work", () => {
    expect(acceptedMethodsSentence({ tokens: [{ key: "k", value: 2 }], revisionId: "rev3", codeHash: "abc", prompt: "p", notVerified: ["n"] }, "t", "rev4", "u1"))
      .toMatchObject({ text: "t", tokens: [{ key: "k", value: 2 }], revisionId: "rev3", codeHash: "abc", prompt: "p", notVerified: ["n"], author: "assistant", acceptedById: "u1" });
    expect(acceptedMethodsSentence([{ key: "x" }], "t", "rev4", "u1")).toMatchObject({ tokens: [{ key: "x" }], revisionId: "rev4" });
  });

  it("keeps who accepted the words: their member and name beside acceptedById and acceptedAt", () => {
    const accepted = acceptedMethodsSentence({ tokens: [] }, "t", "rev4", "u1", { memberId: "m-amara", name: " Amara Okafor " }) as Record<string, unknown>;
    expect(accepted).toMatchObject({ author: "assistant", acceptedById: "u1", acceptedByMemberId: "m-amara", acceptedByName: "Amara Okafor" });
    expect(Number.isNaN(Date.parse(String(accepted.acceptedAt)))).toBe(false);
    // An actor without a member or name (older routes) stores neither key.
    expect(acceptedMethodsSentence({ tokens: [] }, "t", "rev4", "u1", { memberId: null })).not.toHaveProperty("acceptedByMemberId");
    expect(methodsAcceptedBy({ memberId: "", name: "  " })).toEqual({});
    expect(methodsAcceptedBy({ name: "x".repeat(300) }).acceptedByName).toHaveLength(200);
  });
});
