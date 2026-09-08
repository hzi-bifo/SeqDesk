import { describe, expect, it } from "vitest";
import { sequencingEntryScope } from "./entry-access";

describe("sequencing entry ownership", () => {
  it("requires order ownership or standalone study ownership", () => {
    expect(sequencingEntryScope("member-1")).toEqual({ OR: [
      { order: { userId: "member-1" } },
      { orderId: null, study: { userId: "member-1" } },
    ] });
  });
  it("only broadens access for an explicit installation grant", () => {
    expect(sequencingEntryScope("operator", true)).toEqual({});
  });
});
