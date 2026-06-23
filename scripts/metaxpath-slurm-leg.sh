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
# envs into the shared-FS cache — the SLURM leg reuses those by hash. Frees the per-user QOS submit
# slot (this cluster caps concurrent submissions per user): cancel stale PENDING jobs first, then
# only this leg's own job afterwards. ALWAYS exits 0 — this leg is warn-only.
#
# Inherits from the workflow env: GITHUB_WORKSPACE, SLURM_SHARED_CONDA_BASE/ENV (gate),
# SEQDESK_SLURM_INLINE_EXECUTOR. Arg 1 = the installed app's port.
set -uo pipefail

PORT="${1:?usage: metaxpath-slurm-leg.sh <port>}"
ME="$(whoami)"

echo "::group::metaxpath SLURM leg (warn-only)"

# Free the per-user QOS submit slot held by stale PENDING jobs from earlier runs (a leftover PENDING
# job blocks new submissions). install-alma runs serialized, so any PENDING job now is a leftover.
stale="$(squeue -u "$ME" -h -t PENDING -o '%i' 2>/dev/null || true)"
if [ -n "$stale" ]; then
  echo "cancelling stale PENDING SLURM job(s): $(echo "$stale" | tr '\n' ' ')"
  echo "$stale" | xargs -r scancel 2>/dev/null || true
  for _ in $(seq 1 24); do squeue -u "$ME" -h -t PENDING 2>/dev/null | grep -q . || break; sleep 5; done
fi

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
# 2 h) sits above the ~45 min full run and below the cap. 64 GB / 2-core, memory override 48 GB —
# MATCHING the local hard gate's config so memory is not a local-vs-SLURM variable.
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
  ) || true
}

ok=0
for attempt in 1 2; do
  echo "metaxpath SLURM attempt ${attempt}/2"
  before="$(squeue -u "$ME" -h -o '%i' 2>/dev/null || true)"
  if SEQDESK_RUNTIME_E2E_SLURM_CORES=2 \
     SEQDESK_RUNTIME_E2E_SLURM_MEMORY=64G \
     SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=2 \
     node "$GITHUB_WORKSPACE/scripts/run-pipeline-runtime-e2e.mjs" \
       --base-url "http://127.0.0.1:${PORT}" \
       --email "admin@example.com" --password "admin" \
       --pipeline-id metaxpath --study-alias gemma-nanopore-metaxpath \
       --config-json '{"metaxProfileMemory":"48 GB","predVfsAmrsMemory":"48 GB"}' \
       --skip-local --skip-if-disabled --timeout 5400; then
    ok=1
  fi
  # Free the per-user QOS slot: cancel only the job(s) THIS attempt submitted (leave others untouched).
  newjobs=""
  for j in $(squeue -u "$ME" -h -o '%i' 2>/dev/null || true); do
    echo "$before" | grep -qx "$j" || newjobs="$newjobs $j"
  done
  [ -n "$newjobs" ] && { echo "freeing QOS slot — cancelling metaxpath SLURM job(s):$newjobs"; scancel $newjobs 2>/dev/null || true; }
  if [ "$ok" = 1 ]; then echo "metaxpath SLURM leg OK"; break; fi
  echo "attempt ${attempt} did not pass"
  dump_forensics
done
[ "$ok" = 1 ] || echo "WARN (warn-only): metaxpath SLURM leg did not pass after 2 attempts — not failing the suite"

echo "::endgroup::"
exit 0
