/**
 * The job id in what `sbatch` printed. With --parsable it prints "<id>" or "<id>;<cluster>"; without it, "Submitted
 * batch job <id>". Read from the whole stdout once sbatch has exited: a pipe may deliver it in more than one chunk, and
 * a chunk-by-chunk match would take the tail of a split id ("4819" + "227\n") for the id.
 */
export function sbatchJobId(stdout: string | null | undefined): string | null {
  const lines = (stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const parsable = /^(\d+)(?:;\S+)?$/.exec(line);
    if (parsable) return parsable[1];
  }
  return /Submitted batch job (\d+)/.exec(stdout ?? '')?.[1] ?? null;
}
