import path from "path";
import fs from "fs/promises";
import { db } from "@/lib/db";

/**
 * The inputs of a figure trial: the exact files a completed step run read
 * (its run folder's inputs/<alias>.tsv), so the trial draws from the same
 * data as the run whose figure it improves. Staged like a trial's upstream
 * file inputs, never read from or written to the tables storage.
 */
export async function figureTrialInputs(stepRunId: string): Promise<Record<string, { path: string; artifactId: string; name: string }>> {
  const stepRun = await db.exploreAnalysisRun.findUnique({ where: { id: stepRunId }, select: { runFolder: true } });
  if (!stepRun?.runFolder) throw new Error("The run this figure trial starts from has no run folder any more.");
  const inputs = JSON.parse(await fs.readFile(path.join(stepRun.runFolder, "inputs.json"), "utf8")) as { inputs?: Record<string, { path?: string; name?: string }> };
  const files: Record<string, { path: string; artifactId: string; name: string }> = {};
  for (const [alias, entry] of Object.entries(inputs.inputs ?? {})) {
    if (!entry?.path) continue;
    const full = path.resolve(stepRun.runFolder, entry.path);
    // Only files inside that run folder.
    if (!full.startsWith(`${path.resolve(stepRun.runFolder)}${path.sep}`)) continue;
    files[alias] = { path: full, artifactId: `run:${stepRunId}`, name: entry.name ?? alias };
  }
  return files;
}
