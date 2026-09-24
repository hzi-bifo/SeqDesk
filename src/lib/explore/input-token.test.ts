import { expect, it } from "vitest";
import { inputToken } from "./input-token";
import type { ExploreEditRecord } from "./edits";
it("input identities include version and active curation overlays", () => {
  const edit = { id: "edit1", kind: "cell", target: { rowKey: "i:0", column: "value" }, value: 1 } as unknown as ExploreEditRecord;
  expect(inputToken("v1", [])).toBe(inputToken("v1", []));
  expect(inputToken("v1", [])).not.toBe(inputToken("v2", []));
  expect(inputToken("v1", [edit])).not.toBe(inputToken("v1", [{ ...edit, value: 2 }]));
  expect(inputToken("v1", [edit])).not.toBe(inputToken("v1", []));
});
