import { describe, expect, it } from "vitest";
import { limitsFromLog, limitUnitName, prlimitArgs, resourceLimitLines, systemdRunArgs } from "./limits";
import { DEFAULT_RUN_LIMITS, normalizeRunLimits, normalizeSandboxSettings } from "./settings";

describe("run resource limits", () => {
  it("defaults to 4 cores, 16 GB and 512 processes and bounds what is stored", () => {
    expect(normalizeSandboxSettings({}).limits).toEqual({ cores: 4, memoryGb: 16, pids: 512 });
    expect(normalizeRunLimits({ cores: -2, memoryGb: 8.7, pids: "x" })).toEqual({ cores: 0, memoryGb: 8, pids: DEFAULT_RUN_LIMITS.pids });
  });

  it("puts every delegated cap on the systemd scope and names the missing ones", () => {
    const full = systemdRunArgs({ cores: 4, memoryGb: 16, pids: 512 }, ["cpu", "memory", "pids"], "seqdesk-run-abc");
    expect(full.args).toEqual(["systemd-run", "--user", "--scope", "--quiet", "--unit=seqdesk-run-abc", "-p", "MemoryMax=16G", "-p", "MemorySwapMax=0", "-p", "CPUQuota=400%", "-p", "TasksMax=512", "--"]);
    expect(full.enforced).toEqual(["memory", "cpu", "pids"]);
    // Ubuntu delegates memory and pids only.
    const partial = systemdRunArgs({ cores: 4, memoryGb: 16, pids: 512 }, ["memory", "pids"], "u");
    expect(partial.args).not.toContain("CPUQuota=400%");
    expect(partial.notes).toEqual(["cpu: the cpu controller is not delegated to the user"]);
    expect(systemdRunArgs({ cores: 0, memoryGb: 0, pids: 0 }, ["memory"], "u").enforced).toEqual([]);
  });

  it("falls back to prlimit with the process cap on top of the user's own processes", () => {
    expect(prlimitArgs({ cores: 4, memoryGb: 2, pids: 100 }, 40).args).toEqual(["prlimit", `--as=${2 * 1024 ** 3}`, "--nproc=140", "--"]);
  });

  it("renders the wrapper choice and the plain-language limit messages", () => {
    const script = resourceLimitLines({ cores: 4, memoryGb: 16, pids: 512 }, "run/1;x").join("\n");
    expect(script).toContain("LIMIT_CORES=4; LIMIT_MEM_GB=16; LIMIT_PIDS=512");
    expect(script).toContain('systemd-run --user --scope --quiet "--unit=$LIMIT_UNIT"');
    expect(script).toContain("MemoryMax=${LIMIT_MEM_GB}G");
    expect(script).toContain("TasksMax=$LIMIT_PIDS");
    expect(script).toContain("prlimit");
    expect(script).toContain("memory limit (16 GB) reached");
    expect(script).toContain("process limit (512) reached");
    expect(script).toContain('control/limits.json');
    expect(limitUnitName("run/1;x")).toBe("seqdesk-run-run1x");
  });

  it("reads the wrapper's Limits line", () => {
    expect(limitsFromLog("Starting\nLimits: systemd (cores 4, memory 16 GB, processes 512; enforced: memory pids)\n")).toEqual({ mechanism: "systemd", detail: "cores 4, memory 16 GB, processes 512; enforced: memory pids" });
    expect(limitsFromLog("nothing")).toBeNull();
  });
});
