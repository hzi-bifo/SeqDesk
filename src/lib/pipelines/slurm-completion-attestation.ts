export const SLURM_COMPLETION_ATTESTATION_SCHEMA_VERSION = '1';
export const SLURM_COMPLETION_ATTESTATION_PHASE = 'completed';
export const SLURM_COMPLETION_ATTESTATION_SUFFIX = '.attestation';
export const WRITE_SLURM_COMPLETION_ATTESTATION_COMMAND =
  'write_seqdesk_slurm_completion_attestation';
export const SLURM_WRAPPER_FINALIZER_FUNCTION =
  'finalize_seqdesk_slurm_wrapper';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

const UNSAFE_SLURM_RUN_FOLDER = /[\x00-\x1f\x7f"`$\\]/;
const RESERVED_SLURM_PATH_OPTIONS = [
  "--output",
  "--error",
  "--chdir",
] as const;
const RESERVED_SLURM_PATH_SHORT_OPTIONS = ["-o", "-e", "-D"] as const;

export function assertSafeSlurmRunFolder(runFolder: string): void {
  if (
    typeof runFolder !== "string" ||
    runFolder.length === 0 ||
    UNSAFE_SLURM_RUN_FOLDER.test(runFolder)
  ) {
    throw new Error(
      "Refusing to launch pipeline: run directory contains unsafe characters for an SBATCH directive",
    );
  }
}

export function renderSlurmChdirDirective(runFolder: string): string {
  assertSafeSlurmRunFolder(runFolder);
  return `#SBATCH -D "${runFolder}"`;
}

export function assertNoReservedSlurmPathOptions(
  slurmOptions: string | undefined,
): void {
  const tokens = slurmOptions?.trim().split(/\s+/).filter(Boolean) ?? [];
  const reserved = tokens.find((token) => {
    if (
      RESERVED_SLURM_PATH_OPTIONS.some(
        (option) => token === option || token.startsWith(`${option}=`),
      )
    ) {
      return true;
    }
    return RESERVED_SLURM_PATH_SHORT_OPTIONS.some(
      (option) => token === option || token.startsWith(option),
    );
  });
  if (reserved) {
    throw new Error(
      `Refusing SLURM options: ${reserved} overrides SeqDesk-owned WorkDir or capture-log paths`,
    );
  }
}

/**
 * Install the EXIT trap before any NFS probing, log redirection, runtime
 * bootstrap, or attestation initialization can fail. The finalizer retries the
 * shared log directory itself, preserves the real wrapper exit code, and copies
 * both node-local SLURM capture files for later fail-closed verification.
 */
export function buildSlurmWrapperFinalizerBlock(runFolder: string): string {
  assertSafeSlurmRunFolder(runFolder);

  return `RUN_FOLDER=${shellQuote(runFolder)}
STDOUT_LOG="$RUN_FOLDER/logs/pipeline.out"
STDERR_LOG="$RUN_FOLDER/logs/pipeline.err"

${SLURM_WRAPPER_FINALIZER_FUNCTION}() {
  SEQDESK_WRAPPER_EXIT_CODE=$?
  trap - EXIT
  set +e
  for ((finalize_attempt = 1; finalize_attempt <= 15; finalize_attempt += 1)); do
    if mkdir -p "$RUN_FOLDER/logs" 2>/dev/null && : > "$RUN_FOLDER/logs/.nfs-finalize-probe" 2>/dev/null; then
      rm -f "$RUN_FOLDER/logs/.nfs-finalize-probe" 2>/dev/null
      break
    fi
    sleep 2
  done
  : >> "$STDERR_LOG"
  SEQDESK_CAPTURE_LOGS_COPIED=0
  if [ -n "\${SLURM_JOB_ID:-}" ]; then
    if cp -f "/tmp/seqdesk-slurm-$SLURM_JOB_ID.out" "$RUN_FOLDER/logs/slurm-$SLURM_JOB_ID.out" 2>/dev/null && \
       cp -f "/tmp/seqdesk-slurm-$SLURM_JOB_ID.err" "$RUN_FOLDER/logs/slurm-$SLURM_JOB_ID.err" 2>/dev/null; then
      SEQDESK_CAPTURE_LOGS_COPIED=1
    fi
  fi
  if [ "$SEQDESK_WRAPPER_EXIT_CODE" -eq 0 ]; then
    if [ "$SEQDESK_CAPTURE_LOGS_COPIED" -ne 1 ]; then
      printf 'Failed to persist SLURM capture logs; refusing success attestation\\n' >> "$STDERR_LOG"
      SEQDESK_WRAPPER_EXIT_CODE=1
    elif ! declare -F ${WRITE_SLURM_COMPLETION_ATTESTATION_COMMAND} >/dev/null 2>&1; then
      printf 'SLURM success-attestation function is unavailable\\n' >> "$STDERR_LOG"
      SEQDESK_WRAPPER_EXIT_CODE=1
    elif ! ${WRITE_SLURM_COMPLETION_ATTESTATION_COMMAND}; then
      printf 'Failed to persist SLURM success attestation\\n' >> "$STDERR_LOG"
      SEQDESK_WRAPPER_EXIT_CODE=1
    fi
  fi
  printf 'Pipeline completed with exit code: %s at %s\\n' "$SEQDESK_WRAPPER_EXIT_CODE" "$(date)" >> "$STDOUT_LOG"
  exit "$SEQDESK_WRAPPER_EXIT_CODE"
}
trap ${SLURM_WRAPPER_FINALIZER_FUNCTION} EXIT`;
}

/**
 * Emit one shared success-attestation implementation for every outer SLURM
 * wrapper. The EXIT finalizer invokes it only after the wrapped workload
 * returns zero and both node-local SLURM capture files have been copied to the
 * shared run folder. The file is then atomically renamed, so observing it is
 * causal evidence that capture-log persistence completed first. SLURM_JOB_ID
 * and the executing node come from the allocation that actually ran this
 * script.
 */
export function buildSlurmCompletionAttestationBlock({
  runId,
  runFolder,
}: {
  runId: string;
  runFolder: string;
}): string {
  if (!runId.trim()) {
    throw new Error('SLURM completion attestation requires a run ID');
  }
  assertSafeSlurmRunFolder(runFolder);

  return `RUN_FOLDER=${shellQuote(runFolder)}
SEQDESK_PIPELINE_RUN_ID=${shellQuote(runId)}
: "\${SLURM_JOB_ID:?SLURM_JOB_ID is required for the outer SLURM attestation}"
SLURM_ATTESTATION_FILE="$RUN_FOLDER/logs/slurm-$SLURM_JOB_ID${SLURM_COMPLETION_ATTESTATION_SUFFIX}"
rm -f "$SLURM_ATTESTATION_FILE"

${WRITE_SLURM_COMPLETION_ATTESTATION_COMMAND}() {
  local attestation_tmp
  local attestation_host
  if [ "\${SEQDESK_CAPTURE_LOGS_COPIED:-0}" -ne 1 ]; then
    echo "Refusing SLURM success attestation before capture logs are persisted" >&2
    return 1
  fi
  attestation_tmp="$SLURM_ATTESTATION_FILE.tmp.$$"
  attestation_host="\${SLURMD_NODENAME:-$(hostname)}"
  if [ -z "$attestation_host" ]; then
    echo "Cannot determine the executing SLURM host" >&2
    return 1
  fi
  (
    umask 077
    {
      printf 'schema_version=${SLURM_COMPLETION_ATTESTATION_SCHEMA_VERSION}\\n'
      printf 'run_id=%s\\n' "$SEQDESK_PIPELINE_RUN_ID"
      printf 'slurm_job_id=%s\\n' "$SLURM_JOB_ID"
      printf 'host=%s\\n' "$attestation_host"
      printf 'phase=${SLURM_COMPLETION_ATTESTATION_PHASE}\\n'
      printf 'exit_code=0\\n'
    } > "$attestation_tmp"
    mv -f "$attestation_tmp" "$SLURM_ATTESTATION_FILE"
  )
}`;
}
