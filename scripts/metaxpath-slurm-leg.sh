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

before="$(squeue -u "$ME" -h -o '%i' 2>/dev/null || true)"

# Give the SLURM job enough cores AND memory to parallelize like the head node. metaxpath runs ~3
# tasks in parallel at 48 GB each; the previous 4-core/64 GB allocation serialized them (only ~1 big
# task fits 64 GB) and tripled the wall-time past the timeout. 16 cores + 256 GB (a fraction of the
# 1.3 TB nodes) lets 3 big tasks run at once. Generous sbatch time (360 min) + e2e wait (16200 s /
# 4.5 h) as a safety net so the run completes and is detected. --skip-local forces SLURM only.
if SEQDESK_RUNTIME_E2E_SLURM_CORES=16 \
   SEQDESK_RUNTIME_E2E_SLURM_MEMORY=256G \
   SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=360 \
   node "$GITHUB_WORKSPACE/scripts/run-pipeline-runtime-e2e.mjs" \
     --base-url "http://127.0.0.1:${PORT}" \
     --email "admin@example.com" --password "admin" \
     --pipeline-id metaxpath --study-alias gemma-nanopore-metaxpath \
     --config-json '{"metaxProfileMemory":"48 GB","predVfsAmrsMemory":"48 GB"}' \
     --skip-local --skip-if-disabled --timeout 16200; then
  echo "metaxpath SLURM leg OK"
else
  echo "WARN (warn-only): metaxpath SLURM leg did not pass — not failing the suite"
fi

# Free the slot: cancel only the job(s) this leg submitted (leave any other jobs untouched).
new=""
for j in $(squeue -u "$ME" -h -o '%i' 2>/dev/null || true); do
  if ! echo "$before" | grep -qx "$j"; then new="$new $j"; fi
done
if [ -n "$new" ]; then
  echo "freeing QOS slot — cancelling metaxpath SLURM job(s):$new"
  scancel $new 2>/dev/null || true
fi

# Forensics (non-fatal): surface how far the newest metaxpath run got, so a timeout is diagnosable
# (queued vs slow vs failed) without another blind multi-hour iteration. PROFILE_RUN_DIR (the runs
# root) is inherited from the workflow step env.
( set +e +o pipefail
  mxdir="$(find "${PROFILE_RUN_DIR:-/nonexistent}" -maxdepth 1 -type d -name 'METAXPATH-*' 2>/dev/null | sort | tail -1)"
  if [ -n "$mxdir" ] && [ -f "$mxdir/logs/pipeline.out" ]; then
    echo "--- SLURM metaxpath run forensics: $mxdir ---"
    echo "tasks COMPLETED so far: $(grep -c 'status: COMPLETED' "$mxdir/logs/pipeline.out" 2>/dev/null)"
    grep -iE "Workflow completed|Submitted process|terminated|ERROR ~|Creating env using conda|peakMemory" "$mxdir/logs/pipeline.out" 2>/dev/null | tail -15
  fi
) || true

echo "::endgroup::"
exit 0
