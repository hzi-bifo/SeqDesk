import { describe, expect, it } from "vitest";
import { sandboxFromLog, summarizeIsolation } from "./prepare";

describe("the wrapper's sandbox report", () => {
  it("reads the Sandbox line of a run log", () => {
    expect(sandboxFromLog("Starting Explore analysis\nSandbox: bubblewrap (plan abc)\nUsing python: x\n")).toEqual({ used: "bubblewrap", detail: "plan abc" });
    expect(sandboxFromLog("Sandbox: none (bubblewrap not installed on node-3)\n")).toEqual({ used: "none", detail: "bubblewrap not installed on node-3" });
    expect(sandboxFromLog("Sandbox: refused (bubblewrap is required but not installed on node-3)")).toMatchObject({ used: "refused" });
    expect(sandboxFromLog("no marker here")).toBeNull();
    expect(sandboxFromLog(null)).toBeNull();
  });
});

describe("the isolation summary", () => {
  const base = { mode: "auto" as const, planHash: "abc", readable: [], writable: [], reason: null };
  it("says what a run could read and reach", () => {
    expect(summarizeIsolation({ ...base, tool: "seatbelt", network: "none", reads: "run" })?.label).toBe("Sandboxed · no network · reads its inputs only");
    expect(summarizeIsolation({ ...base, tool: "none", network: "host" })).toMatchObject({ reads: "host", label: "Not sandboxed · network allowed · reads any file of the app's user" });
    expect(summarizeIsolation({ ...base, tool: "bubblewrap", network: "none" })).toMatchObject({ reads: "unknown", label: "Sandboxed · no network" });
    expect(summarizeIsolation(null)).toBeNull();
  });
});
