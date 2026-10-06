/** A wrapper stopped before Nextflow started writes "exit code: 0" too; that 0 is not a finished run (live CRC, 6 Oct). */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { startedExitCode, stoppedBeforeNextflow } from "./run-started";

const folders: string[] = [];
async function runFolder(files: string[]) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-started-"));
  folders.push(folder);
  for (const name of files) {
    if (name.endsWith("/")) await fs.mkdir(path.join(folder, name), { recursive: true });
    else await fs.writeFile(path.join(folder, name), "x");
  }
  return folder;
}
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true }))); });

describe("a pipeline run's exit code", () => {
  it("reads a 0 from a wrapper that never started Nextflow as stopped (143)", async () => {
    const folder = await runFolder(["run.sh", "samplesheet.csv", "logs/"]);
    expect(await stoppedBeforeNextflow(folder)).toBe(true);
    expect(await startedExitCode(folder, 0)).toBe(143);
  });
  it("keeps a 0 once Nextflow left a trace or work folder, or its log says the execution completed", async () => {
    for (const marker of ["trace.txt", "work/"]) {
      const folder = await runFolder(["run.sh", ".nextflow.log", marker]);
      expect(await startedExitCode(folder, 0)).toBe(0);
    }
    const done = await runFolder(["run.sh"]);
    await fs.writeFile(path.join(done, ".nextflow.log"), "DEBUG nextflow.script.ScriptRunner - > Execution complete -- Goodbye\n");
    expect(await startedExitCode(done, 0)).toBe(0);
  });
  it("reads a 0 from a Nextflow stopped while it set up (log without completion, no trace) as stopped (live CRC, FASTQC-017)", async () => {
    const folder = await runFolder(["run.sh"]);
    await fs.writeFile(path.join(folder, ".nextflow.log"), "DEBUG nextflow.Session - Run name: FASTQC-20261006-017\nDEBUG nextflow.util.ThreadPoolBuilder - Creating thread pool 'FileTransfer'\n");
    expect(await stoppedBeforeNextflow(folder)).toBe(true);
    expect(await startedExitCode(folder, 0)).toBe(143);
  });
  it("never changes other codes, missing folders or folders without run.sh", async () => {
    const folder = await runFolder(["run.sh"]);
    expect(await startedExitCode(folder, 1)).toBe(1);
    expect(await startedExitCode(folder, null)).toBe(null);
    expect(await startedExitCode("/no/such/run", 0)).toBe(0);
    expect(await startedExitCode(await runFolder(["logs/"]), 0)).toBe(0);
    expect(await startedExitCode(null, 0)).toBe(0);
  });
});
