#!/usr/bin/env bash
# mag SLURM leg (warn-only, Tier 1) for the install-profile-alma E2E.
#
# Mirrors scripts/metaxpath-slurm-leg.sh. Re-runs the installed app's nf-core/mag through the SLURM
# executor (inline: ONE sbatch on an OFFLINE compute node) AFTER the LOCAL mag leg has already
#   (1) seeded the mag-smoke order (DEV-MAG-ILMN-001) onto the shared FS, and
#   (2) warmed mag's per-process conda envs into the shared conda cacheDir,
# both of which this SLURM leg REUSES by content hash. Tier 1 ONLY: the existing MEGAHIT-ONLY smoke
# (skips SPAdes/CONCOCT/Prokka/bin-QC/GTDB-Tk) — it proves an assembly is produced AND written back
# (the app holds a mag run in `running` until a materialized Assembly/Bin/artifact exists). NOT the
# full GTDB run. Pipeline/runtime failure is warn-only, but cleanup identity failure is fatal:
# the script captures the exact PipelineRun/job identity and never signals an account-wide or
# queue-delta job set.
#
# Inherits from the workflow env: GITHUB_WORKSPACE, SLURM_SHARED_CONDA_BASE/ENV (gate),
# SEQDESK_SLURM_INLINE_EXECUTOR, PROFILE_RUN_DIR, SERVER_LOG. Arg 1 = the installed app's port.
set -uo pipefail

PORT="${1:?usage: mag-slurm-leg.sh <port>}"

echo "::group::mag SLURM leg (warn-only, Tier 1 MEGAHIT smoke)"

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
    echo "ERROR: could not parse mag run-state file $state_file" >&2
    return 1
  fi
  mapfile -t identity <<< "$identity_text"
  run_id="${identity[0]:-}"
  job_id="${identity[1]:-}"
  run_folder="${identity[2]:-}"

  if [[ ! "$run_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: invalid mag PipelineRun id in $state_file" >&2
    return 1
  fi
  if [ -z "$job_id" ]; then
    if ! command -v psql >/dev/null 2>&1 || [ -z "${DB_NAME:-}" ]; then
      echo "ERROR: mag state has run $run_id but no job id, and its database row cannot be resolved." >&2
      return 1
    fi
    if ! db_row="$(PGPASSWORD="${DB_PASSWORD:-seqdesk}" psql \
      -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" \
      -U "${DB_USER:-seqdesk}" -d "$DB_NAME" -At -F '|' \
      -c "select coalesce(\"queueJobId\", ''), coalesce(\"runFolder\", ''), \"pipelineId\", coalesce(\"executionMode\", '') from \"PipelineRun\" where id='$run_id'" \
      2>/dev/null)"; then
      echo "ERROR: could not resolve mag PipelineRun $run_id from $DB_NAME." >&2
      return 1
    fi
    IFS='|' read -r db_job_id db_run_folder db_pipeline_id db_mode <<< "$db_row"
    if [ "$db_pipeline_id" != "mag" ] ||
       { [ -n "$run_folder" ] && [ "$run_folder" != "$db_run_folder" ]; } ||
       { [ -n "$db_job_id" ] && { [[ ! "$db_job_id" =~ ^[0-9]+$ ]] || [ "$db_mode" != "slurm" ]; }; }; then
      echo "ERROR: mag PipelineRun $run_id database identity is inconsistent." >&2
      return 1
    fi
    job_id="$db_job_id"
    run_folder="$db_run_folder"
    if [ -z "$job_id" ]; then
      echo "mag PipelineRun $run_id has no queue allocation in its exact database row."
      return 0
    fi
  fi

  if [[ ! "$job_id" =~ ^[0-9]+$ ]] ||
     [ -z "$run_folder" ] || [ -z "${PROFILE_RUN_DIR:-}" ]; then
    echo "ERROR: incomplete mag PipelineRun identity in $state_file" >&2
    return 1
  fi
  profile_root="$(readlink -f "$PROFILE_RUN_DIR" 2>/dev/null || true)"
  resolved_run="$(readlink -f "$run_folder" 2>/dev/null || true)"
  if [ -z "$profile_root" ] || [ -z "$resolved_run" ] ||
     [[ "$resolved_run" != "$profile_root/"* ]]; then
    echo "ERROR: mag run folder is outside this profile run root: $run_folder" >&2
    return 1
  fi
  job_state="$(slurm_job_state "$job_id")"
  if [ "$job_state" = "inactive" ]; then
    return 0
  fi
  if [ "$job_state" = "unknown" ]; then
    echo "ERROR: mag job $job_id queue state is unknown." >&2
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
    echo "ERROR: refusing mag scancel for $job_id; queue state=$job_state identity=$identity_state, expected JobName=$expected_job_name WorkDir=$run_folder." >&2
    return 1
  fi

  echo "freeing QOS slot — cancelling captured mag PipelineRun $run_id job $job_id"
  if ! scancel "$job_id" 2>/dev/null; then
    job_state="$(slurm_job_state "$job_id")"
    [ "$job_state" = "inactive" ] && return 0
    echo "ERROR: scancel failed for mag job $job_id and its state is $job_state." >&2
    return 1
  fi
  for _ in $(seq 1 24); do
    job_state="$(slurm_job_state "$job_id")"
    [ "$job_state" = "inactive" ] && return 0
    if [ "$job_state" = "unknown" ]; then
      echo "ERROR: mag job $job_id queue state became unknown during cancellation." >&2
      return 1
    fi
    sleep 5
  done
  echo "ERROR: captured mag job $job_id survived bounded cancellation." >&2
  return 1
}

