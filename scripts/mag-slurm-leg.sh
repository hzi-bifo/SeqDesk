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
# full GTDB run. ALWAYS exits 0 — warn-only.
#
# Inherits from the workflow env: GITHUB_WORKSPACE, SLURM_SHARED_CONDA_BASE/ENV (gate),
# SEQDESK_SLURM_INLINE_EXECUTOR, PROFILE_RUN_DIR, SERVER_LOG. Arg 1 = the installed app's port.
set -uo pipefail

PORT="${1:?usage: mag-slurm-leg.sh <port>}"
ME="$(whoami)"

echo "::group::mag SLURM leg (warn-only, Tier 1 MEGAHIT smoke)"

# Free the per-user QOS submit slot held by stale PENDING jobs from earlier runs (this cluster caps
# concurrent submissions per user; a leftover PENDING job blocks new submissions). install-alma runs
# serialized, so any PENDING job now is a leftover. The metaxpath SLURM leg (which runs BEFORE this
# one in the workflow) already cancels its own job, but cancel defensively here too.
stale="$(squeue -u "$ME" -h -t PENDING -o '%i' 2>/dev/null || true)"
if [ -n "$stale" ]; then
  echo "cancelling stale PENDING SLURM job(s): $(echo "$stale" | tr '\n' ' ')"
  echo "$stale" | xargs -r scancel 2>/dev/null || true
  for _ in $(seq 1 24); do squeue -u "$ME" -h -t PENDING 2>/dev/null | grep -q . || break; sleep 5; done
fi

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
  before="$(squeue -u "$ME" -h -o '%i' 2>/dev/null || true)"
  if SEQDESK_RUNTIME_E2E_SLURM_CORES=4 \
     SEQDESK_RUNTIME_E2E_SLURM_MEMORY=48G \
     SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=2 \
     node "$GITHUB_WORKSPACE/scripts/run-pipeline-runtime-e2e.mjs" \
       --base-url "http://127.0.0.1:${PORT}" \
       --email "admin@example.com" --password "admin" \
       --pipeline-id mag --order-number DEV-MAG-ILMN-001 \
       --config-json '{"skipSpades":true,"skipConcoct":true,"skipProkka":true,"skipBinQc":true,"skipGtdbtk":true,"max_cpus":4,"max_memory":"40.GB"}' \
       --skip-local --skip-if-disabled --timeout 5400; then
    ok=1
  fi
  # Free the per-user QOS slot: cancel only the job(s) THIS attempt submitted (leave others untouched).
  newjobs=""
  for j in $(squeue -u "$ME" -h -o '%i' 2>/dev/null || true); do
    echo "$before" | grep -qx "$j" || newjobs="$newjobs $j"
  done
  [ -n "$newjobs" ] && { echo "freeing QOS slot — cancelling mag SLURM job(s):$newjobs"; scancel $newjobs 2>/dev/null || true; }
  if [ "$ok" = 1 ]; then echo "mag SLURM leg OK"; break; fi
  echo "attempt ${attempt} did not pass"
  dump_forensics
done
[ "$ok" = 1 ] || echo "WARN (warn-only): mag SLURM leg did not pass after 2 attempts — not failing the suite"

echo "::endgroup::"
exit 0
