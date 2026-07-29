import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { buildSeqDeskSlurmJobName } from "@/lib/pipelines/run-directory";

export const PIPELINE_LAUNCH_IDENTITY_FILENAME =
  ".seqdesk-launch-identity";

export type PipelineLaunchIdentityKind = "local" | "slurm";

type WritePipelineLaunchIdentityInput = {
  runFolder: string;
  runId: string;
  kind: PipelineLaunchIdentityKind;
  numericId: number | string;
};

/**
 * Persist an external process/allocation identity beside the run before the
 * database lifecycle write. CI and operator cleanup can therefore still find
 * an orphan when queueJobId persistence and the immediate stop both fail.
 *
 * The deliberately small pipe-delimited format is also safe to consume from
 * the Bash cleanup path without jq:
 *   local|<pid>|-
 *   slurm|<job id>|<exact SeqDesk job name>
 */
export async function writePipelineLaunchIdentity({
  runFolder,
  runId,
  kind,
  numericId,
}: WritePipelineLaunchIdentityInput): Promise<string> {
  const id = String(numericId).trim();
  if (!/^[1-9]\d*$/.test(id)) {
    throw new Error(`Invalid ${kind} launch identity: ${numericId}`);
  }

  const canonicalRunFolder = await fs.realpath(runFolder);
  const markerPath = path.join(
    canonicalRunFolder,
    PIPELINE_LAUNCH_IDENTITY_FILENAME
  );
  const temporaryPath = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
  const expectedJobName =
    kind === "slurm" ? buildSeqDeskSlurmJobName(runId) : "-";
  const contents = `${kind}|${id}|${expectedJobName}\n`;

  try {
    await fs.writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, markerPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }

  return markerPath;
}