cleanup_current_attempt_on_exit() {
  local original_rc=$?
  trap - EXIT
  if [ -n "$CURRENT_STATE_FILE" ] &&
     ! cancel_captured_run "$CURRENT_STATE_FILE"; then
    mark_cleanup_unsafe "mag cleanup failed for state $CURRENT_STATE_FILE"
    exit 1
  fi
  exit "$original_rc"
}
trap cleanup_current_attempt_on_exit EXIT

# RESOURCE ADMISSION — THE KEY mag-specific risk (the metaxpath cpus=20 trap, recast for mag).
# The inline executor does NOT apply process.resourceLimits (generic-executor gates it on !useSlurm),
# so nf-core/mag's RAW per-process declarations hit the sbatch -c/--mem cgroup directly. mag's
# check_max() ceiling (params.max_cpus/max_memory in nextflow.config) is then the ONLY cap. With
# mag's defaults max_cpus=16 / max_memory=128.GB:
#   MEGAHIT          cpus = check_megahit_cpus(8)  = min(8,16)  = 8   memory = min(40.GB,128) = 40.GB
#   METABAT2_METABAT2 cpus = check_max(8)          = 8   (binning is NOT skipped by this smoke)
#   process_high      cpus = 12 / 72.GB
# An 8-cpu MEGAHIT (or 8-cpu METABAT2) inside a `-c 4` allocation is REJECTED pre-flight
# ("Process requirement exceeds available CPUs") → instant exit-1, 0 tasks — exactly metaxpath's
# failure. FIX: pass --max_cpus / --max_memory so check_max() caps EVERY process to the allocation.
# These keys are not in mag's manifest paramMap, so they flow through buildPipelineFlags' unmapped-key
# fallback as `--max_cpus 4 --max_memory '40.GB'` (isSafeFlagKey allows underscores). -c 4 + 48G --mem
# gives MEGAHIT its 40.GB with headroom. Time limit is in HOURS (the metaxpath trap): 2 (= -t 2:0:0).
#
# Retry up to 2x: a genuine compute-node setup hiccup (NFS propagation of the just-created run dir,
# conda activation) dies in <1 min, so one retry is cheap; a real completion breaks on the first pass.
dump_forensics() {
  ( set +e +o pipefail
    sleep 8  # let the compute node copy its node-local slurm-<job>.err back over NFS before we read
    magdir="$(find "${PROFILE_RUN_DIR:-/nonexistent}" -maxdepth 1 -type d -name 'MAG-*' 2>/dev/null | sort | tail -1)"
    [ -n "$magdir" ] || return 0
    echo "--- SLURM mag run forensics: $magdir ---"
    if [ -f "$magdir/logs/pipeline.out" ]; then
      echo "tasks COMPLETED so far: $(grep -c 'status: COMPLETED' "$magdir/logs/pipeline.out" 2>/dev/null)"
      grep -E "Pipeline completed with exit code" "$magdir/logs/pipeline.out" 2>/dev/null | tail -2 \
        || echo "NO EXIT MARKER — run.sh died before its trap (run dir not visible on the node?)"
      grep -iE "MEGAHIT|exceeds available|Workflow completed|Submitted process|terminated|ERROR ~|Creating env using conda|peakMemory" "$magdir/logs/pipeline.out" 2>/dev/null | tail -15
      echo "--- failed-process error report (Caused by / Command error / exit status) ---"
      grep -A6 'Caused by' "$magdir/logs/pipeline.out" 2>/dev/null | head -16
      grep -A20 'Command error:' "$magdir/logs/pipeline.out" 2>/dev/null | head -28
      wd="$(grep -oE '/[^ ]*/work/[a-f0-9]{2}/[a-f0-9]+' "$magdir/logs/pipeline.out" 2>/dev/null | tail -1)"
      if [ -n "$wd" ] && [ -d "$wd" ]; then
        echo "  failed work dir: $wd  .exitcode=$(cat "$wd/.exitcode" 2>/dev/null || echo '<none>')"
        echo "  --- .command.err tail ---"; tail -40 "$wd/.command.err" 2>/dev/null
      fi
    fi
    echo "--- assembly artifact(s) discovered (the writeback proof) ---"
    find "$magdir" -type f \( -name '*.contigs.fa.gz' -o -name '*.contigs.fa' -o -name '*.fasta.gz' \) 2>/dev/null | grep -v '/work/conda/' | head -10
    echo "--- pipeline.err tail (Nextflow startup / conda) ---"
    [ -f "$magdir/logs/pipeline.err" ] && tail -40 "$magdir/logs/pipeline.err" 2>/dev/null
    echo "--- SLURM stderr tail (preamble: NFS-wait / conda bootstrap before Nextflow) ---"
    for e in "$magdir"/logs/slurm-*.err; do [ -f "$e" ] && { echo "[$e]"; tail -40 "$e" 2>/dev/null; }; done
    # The app's finalize decision is the ground truth for a false-completion / stuck-running:
    # totalSteps(=14), completedKnownSteps (< 14 because the smoke skips steps),
    # statusDeterminedByQueue, inferredExitCode, forceRunningFromQueue. mag MUST finalize from the
    # exit marker/scheduler (NOT traceCompletedKnownWork) — confirm that path here on any failure.
    echo "--- app RUN-FINALIZE decisions for mag (server log) ---"
    [ -n "${SERVER_LOG:-}" ] && [ -f "${SERVER_LOG:-}" ] && grep -aE 'RUN-FINALIZE' "${SERVER_LOG}" 2>/dev/null | grep -a 'mag' | tail -10
  ) || true
}

