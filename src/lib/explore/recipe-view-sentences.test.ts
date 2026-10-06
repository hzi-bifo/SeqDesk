import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ users: vi.fn(), accounts: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: mocks.users }, integrationAccount: { findMany: mocks.accounts } } }));

import { methodsSentencePeople, methodsSentenceView } from "./recipe-view";

describe("In words by-line in the recipe view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends who last wrote or accepted a sentence; stored member and name win", async () => {
    const stored = { text: "t", author: "person", acceptedById: "u1", acceptedAt: "2026-10-12T09:00:00.000Z", acceptedByMemberId: "m-amara", acceptedByName: "Amara Okafor" };
    const people = await methodsSentencePeople([stored, null]);
    // Nothing to look up when the sentence already says who.
    expect(mocks.users).not.toHaveBeenCalled();
    expect(methodsSentenceView(stored, people)).toEqual({ ...stored, acceptedBy: { id: "u1", memberId: "m-amara", name: "Amara Okafor" } });
    expect(methodsSentenceView(null, people)).toBeNull();
  });

  it("finds the person of an older sentence from acceptedById: lab membership and SeqDesk name", async () => {
    mocks.users.mockResolvedValue([{ id: "u2", firstName: "Tomás", lastName: "" }]);
    mocks.accounts.mockResolvedValue([{ userId: "u2", memberId: "m-tomas" }]);
    const older = { text: "t", author: "assistant", acceptedById: "u2", acceptedAt: "2026-10-12T09:00:00.000Z" };
    const people = await methodsSentencePeople([older, older, { text: "draft only" }]);
    expect(mocks.users).toHaveBeenCalledWith({ where: { id: { in: ["u2"] } }, select: { id: true, firstName: true, lastName: true } });
    expect(methodsSentenceView(older, people)).toMatchObject({ acceptedBy: { id: "u2", memberId: "m-tomas", name: "Tomás" } });
    // A sentence nobody accepted (no acceptedById) is sent as it is.
    expect(methodsSentenceView({ text: "draft only" }, people)).toEqual({ text: "draft only" });
  });

  it("still shows the sentence when the person cannot be read", async () => {
    mocks.users.mockRejectedValue(new Error("down"));
    mocks.accounts.mockResolvedValue([]);
    const older = { text: "t", acceptedById: "u3" };
    const people = await methodsSentencePeople([older]);
    expect(methodsSentenceView(older, people)).toEqual({ ...older, acceptedBy: { id: "u3", memberId: null, name: null } });
  });
});
