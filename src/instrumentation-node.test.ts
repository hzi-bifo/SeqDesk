import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), monitor: vi.fn(), lifecycle: vi.fn() }));
vi.mock("@/lib/workbench/import-worker", () => ({ startWorkbenchImportWorker: mocks.start }));
vi.mock("@/lib/workers/process", () => ({ ensureWorkerStarted: mocks.monitor, wireMonitorLifecycle: mocks.lifecycle }));
import { registerNodeInstrumentation } from "./instrumentation-node";

describe("beta background services", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.monitor.mockResolvedValue({ action: "started", pid: 123 });
  });
  it("starts imports exactly once and starts both independent analysis monitors", async () => {
    await registerNodeInstrumentation();
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.monitor.mock.calls).toEqual([["pipeline-monitor"], ["explore-monitor"]]);
    expect(mocks.lifecycle).toHaveBeenCalledTimes(2);
  });
  it("still starts Reports if imports or the pipeline monitor cannot start", async () => {
    mocks.start.mockImplementation(() => { throw new Error("internal worker fixture"); });
    mocks.monitor.mockRejectedValueOnce(new Error("internal monitor fixture"));
    await expect(registerNodeInstrumentation()).resolves.toBeUndefined();
    expect(mocks.monitor).toHaveBeenLastCalledWith("explore-monitor");
    expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
  });
});