ok=0
for attempt in 1 2; do
  echo "mag SLURM attempt ${attempt}/2"
  CURRENT_STATE_FILE="${RUNNER_TEMP:-/tmp}/mag-slurm-state-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}-${attempt}.json"
  rm -f "$CURRENT_STATE_FILE"
  if SEQDESK_RUNTIME_E2E_SLURM_CORES=4 \
     SEQDESK_RUNTIME_E2E_SLURM_MEMORY=48G \
     SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=2 \
     node "$GITHUB_WORKSPACE/scripts/run-pipeline-runtime-e2e.mjs" \
       --base-url "http://127.0.0.1:${PORT}" \
       --email "admin@example.com" --password "admin" \
       --pipeline-id mag --order-number DEV-MAG-ILMN-001 \
       --config-json '{"skipSpades":true,"skipConcoct":true,"skipProkka":true,"skipBinQc":true,"skipGtdbtk":true,"max_cpus":4,"max_memory":"40.GB"}' \
       --skip-local --skip-if-disabled --timeout 5400 \
       --run-state-file "$CURRENT_STATE_FILE"; then
    ok=1
  fi
  if ! cancel_captured_run "$CURRENT_STATE_FILE"; then
    mark_cleanup_unsafe "mag cleanup failed for state $CURRENT_STATE_FILE"
    CURRENT_STATE_FILE=""
    exit 1
  fi
  CURRENT_STATE_FILE=""
  if [ "$ok" = 1 ]; then echo "mag SLURM leg OK"; break; fi
  echo "attempt ${attempt} did not pass"
  dump_forensics
done
[ "$ok" = 1 ] || echo "WARN (warn-only): mag SLURM leg did not pass after 2 attempts — not failing the suite"

echo "::endgroup::"
exit 0
