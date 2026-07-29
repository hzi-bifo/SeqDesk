#!/usr/bin/env bash
# metaxpath SLURM leg (warn-only) for the install-profile-alma E2E.
#
# Extracted from the inline "Verify installed app startup and auth flows" run block: that step also
# drives every Gemma pipeline run, and the inline leg pushed the block past GitHub's per-segment
# expression-template limit (~21000 chars per literal between `${{ }}`). Keeping it as a script holds
# the workflow under that limit and makes the leg independently runnable.
#
# Re-runs the installed app's metaxpath through the SLURM executor (inline: one sbatch on an OFFLINE
# compute node) AFTER the local run has already classified and warmed metaxpath's per-process conda
# envs into the shared-FS cache — the SLURM leg reuses those by hash. Pipeline/runtime failure is
# warn-only, but cleanup identity failure is fatal: the script captures the exact PipelineRun/job
# identity from the runtime harness and never signals an account-wide or queue-delta job set.
#
# Inherits from the workflow env: GITHUB_WORKSPACE, SLURM_SHARED_CONDA_BASE/ENV (gate),
# SEQDESK_SLURM_INLINE_EXECUTOR. Arg 1 = the installed app's port.
set -uo pipefail

PORT="${1:?usage: metaxpath-slurm-leg.sh <port>}"

echo "::group::metaxpath SLURM leg (warn-only)"

CURRENT_STATE_FILE=""

slurm_job_state() {
  local job_id="${1:-}"
  local queue_ids
  if [[ ! "$job_id" =~ ^[0-9]+$ ]]; then
    printf '%s\n' unknown
  elif ! queue_ids="$(squeue -h -o '%i' 2>/dev/null)"; then
    printf '%s\n' unknown
  elif printf '%s\n' "$queue_ids" | grep -qx "$job_id"; then
    printf '%s\n' active
  else
    printf '%s\n' inactive
  fi
}

slurm_job_identity_state() {
  local job_id="${1:-}"
  local run_folder="${2:-}"
  local expected_job_name="${3:-}"
  local info actual_job_name actual_work_dir
  if [[ ! "$job_id" =~ ^[0-9]+$ ]] ||
     [ -z "$run_folder" ] || [ -z "$expected_job_name" ]; then
    printf '%s\n' unknown
    return 0
  fi
  if ! info="$(scontrol show job -o "$job_id" 2>/dev/null)"; then
    printf '%s\n' unknown
    return 0
  fi
  actual_job_name="$(printf '%s\n' "$info" | tr ' ' '\n' | sed -n 's/^JobName=//p' | head -n 1)"
  actual_work_dir="$(printf '%s\n' "$info" | tr ' ' '\n' | sed -n 's/^WorkDir=//p' | head -n 1)"
  if [ -z "$actual_job_name" ] || [ -z "$actual_work_dir" ]; then
    printf '%s\n' unknown
  elif [ "$actual_job_name" = "$expected_job_name" ] &&
       [ "$actual_work_dir" = "$run_folder" ]; then
    printf '%s\n' matches
  else
    printf '%s\n' mismatch
  fi
}

mark_cleanup_unsafe() {
  local message="${1:-SLURM cleanup identity could not be proven}"
  if [ -n "${SEQDESK_SLURM_CLEANUP_GUARD:-}" ]; then
    printf '%s\n' "$message" > "$SEQDESK_SLURM_CLEANUP_GUARD"
  fi
}

