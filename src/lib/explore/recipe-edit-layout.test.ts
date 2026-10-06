import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { parseRecipeOps } from "./recipe-edit";

// The Workbench saves where every canvas node sits: steps, and the data, output and pencil nodes around them
// ("data:<dataset>", "out:<step>:<output>", "pen:<proposal>"). Refusing those made every layout save fail, so groups
// (In words paragraphs and headings) could not be saved at all.
describe("layout node ids", () => {
  it("keeps the canvas's data, output and pencil nodes", () => {
    const [op] = parseRecipeOps([{ op: "layout", nodes: {
      "data:cmus8htfj001i13sqo5kiwv80": { x: 16, y: 164 }, "out:cmuwgq0tw004sk00721ifvdh9:read_depth": { x: 1028.04, y: 30 },
      flow_472f7e88aeba414f9bb931a0369906db: { x: 764, y: 170 }, "pen:cmuwh1umy0063k007h2amql3j": { x: 3, y: 4 },
    }, groups: [{ id: "g-muwhlyh5", name: "Quality control", stepIds: ["cmuwgq0tw004sk00721ifvdh9"], collapsed: false }], snap: true }]);
    expect(op).toEqual({ op: "layout", nodes: {
      "data:cmus8htfj001i13sqo5kiwv80": { x: 16, y: 164 }, "out:cmuwgq0tw004sk00721ifvdh9:read_depth": { x: 1028, y: 30 },
      flow_472f7e88aeba414f9bb931a0369906db: { x: 764, y: 170 }, "pen:cmuwh1umy0063k007h2amql3j": { x: 3, y: 4 },
    }, groups: [{ id: "g-muwhlyh5", name: "Quality control", stepIds: ["cmuwgq0tw004sk00721ifvdh9"], collapsed: false }], snap: true });
  });

  it("still refuses odd ids and positions that are not numbers", () => {
    expect(() => parseRecipeOps([{ op: "layout", nodes: { "<script>": { x: 1, y: 2 } } }])).toThrow(/needs numbers x and y/);
    expect(() => parseRecipeOps([{ op: "layout", nodes: { "data:d1": { x: "1", y: 2 } } }])).toThrow(/needs numbers x and y/);
    expect(() => parseRecipeOps([{ op: "layout", nodes: { [`out:${"s".repeat(400)}`]: { x: 1, y: 2 } } }])).toThrow(/needs numbers x and y/);
  });
});
