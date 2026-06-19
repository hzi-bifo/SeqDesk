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

# Same memory config as the proven local run (48 GB) with a comfortably larger sbatch allocation —
# the 1.3 TB nodes fit it easily. Cap 240 min (first run may queue). --skip-local forces SLURM only.
if SEQDESK_RUNTIME_E2E_SLURM_CORES=4 \
   SEQDESK_RUNTIME_E2E_SLURM_MEMORY=64G \
   SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=240 \
   node "$GITHUB_WORKSPACE/scripts/run-pipeline-runtime-e2e.mjs" \
     --base-url "http://127.0.0.1:${PORT}" \
     --email "admin@example.com" --password "admin" \
     --pipeline-id metaxpath --study-alias gemma-nanopore-metaxpath \
     --config-json '{"metaxProfileMemory":"48 GB","predVfsAmrsMemory":"48 GB"}' \
     --skip-local --skip-if-disabled --timeout 10800; then
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

echo "::endgroup::"
exit 0
