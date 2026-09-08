import { describe, expect, it } from "vitest";
import { sandboxFromLog } from "./prepare";

describe("the wrapper's sandbox report", () => {
  it("reads the Sandbox line of a run log", () => {
    expect(sandboxFromLog("Starting Explore analysis\nSandbox: bubblewrap (plan abc)\nUsing python: x\n")).toEqual({ used: "bubblewrap", detail: "plan abc" });
    expect(sandboxFromLog("Sandbox: none (bubblewrap not installed on node-3)\n")).toEqual({ used: "none", detail: "bubblewrap not installed on node-3" });
    expect(sandboxFromLog("Sandbox: refused (bubblewrap is required but not installed on node-3)")).toMatchObject({ used: "refused" });
    expect(sandboxFromLog("no marker here")).toBeNull();
    expect(sandboxFromLog(null)).toBeNull();
  });
});
