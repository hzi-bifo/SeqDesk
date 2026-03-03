import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";

import { findTraceFile, parseTraceContent, parseTraceFile, watchTraceFile } from "./trace-parser";

let tempDir: string;

async function writeFile(relPath: string, content: string): Promise<string> {
  const target = path.join(tempDir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return target;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-trace-parser-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("trace-parser", () => {
  it("parses trace content and computes process summaries", async () => {
    const content = [
      "task_id\thash\tnative_id\tname\tstatus\texit\tsubmit\tstart\tcomplete\tduration\trealtime\t%cpu\tpeak_rss\tpeak_vmem\tworkdir",
      "t1\th1\tn1\tNFCORE:MAG:FASTQC (sampleA)\tCOMPLETED\t0\t2024-01-01 10:00:00\t2024-01-01 10:01:00\t2024-01-01 10:02:00\t1h 2m 3.4s\t1200ms\t90%\t1.2 GB\t512 MB\t/home/w1",
      "t2\th2\tn2\tNFCORE:MAG:FASTQC (sampleB)\tRUNNING\t-\t-\t2024-01-01 10:03:00\t-\t2500\t-\t50%\t-\t-\t/home/w2",
      "t3\th3\tn3\tNFCORE:MAG:TRIM\tABORTED\t8\t-\t-\t-\t-\t-\t-\t-\t-\t/home/w3",
      "t4\th4\tn4\tONLYNAME\tDONE\tbad\t-\t-\t-\t-\t-\t-\t-\t-\t/home/w4",
    ].join("\n");

    const result = parseTraceContent(content);

    expect(result.tasks).toHaveLength(4);
    expect(result.tasks[0].process).toBe("FASTQC");
    expect(result.tasks[0].tag).toBe("sampleA");
    expect(result.tasks[0].status).toBe("COMPLETED");
    expect(result.tasks[0].exit).toBe(0);
    expect(result.tasks[0].duration).toBe(3723400);
    expect(result.tasks[0].realtime).toBe(1200);
    expect(result.tasks[0].cpuPercent).toBe(90);
    expect(result.tasks[0].peakRss).toBeCloseTo(1288490188.8, 5);
    expect(result.tasks[0].peakVmem).toBeCloseTo(536870912, 5);
    expect(result.tasks[0].workdir).toBe("/home/w1");

    expect(result.tasks[1].process).toBe("FASTQC");
    expect(result.tasks[1].status).toBe("RUNNING");
    expect(result.tasks[1].exit).toBeNull();
    expect(result.tasks[1].duration).toBe(2500);

    expect(result.tasks[2].status).toBe("ABORTED");
    expect(result.tasks[2].exit).toBe(8);
    expect(result.tasks[3].status).toBe("SUBMITTED");

    const fastqc = result.processes.get("FASTQC");
    expect(fastqc).toMatchObject({
      totalTasks: 2,
      completedTasks: 1,
      runningTasks: 1,
      failedTasks: 0,
      cachedTasks: 0,
      status: "running",
    });

    const trim = result.processes.get("TRIM");
    expect(trim).toMatchObject({
      totalTasks: 1,
      failedTasks: 1,
      status: "failed",
    });

    expect(result.overallProgress).toBe(25);
    expect(result.startedAt?.getTime()).toBe(new Date("2024-01-01 10:01:00").getTime());
    expect(result.completedAt?.getTime()).toBe(new Date("2024-01-01 10:02:00").getTime());
  });

  it("returns empty parse result for too-short headers", () => {
    const result = parseTraceContent("process\tstatus");

    expect(result.tasks).toEqual([]);
    expect(result.processes.size).toBe(0);
    expect(result.overallProgress).toBe(0);
    expect(result.startedAt).toBeNull();
    expect(result.completedAt).toBeNull();
  });

  it("classifies cached and completed process summaries", () => {
    const content = [
      "task_id\tname\tstatus\tsubmit\tstart\tcomplete",
      "t1\tFASTQC\tCACHED\t-\t2024-01-01 10:00:00\t2024-01-01 10:10:00",
      "t2\tTRIM\tCOMPLETED\t-\t2024-01-01 09:00:00\t2024-01-01 09:20:00",
    ].join("\n");

    const result = parseTraceContent(content);

    expect(result.overallProgress).toBe(100);
    expect(result.processes.get("FASTQC")).toMatchObject({
      totalTasks: 1,
      completedTasks: 1,
      cachedTasks: 1,
      status: "completed",
    });
    expect(result.processes.get("TRIM")).toMatchObject({
      totalTasks: 1,
      completedTasks: 1,
      status: "completed",
    });
  });

  it("returns empty parse result for blank content", () => {
    const result = parseTraceContent("   \n  \t\n");

    expect(result.tasks).toEqual([]);
    expect(result.processes.size).toBe(0);
    expect(result.overallProgress).toBe(0);
    expect(result.startedAt).toBeNull();
    expect(result.completedAt).toBeNull();
  });

  it("classifies unknown status as pending", () => {
    const content = [
      "task_id\thash\tnative_id\tname\tstatus\texit\tsubmit\tstart",
      "p1\th1\tn1\tFASTQC\tWAITING\t0\t2024-01-01 10:00:00\t2024-01-01 10:01:00",
    ].join("\n");

    const result = parseTraceContent(content);

    expect(result.overallProgress).toBe(0);
    expect(result.processes.get("FASTQC")?.status).toBe("pending");
    expect(result.processes.get("FASTQC")?.totalTasks).toBe(1);
  });

  it("maps malformed duration and byte values to null", () => {
    const content = [
      "task_id\thash\tnative_id\tname\tstatus\texit\tsubmit\tstart\tcomplete\tduration\trealtime\t%cpu\tpeak_rss\tpeak_vmem\tworkdir",
      "t1\th1\tn1\tSAMPLE\tCOMPLETED\t0\t2024-01-01 10:00:00\t2024-01-01 10:01:00\t2024-01-01 10:02:00\tbad\tn/a\tabc\tnot-a-number\tn/a\t/tmp/w1",
    ].join("\n");

    const result = parseTraceContent(content);
    const task = result.tasks[0];

    expect(task.duration).toBeNull();
    expect(task.realtime).toBeNull();
    expect(task.cpuPercent).toBeNull();
    expect(task.peakRss).toBeNull();
    expect(task.peakVmem).toBeNull();
    expect(result.overallProgress).toBe(100);
    expect(result.startedAt?.getTime()).toBe(new Date("2024-01-01 10:01:00").getTime());
  });

  it("falls back to raw byte values for unknown byte units", () => {
    const content = [
      "task_id\thash\tnative_id\tname\tstatus\texit\tsubmit\tstart\tcomplete\tduration\trealtime\t%cpu\tpeak_rss\tpeak_vmem\tworkdir",
      "t1\th1\tn1\tSAMPLE\tCOMPLETED\t0\t2024-01-01 10:00:00\t2024-01-01 10:01:00\t2024-01-01 10:02:00\t1s\t1s\t100%\t7 PB\t4 PB\t/tmp/w1",
    ].join("\n");

    const result = parseTraceContent(content);
    const task = result.tasks[0];

    expect(task.peakRss).toBe(7);
    expect(task.peakVmem).toBe(4);
  });

  it("falls back to defaults when name and task id columns are missing", () => {
    const content = [
      "hash\tnative_id\tname\tstatus\texit",
      "h1\tn1\t\tFAILED\t0",
    ].join("\n");

    const result = parseTraceContent(content);
    const task = result.tasks[0];

    expect(task.taskId).toBe("");
    expect(task.process).toBe("");
    expect(task.status).toBe("FAILED");
    expect(result.processes.get("")?.status).toBe("failed");
  });

  it("treats byte values without explicit unit as plain bytes", () => {
    const content = [
      "task_id\thash\tnative_id\tname\tstatus\texit\tsubmit\tstart\tcomplete\tduration\trealtime\t%cpu\tpeak_rss\tpeak_vmem\tworkdir",
      "t1\th1\tn1\tSAMPLE\tCOMPLETED\t0\t2024-01-01 10:00:00\t2024-01-01 10:01:00\t2024-01-01 10:02:00\t1s\t1s\t100%\t2048\t256\t/tmp/w1",
    ].join("\n");

    const result = parseTraceContent(content);
    const task = result.tasks[0];

    expect(task.peakRss).toBe(2048);
    expect(task.peakVmem).toBe(256);
    expect(result.overallProgress).toBe(100);
  });

  it("treats missing status as SUBMITTED", () => {
    const content = [
      "task_id\thash\tnative_id\tname\texit\tsubmit\tstart\tcomplete\tduration\trealtime\t%cpu\tpeak_rss\tpeak_vmem\tworkdir",
      "t1\th1\tn1\tSAMPLE\t0\t2024-01-01 10:00:00\t2024-01-01 10:01:00\t2024-01-01 10:02:00\t1s\t1s\t0%\t1 MB\t1 MB\t/tmp/w1",
    ].join("\n");

    const result = parseTraceContent(content);

    expect(result.tasks[0].status).toBe("SUBMITTED");
  });

  it("handles malformed dates as null", () => {
    const content = [
      "task_id\thash\tnative_id\tname\tstatus\texit\tsubmit\tstart\tcomplete\tpeak_rss\tpeak_vmem",
      "t1\th1\tn1\tSAMPLE\tCOMPLETED\t0\tnot-a-date\tnot-a-date\tnot-a-date\t1 MB\t1 MB",
    ].join("\n");

    const result = parseTraceContent(content);
    const task = result.tasks[0];

    expect(task.submit).toBeNull();
    expect(task.start).toBeNull();
    expect(task.complete).toBeNull();
    expect(result.overallProgress).toBe(100);
  });

  it("findTraceFile returns preferred trace locations", async () => {
    const directPath = await writeFile("trace.txt", "a");
    await writeFile("pipeline_info/trace.txt", "b");

    const found = await findTraceFile(tempDir);

    expect(found).toBe(directPath);
  });

  it("findTraceFile returns null when no trace file exists", async () => {
    const missing = path.join(tempDir, "no-traces");
    await fs.mkdir(missing);
    expect(await findTraceFile(missing)).toBeNull();
  });

  it("watchTraceFile triggers callback and cleanup stops updates", async () => {
    const tracePath = await writeFile("trace.txt", "task_id\tname\tstatus\n");
    const callback = vi.fn();

    const stop = await watchTraceFile(tracePath, callback, 25);
    await pause(30);

    await fs.writeFile(tracePath, "task_id\tname\tstatus\ttype\nrow1\tNF:STEP:RUN\tCOMPLETED\t1");
    await pause(30);

    expect(callback).toHaveBeenCalled();
    const initialCount = callback.mock.calls.length;

    stop();
    await fs.writeFile(tracePath, "task_id\tname\tstatus\ttype\nrow2\tNF:STEP:RUN\tCOMPLETED\t1");
    await pause(40);

    expect(callback).toHaveBeenCalledTimes(initialCount);
  });

  it("watchTraceFile does not run callback checks after stop", async () => {
    const tracePath = await writeFile("trace.txt", "task_id\tname\tstatus\n");
    const callback = vi.fn();
    const intervalCallbacks: Array<() => void> = [];

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    setIntervalSpy.mockImplementation((callbackFn: () => void, _intervalMs?: number): NodeJS.Timeout => {
      intervalCallbacks.push(callbackFn);
      return 1 as unknown as NodeJS.Timeout;
    });

    clearIntervalSpy.mockImplementation((_timerId: any) => void 0);

    const stop = await watchTraceFile(tracePath, callback, 10);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(intervalCallbacks).toHaveLength(1);

    await fs.writeFile(tracePath, "task_id\tname\tstatus\nrow1\tNF:STEP:RUN\tCOMPLETED");
    intervalCallbacks[0]();
    await pause(20);

    const countWhileRunning = callback.mock.calls.length;
    expect(countWhileRunning).toBeGreaterThan(1);

    stop();

    await fs.writeFile(tracePath, "task_id\tname\tstatus\nrow2\tNF:STEP:RUN\tCOMPLETED");
    intervalCallbacks[0]();
    await pause(20);

    expect(callback).toHaveBeenCalledTimes(countWhileRunning);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("parseTraceFile throws when file cannot be read", async () => {
    const missing = path.join(tempDir, "missing-trace.txt");
    await expect(parseTraceFile(missing)).rejects.toBeTruthy();
  });
});
