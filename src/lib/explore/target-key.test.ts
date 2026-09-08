import { describe, expect, it } from "vitest";
import {
  formatTargetKey,
  isValidTargetKey,
  parseTargetKey,
  targetTypeLabel,
} from "./target-key";

describe("explore target keys", () => {
  it("parses well-formed keys", () => {
    expect(parseTargetKey("study:abc123")).toEqual({ type: "study", id: "abc123" });
    expect(parseTargetKey("order:clx_9-Z")).toEqual({ type: "order", id: "clx_9-Z" });
    expect(parseTargetKey("workspace:ws1")).toEqual({ type: "workspace", id: "ws1" });
  });

  it("rejects malformed keys", () => {
    expect(parseTargetKey("study")).toBeNull();
    expect(parseTargetKey(":abc")).toBeNull();
    expect(parseTargetKey("sample:abc")).toBeNull();
    expect(parseTargetKey("study:")).toBeNull();
    expect(parseTargetKey("study:a b")).toBeNull();
    expect(parseTargetKey("study:../x")).toBeNull();
    expect(parseTargetKey(42)).toBeNull();
    expect(isValidTargetKey("study:ok")).toBe(true);
    expect(isValidTargetKey("nope")).toBe(false);
  });

  it("formats and round-trips", () => {
    const key = formatTargetKey("study", "abc");
    expect(key).toBe("study:abc");
    expect(parseTargetKey(key)).toEqual({ type: "study", id: "abc" });
    expect(() => formatTargetKey("study", "bad id")).toThrow();
  });

  it("labels target types with the UI terminology", () => {
    expect(targetTypeLabel("order")).toBe("Sequencing Order");
    expect(targetTypeLabel("study")).toBe("Study");
  });
});
