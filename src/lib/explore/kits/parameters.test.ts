import { describe, expect, it } from "vitest";
import { parameterDefaults, parameterProblems } from "./parameters";
const schema = { type: "object" as const, properties: { bins: { type: "integer", minimum: 2, maximum: 50, default: 10, title: "Bins" }, group: { type: "string", enum: ["case", "control"] } }, required: ["group"] };
describe("guided parameter review", () => {
  it("shares defaults between server and form", () => expect(parameterDefaults(schema)).toEqual({ bins: 10 }));
  it("reports required options, incorrect types, enum choices and bounds", () => {
    expect(parameterProblems(schema, { bins: 100 })).toEqual(["Bins: use at most 50.", "group: enter a value in Advanced options."]);
    expect(parameterProblems(schema, { bins: 1.5, group: "invalid" })).toHaveLength(2);
    expect(parameterProblems(schema, { bins: 10, group: "case" })).toEqual([]);
  });
  it("accepts optional nulls and explicit nullable values without inventing defaults", () => {
    expect(parameterProblems({ type: "object", properties: { value: { type: ["number", "null"] } }, required: ["value"] }, { value: null })).toEqual([]);
    expect(parameterDefaults(undefined)).toEqual({});
  });
});
