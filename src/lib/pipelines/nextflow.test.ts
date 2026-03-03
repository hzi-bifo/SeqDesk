import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import { findTraceFile, parseTraceFile, readTail } from "./nextflow";

let tempDir: string;

async function writeFile(relPath: string, content: string): Promise<string> {
  const target = path.join(tempDir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return target;
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-nextflow-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("nextflow", () => {
  it("findTraceFile prefers direct trace.txt", async () => {
    const directPath = await writeFile("trace.txt", "x");
    await writeFile("trace-20240101.txt", "y");

    const found = await findTraceFile(tempDir);

    expect(found).toBe(directPath);
  });

  it("findTraceFile falls back to matching trace*.txt and null when missing", async () => {
    const fallbackPath = await writeFile("trace-run-1.txt", "x");

    const found = await findTraceFile(tempDir);
    const missing = await findTraceFile(path.join(tempDir, "does-not-exist"));

    expect(found).toBe(fallbackPath);
    expect(missing).toBeNull();
  });

  it("findTraceFile returns null when run folder exists but contains no trace file", async () => {
    const found = await findTraceFile(tempDir);

    expect(found).toBeNull();
  });

  it("parseTraceFile returns empty result for too-short content", async () => {
    const tracePath = await writeFile("short-trace.txt", "process\tstatus");

    const result = await parseTraceFile(tracePath);

    expect(result.tasks).toEqual([]);
    expect(result.processes.size).toBe(0);
    expect(result.overallProgress).toBe(0);
    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
  });

  it("parseTraceFile parses tasks, status summaries, and progress", async () => {
    const content = [
      "process\tstatus\texit\tsubmit\tstart\tcomplete\ttag",
      "FASTQC\tCOMPLETED\t0\t2024-01-01 10:00:00\t2024-01-01 10:01:00\t2024-01-01 10:02:00\tS1",
      "FASTQC\tRUNNING\t\t2024-01-01 10:03:00\t\t\tS2",
      "TRIM\tFAILED\t1\t2024-01-01T10:04:00\t2024-01-01T10:05:00\t2024-01-01T10:06:00\tS3",
      "MAP\tdone\t0\t2024-01-01 10:07:00\t2024-01-01 10:08:00\t2024-01-01 10:09:00\tS4",
    ].join("\n");

    const tracePath = await writeFile("trace.txt", content);
    const result = await parseTraceFile(tracePath);

    expect(result.tasks).toHaveLength(4);
    expect(result.tasks[0]).toMatchObject({ process: "FASTQC", status: "COMPLETED", exit: 0 });
    expect(result.tasks[1].exit).toBeUndefined();

    expect(result.processes.get("FASTQC")).toMatchObject({ status: "running", totalTasks: 2 });
    expect(result.processes.get("TRIM")).toMatchObject({ status: "failed", totalTasks: 1 });
    expect(result.processes.get("MAP")).toMatchObject({ status: "completed", totalTasks: 1 });

    expect(result.overallProgress).toBe(50);
    expect(result.startedAt?.getTime()).toBe(new Date("2024-01-01T10:01:00").getTime());
    expect(result.completedAt?.getTime()).toBe(new Date("2024-01-01T10:09:00").getTime());
  });

  it("parseTraceFile handles invalid and missing timestamp values", async () => {
    const content = [
      "process\tstatus\tsubmit\tstart\tcomplete\texit",
      "SAMPLE\tCOMPLETED\tnot-a-time\tnot-a-time\tnot-a-time\t0",
      "EMPTY\tFAILED\t2024-01-01 12:00:00\t\t\t1",
    ].join("\n");

    const tracePath = await writeFile("trace-invalid-dates.txt", content);
    const result = await parseTraceFile(tracePath);

    expect(result.overallProgress).toBe(50);
    expect(result.startedAt?.getTime()).toBe(new Date("2024-01-01T12:00:00").getTime());
    expect(result.completedAt).toBeUndefined();
    expect(result.tasks).toHaveLength(2);
  });

  it("treats unknown status with non-zero exit as failed", async () => {
    const content = [
      "process\tstatus\texit\tsubmit",
      "UNKNOWN\tQUEUED\t13\t2024-01-01 10:00:00",
      "READY\tcompleted\t0\t2024-01-01 10:01:00",
    ].join("\n");

    const tracePath = await writeFile("trace-failed-exit.txt", content);
    const result = await parseTraceFile(tracePath);

    expect(result.processes.get("UNKNOWN")?.status).toBe("failed");
    expect(result.processes.get("READY")?.status).toBe("completed");
    expect(result.processes.get("UNKNOWN")?.totalTasks).toBe(1);
    expect(result.overallProgress).toBe(50);
  });

  it("parseTraceFile supports alternate column names (name/state)", async () => {
    const content = [
      "name\tstate\texit\tstart\tcomplete",
      "ASSEMBLY\tSUCCESS\tnot-a-number\t2024-01-01 12:00:00\t2024-01-01 12:10:00",
    ].join("\n");

    const tracePath = await writeFile("trace-alt.txt", content);
    const result = await parseTraceFile(tracePath);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].process).toBe("ASSEMBLY");
    expect(result.tasks[0].status).toBe("SUCCESS");
    expect(result.tasks[0].exit).toBeUndefined();
    expect(result.overallProgress).toBe(100);
  });

  it("parseTraceFile treats unknown status without exit as pending", async () => {
    const content = [
      "process\tstatus\texit",
      "FASTQC\tQUEUED\t-",
    ].join("\n");

    const tracePath = await writeFile("trace-pending.txt", content);
    const result = await parseTraceFile(tracePath);

    expect(result.processes.get("FASTQC")?.status).toBe("pending");
  });

  it("parseTraceFile skips rows without process identifiers", async () => {
    const content = [
      "process\tstatus\texit",
      "\tDONE\t0",
    ].join("\n");

    const tracePath = await writeFile("trace-empty-process.txt", content);
    const result = await parseTraceFile(tracePath);

    expect(result.tasks).toEqual([]);
    expect(result.processes.size).toBe(0);
    expect(result.overallProgress).toBe(0);
    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
  });

  it("parseTraceFile falls back to unknown status when no status columns are present", async () => {
    const content = ["process\texit", "SAMPLE\t0"].join("\n");

    const tracePath = await writeFile("trace-no-status.txt", content);
    const result = await parseTraceFile(tracePath);

    expect(result.processes.get("SAMPLE")?.status).toBe("pending");
    expect(result.overallProgress).toBe(0);
  });

  it("parseTraceFile treats blank date strings as missing", async () => {
    const content = ["process\tstatus\tsubmit\tstart\tcomplete", "BLANK\tDONE\t\t \t \t"].join("\n");

    const tracePath = await writeFile("trace-blank-dates.txt", content);
    const result = await parseTraceFile(tracePath);

    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
    expect(result.overallProgress).toBe(100);
  });

  it("readTail returns last lines and handles null/missing files", async () => {
    const filePath = await writeFile("run.log", "l1\nl2\nl3\nl4\nl5");

    const tail2 = await readTail(filePath, 2);
    const withNull = await readTail(null, 2);
    const missing = await readTail(path.join(tempDir, "missing.log"), 2);

    expect(tail2).toBe("l4\nl5");
    expect(withNull).toBeNull();
    expect(missing).toBeNull();
  });
});
