import fs from "fs/promises";
import path from "path";

/**
 * A wrapper stopped before Nextflow started (a cancel that arrives while the run launches) still writes
 * "Pipeline completed with exit code: 0" from its EXIT trap. When the run folder has its run.sh but none of what a
 * started Nextflow leaves (`.nextflow.log`, `trace.txt`, `work/`), nothing ran: that 0 must read as stopped (143),
 * never as a finished run whose outputs are then waited for forever (holding this server's capacity).
 */
export async function stoppedBeforeNextflow(runFolder: string | null | undefined): Promise<boolean> {
  if (!runFolder) return false;
  const has = (name: string) => fs.stat(path.join(runFolder, name)).then(() => true, () => false);
  if (!(await has("run.sh"))) return false;
  if ((await has("trace.txt")) || (await has("work"))) return false;
  if (!(await has(".nextflow.log"))) return true;
  // Nextflow started but was stopped while it set up (a cancel seconds after launch): its log never reaches
  // "Execution complete" and it wrote no trace or work folder, yet the wrapper's trap still says exit code 0.
  const log = await fs.readFile(path.join(runFolder, ".nextflow.log"), "utf8").catch(() => "");
  return !/Execution complete|Execution aborted|Session aborted/i.test(log);
}

/** The wrapper's exit code with a 0 from before Nextflow started read as 143 (see stoppedBeforeNextflow). */
export async function startedExitCode(runFolder: string | null | undefined, code: number | null): Promise<number | null> {
  return code === 0 && (await stoppedBeforeNextflow(runFolder)) ? 143 : code;
}
