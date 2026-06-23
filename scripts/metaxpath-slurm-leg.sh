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

# Shrink the Gemma reads for the SLURM run ONLY — the local hard gate already ran on the full 0.05
# subset, and the later mag/read-cleaning legs use different data, so this is safe. A shorter job fits
# a read-cleaning-sized time limit (90 min), which the scheduler BACKFILLS into small gaps far more
# readily than metaxpath's old 150 min — that long slot is why it kept sitting PENDING for hours.
# Keep ~50% of reads per file (fixed seed). FULLY non-fatal.
if [ -n "${PROFILE_DATA_DIR:-}" ]; then
  ( set +e +o pipefail
    while IFS= read -r fq; do
      case "$fq" in
        *.gz) zcat "$fq" 2>/dev/null | awk 'BEGIN{srand(11)} NR%4==1{k=(rand()<0.5)} k' | gzip > "$fq.sub" 2>/dev/null && mv -f "$fq.sub" "$fq" ;;
        *)    awk 'BEGIN{srand(11)} NR%4==1{k=(rand()<0.5)} k' "$fq" > "$fq.sub" 2>/dev/null && mv -f "$fq.sub" "$fq" ;;
      esac
    done < <(find "$PROFILE_DATA_DIR" -path '*gemma-nanopore-metaxpath*' \( -name '*.fastq.gz' -o -name '*.fq.gz' -o -name '*.fastq' -o -name '*.fq' \) -type f 2>/dev/null)
    echo "shrank Gemma reads ~50% for the SLURM leg (shorter job -> backfill-schedulable)" ) || true
fi

# THE scheduling fix: SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT is in HOURS, not minutes. The inline
# executor writes it verbatim into the wrapper as "#SBATCH -t <N>:0:0", so the earlier 60 meant 60
# HOURS (-t 60:0:0) — far past the cpu partition's MaxTime, so the job sat PENDING forever with reason
# "(PartitionTimeLimit)". (read-cleaning schedules at the same value only because its per-process
# executor overrides this blanket with detaxizer's own nf-core per-process times.) 2 (= -t 2:0:0 =
# 2 h) sits above the ~25 min subsampled run and below the cap. 32 GB/2-core (peak ~3 GB), mem 24 GB.
#
# Retry up to 3x: the inline job runs on a shared-cluster compute node where setup (NFS propagation of
# the just-created run dir, conda activation) occasionally hiccups and the job dies in <1 min before
# Nextflow starts. A failed setup is fast, so a retry is cheap and may land on a healthy node; a real
# completion (~25 min) breaks on the first pass. dump_forensics surfaces the exit code + Nextflow/conda
# stream + SLURM preamble stderr so a PERSISTENT failure is diagnosable without another blind iteration.
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
    fi
    echo "--- pipeline.err tail (Nextflow startup / conda) ---"
    [ -f "$mxdir/logs/pipeline.err" ] && tail -40 "$mxdir/logs/pipeline.err" 2>/dev/null
    echo "--- SLURM stderr tail (preamble: NFS-wait / conda bootstrap before Nextflow) ---"
    for e in "$mxdir"/logs/slurm-*.err; do [ -f "$e" ] && { echo "[$e]"; tail -40 "$e" 2>/dev/null; }; done
  ) || true
}

ok=0
for attempt in 1 2 3; do
  echo "metaxpath SLURM attempt ${attempt}/3"
  before="$(squeue -u "$ME" -h -o '%i' 2>/dev/null || true)"
  if SEQDESK_RUNTIME_E2E_SLURM_CORES=2 \
     SEQDESK_RUNTIME_E2E_SLURM_MEMORY=32G \
     SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=2 \
     node "$GITHUB_WORKSPACE/scripts/run-pipeline-runtime-e2e.mjs" \
       --base-url "http://127.0.0.1:${PORT}" \
       --email "admin@example.com" --password "admin" \
       --pipeline-id metaxpath --study-alias gemma-nanopore-metaxpath \
       --config-json '{"metaxProfileMemory":"24 GB","predVfsAmrsMemory":"24 GB"}' \
       --skip-local --skip-if-disabled --timeout 3600; then
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
[ "$ok" = 1 ] || echo "WARN (warn-only): metaxpath SLURM leg did not pass after 3 attempts — not failing the suite"

echo "::endgroup::"
exit 0