cancel_captured_run() {
  local state_file="${1:-}"
  local run_id job_id run_folder profile_root resolved_run safe_run_id
  local expected_job_name job_state identity_state identity_text
  local db_row db_job_id db_run_folder db_pipeline_id db_mode
  local -a identity=()

  # A disabled pipeline or an HTTP failure before run creation submits no job.
  [ -s "$state_file" ] || return 0
  if ! identity_text="$(node -e '
    const fs = require("node:fs");
    const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(`${state.runId || ""}\n${state.jobId || ""}\n${state.runFolder || ""}\n`);
  ' "$state_file")"; then
    echo "ERROR: could not parse metaxpath run-state file $state_file" >&2
    return 1
  fi
  mapfile -t identity <<< "$identity_text"
  run_id="${identity[0]:-}"
  job_id="${identity[1]:-}"
  run_folder="${identity[2]:-}"

  if [[ ! "$run_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: invalid metaxpath PipelineRun id in $state_file" >&2
    return 1
  fi
  if [ -z "$job_id" ]; then
    if ! command -v psql >/dev/null 2>&1 || [ -z "${DB_NAME:-}" ]; then
      echo "ERROR: metaxpath state has run $run_id but no job id, and its database row cannot be resolved." >&2
      return 1
    fi
    if ! db_row="$(PGPASSWORD="${DB_PASSWORD:-seqdesk}" psql \
      -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" \
      -U "${DB_USER:-seqdesk}" -d "$DB_NAME" -At -F '|' \
      -c "select coalesce(\"queueJobId\", ''), coalesce(\"runFolder\", ''), \"pipelineId\", coalesce(\"executionMode\", '') from \"PipelineRun\" where id='$run_id'" \
      2>/dev/null)"; then
      echo "ERROR: could not resolve metaxpath PipelineRun $run_id from $DB_NAME." >&2
      return 1
    fi
    IFS='|' read -r db_job_id db_run_folder db_pipeline_id db_mode <<< "$db_row"
    if [ "$db_pipeline_id" != "metaxpath" ] ||
       { [ -n "$run_folder" ] && [ "$run_folder" != "$db_run_folder" ]; } ||
       { [ -n "$db_job_id" ] && { [[ ! "$db_job_id" =~ ^[0-9]+$ ]] || [ "$db_mode" != "slurm" ]; }; }; then
      echo "ERROR: metaxpath PipelineRun $run_id database identity is inconsistent." >&2
      return 1
    fi
    job_id="$db_job_id"
    run_folder="$db_run_folder"
    if [ -z "$job_id" ]; then
      echo "metaxpath PipelineRun $run_id has no queue allocation in its exact database row."
      return 0
    fi
  fi

  if [[ ! "$job_id" =~ ^[0-9]+$ ]] ||
     [ -z "$run_folder" ] || [ -z "${PROFILE_RUN_DIR:-}" ]; then
    echo "ERROR: incomplete metaxpath PipelineRun identity in $state_file" >&2
    return 1
  fi
  profile_root="$(readlink -f "$PROFILE_RUN_DIR" 2>/dev/null || true)"
  resolved_run="$(readlink -f "$run_folder" 2>/dev/null || true)"
  if [ -z "$profile_root" ] || [ -z "$resolved_run" ] ||
     [[ "$resolved_run" != "$profile_root/"* ]]; then
    echo "ERROR: metaxpath run folder is outside this profile run root: $run_folder" >&2
    return 1
  fi
  job_state="$(slurm_job_state "$job_id")"
  if [ "$job_state" = "inactive" ]; then
    return 0
  fi
  if [ "$job_state" = "unknown" ]; then
    echo "ERROR: metaxpath job $job_id queue state is unknown." >&2
    return 1
  fi

  safe_run_id="$(printf '%s' "$run_id" | sed 's/[^A-Za-z0-9_-]/-/g' | cut -c1-48)"
  expected_job_name="seqdesk-$safe_run_id"
  identity_state="$(slurm_job_identity_state \
    "$job_id" "$run_folder" "$expected_job_name")"
  if [ "$identity_state" != "matches" ]; then
    job_state="$(slurm_job_state "$job_id")"
    if [ "$job_state" = "inactive" ]; then
      return 0
    fi
    echo "ERROR: refusing metaxpath scancel for $job_id; queue state=$job_state identity=$identity_state, expected JobName=$expected_job_name WorkDir=$run_folder." >&2
    return 1
  fi

  echo "freeing QOS slot — cancelling captured metaxpath PipelineRun $run_id job $job_id"
  if ! scancel "$job_id" 2>/dev/null; then
    job_state="$(slurm_job_state "$job_id")"
    [ "$job_state" = "inactive" ] && return 0
    echo "ERROR: scancel failed for metaxpath job $job_id and its state is $job_state." >&2
    return 1
  fi
  for _ in $(seq 1 24); do
    job_state="$(slurm_job_state "$job_id")"
    [ "$job_state" = "inactive" ] && return 0
    if [ "$job_state" = "unknown" ]; then
      echo "ERROR: metaxpath job $job_id queue state became unknown during cancellation." >&2
      return 1
    fi
    sleep 5
  done
  echo "ERROR: captured metaxpath job $job_id survived bounded cancellation." >&2
  return 1
}

cleanup_current_attempt_on_exit() {
  local original_rc=$?
  trap - EXIT
  if [ -n "$CURRENT_STATE_FILE" ] &&
     ! cancel_captured_run "$CURRENT_STATE_FILE"; then
    mark_cleanup_unsafe "metaxpath cleanup failed for state $CURRENT_STATE_FILE"
    exit 1
  fi
  exit "$original_rc"
}
trap cleanup_current_attempt_on_exit EXIT

# No extra subsampling. With the time-limit UNIT fixed (2 h easily fits the full run) there is no
# reason to halve the reads — and halving was actively HARMFUL: at ~0.025 flye assembled a near-empty
# contig set and METAX_PROFILE then failed in seconds (exit 1, 0 tasks completed, on every attempt).
# Run the SLURM leg on the SAME full 0.05 Gemma subset the LOCAL hard gate proves working, so the only
# remaining variable is local-vs-SLURM execution.
echo "metaxpath SLURM leg: full 0.05 Gemma subset (no extra subsampling)"

# THE scheduling fix: SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT is in HOURS, not minutes. The inline
# executor writes it verbatim into the wrapper as "#SBATCH -t <N>:0:0", so the earlier 60 meant 60
# HOURS (-t 60:0:0) — far past the cpu partition's MaxTime, so the job sat PENDING forever with reason
# "(PartitionTimeLimit)". (read-cleaning schedules at the same value only because its per-process
# executor overrides this blanket with detaxizer's own nf-core per-process times.) 2 (= -t 2:0:0 =
# 2 h) sits above the ~45 min full run and below the cap. 64 GB / 4-core, memory override 48 GB.
#
# CPU admission: metaxpath's METAX_PROFILE/SYLPH_PROFILE/PRED_VFS_AMRS declare cpus={params.threads}
# (default 20), and SAM2BAM hardcodes cpus=4. The LOCAL run admits these because resourceLimits caps
# cpus to the host core count; the inline-SLURM path does NOT apply resourceLimits, so a cpus=20
# process is rejected pre-flight ("requirement exceeds available CPUs") inside a small -c cgroup —
# an instant exit-1 with 0 tasks (the failure we saw). Fix: -c 4 AND threads=4 (-> --threads, capping
# the param-driven processes to 4) so every declaration fits the allocation.
#
# Retry up to 2x: a genuine compute-node setup hiccup (NFS propagation of the just-created run dir,
# conda activation) dies in <1 min, so one retry is cheap and may land on a healthy node; a real
# completion (~45 min) breaks on the first pass. dump_forensics surfaces the exit code + the failed
# process's Command error / .command.err so a PERSISTENT failure is diagnosable without another blind iteration.
dump_forensics() {
  ( set +e +o pipefail
    sleep 8  # let the compute node copy its node-local slurm-<job>.err back over NFS before we read
    mxdir="$(find "${PROFILE_RUN_DIR:-/nonexistent}" -maxdepth 1 -type d -name 'METAXPATH-*' 2>/dev/null | sort | tail -1)"
    [ -n "$mxdir" ] || return 0
    echo "--- SLURM metaxpath run forensics: $mxdir ---"
    if [ -f "$mxdir/logs/pipeline.out" ]; then
      echo "tasks COMPLETED so far: $(grep -c 'status: COMPLETED' "$mxdir/logs/pipeline.out" 2>/dev/null)"
      grep -E "Pipeline completed with exit code" "$mxdir/logs/pipeline.out" 2>/dev/null | tail -2 \
        || echo "NO EXIT MARKER — run.sh died before its trap (run dir not visible on the node?)"
      grep -iE "Workflow completed|Submitted process|terminated|ERROR ~|Creating env using conda|peakMemory" "$mxdir/logs/pipeline.out" 2>/dev/null | tail -15
      echo "--- failed-process error report (Caused by / Command error / exit status) ---"
      grep -A6 'Caused by' "$mxdir/logs/pipeline.out" 2>/dev/null | head -16
      grep -A20 'Command error:' "$mxdir/logs/pipeline.out" 2>/dev/null | head -28
      wd="$(grep -oE '/[^ ]*/work/[a-f0-9]{2}/[a-f0-9]+' "$mxdir/logs/pipeline.out" 2>/dev/null | tail -1)"
      if [ -n "$wd" ] && [ -d "$wd" ]; then
        echo "  failed work dir: $wd  .exitcode=$(cat "$wd/.exitcode" 2>/dev/null || echo '<none>')"
        echo "  --- .command.err tail ---"; tail -40 "$wd/.command.err" 2>/dev/null
      fi
    fi
    echo "--- pipeline.err tail (Nextflow startup / conda) ---"
    [ -f "$mxdir/logs/pipeline.err" ] && tail -40 "$mxdir/logs/pipeline.err" 2>/dev/null
    echo "--- SLURM stderr tail (preamble: NFS-wait / conda bootstrap before Nextflow) ---"
    for e in "$mxdir"/logs/slurm-*.err; do [ -f "$e" ] && { echo "[$e]"; tail -40 "$e" 2>/dev/null; }; done
    # The app's finalize decision is the ground truth for a false-completion: it prints totalSteps,
    # completedKnownSteps, queueState, statusDeterminedByQueue, inferredExitCode + forceRunningFromQueue.
    # Captured from the installed app's server log so a recurrence pinpoints the exact completion path.
    echo "--- app RUN-FINALIZE decisions for metaxpath (server log) ---"
    [ -n "${SERVER_LOG:-}" ] && [ -f "${SERVER_LOG:-}" ] && grep -aE 'RUN-FINALIZE' "${SERVER_LOG}" 2>/dev/null | grep -a 'metaxpath' | tail -10
  ) || true
}

ok=0
for attempt in 1 2; do
  echo "metaxpath SLURM attempt ${attempt}/2"
  CURRENT_STATE_FILE="${RUNNER_TEMP:-/tmp}/metaxpath-slurm-state-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}-${attempt}.json"
  rm -f "$CURRENT_STATE_FILE"
  if SEQDESK_RUNTIME_E2E_SLURM_CORES=4 \
     SEQDESK_RUNTIME_E2E_SLURM_MEMORY=64G \
     SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=2 \
     node "$GITHUB_WORKSPACE/scripts/run-pipeline-runtime-e2e.mjs" \
       --base-url "http://127.0.0.1:${PORT}" \
       --email "admin@example.com" --password "admin" \
       --pipeline-id metaxpath --study-alias gemma-nanopore-metaxpath \
       --config-json '{"metaxProfileMemory":"48 GB","predVfsAmrsMemory":"48 GB","threads":4}' \
       --skip-local --skip-if-disabled --timeout 5400 \
       --run-state-file "$CURRENT_STATE_FILE"; then
    ok=1
  fi
  if ! cancel_captured_run "$CURRENT_STATE_FILE"; then
    mark_cleanup_unsafe "metaxpath cleanup failed for state $CURRENT_STATE_FILE"
    CURRENT_STATE_FILE=""
    exit 1
  fi
  CURRENT_STATE_FILE=""
  if [ "$ok" = 1 ]; then echo "metaxpath SLURM leg OK"; break; fi
  echo "attempt ${attempt} did not pass"
  dump_forensics
done
[ "$ok" = 1 ] || echo "WARN (warn-only): metaxpath SLURM leg did not pass after 2 attempts — not failing the suite"

echo "::endgroup::"
exit 0
