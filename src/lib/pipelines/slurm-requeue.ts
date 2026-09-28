/**
 * What a SLURM wrapper does when SLURM requeues its job (its node failed, `scontrol requeue`) and runs the script
 * again from the top. Found on a real Slurm: Nextflow then refused the run name its history already had.
 */

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * For a Nextflow run: keep the run name in SEQDESK_RUN_NAME (the command passes `-name "$SEQDESK_RUN_NAME"`), and on
 * a restart resume the same work under a name of its own, adding "${SEQDESK_REQUEUE_FLAGS[@]}" to the command.
 */
export function nextflowRequeueBlock(runName: string): string {
  return `# SLURM requeues this job after its node failed (or on scontrol requeue) and runs this script again from the top.
# Nextflow refuses a run name its history already has, so a restart resumes the same work under a name of its own.
SEQDESK_RUN_NAME=${shellQuote(runName)}
SEQDESK_REQUEUE_FLAGS=()
if [ "\${SLURM_RESTART_COUNT:-0}" -gt 0 ]; then
  SEQDESK_RUN_NAME="\${SEQDESK_RUN_NAME}-j\${SLURM_JOB_ID}-q\${SLURM_RESTART_COUNT}"
  SEQDESK_REQUEUE_FLAGS=(-resume)
  echo "Requeued by SLURM (restart \${SLURM_RESTART_COUNT}); resuming at $(date)" >> "$STDOUT_LOG"
fi`;
}

export const NEXTFLOW_NAME_FLAG = '-name "$SEQDESK_RUN_NAME"';
export const NEXTFLOW_REQUEUE_ARGS = '${SEQDESK_REQUEUE_FLAGS[@]+"${SEQDESK_REQUEUE_FLAGS[@]}"}';

/**
 * For work that must not happen twice (an ENA submission): a restarted job stops before doing anything and says why.
 * The run then fails with that line; someone checks ENA before submitting again.
 */
export function refuseRequeueBlock(what: string): string {
  return `# SLURM may requeue this job and run it again from the top; ${what} must not happen twice.
if [ "\${SLURM_RESTART_COUNT:-0}" -gt 0 ]; then
  echo "SLURM requeued this job (restart \${SLURM_RESTART_COUNT}); ${what} is not started again. Check what already arrived before starting a new run." >> "$STDERR_LOG"
  exit 75
fi`;
}
