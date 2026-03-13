#!/usr/bin/env bash

set -euo pipefail

ENV_NAME="${PIPELINE_CONDA_ENV:-seqdesk-pipelines}"
KEEP_TEMP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-temp)
      KEEP_TEMP=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v conda >/dev/null 2>&1; then
  echo "conda is required for the smoke test" >&2
  exit 1
fi

if ! conda env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
  echo "Conda environment '$ENV_NAME' was not found" >&2
  exit 1
fi

require_env_command() {
  local command_name="$1"
  if ! conda run -n "$ENV_NAME" bash -lc "command -v '$command_name' >/dev/null 2>&1"; then
    echo "Conda environment '$ENV_NAME' is missing required command: $command_name" >&2
    exit 1
  fi
}

require_env_command nextflow
require_env_command java
require_env_command node
require_env_command md5sum

TMP_DIR="$(mktemp -d)"

cleanup() {
  if [[ "$KEEP_TEMP" -eq 0 ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT

SIM_SAMPLESHEET="$TMP_DIR/sim-samplesheet.csv"
CHECKSUM_SAMPLESHEET="$TMP_DIR/checksum-samplesheet.csv"
SIM_OUT="$TMP_DIR/sim-output"
CHECKSUM_OUT="$TMP_DIR/checksum-output"

cat > "$SIM_SAMPLESHEET" <<'EOF'
sample_id,order_id
SAMPLE_A,ORDER_X
SAMPLE_B,ORDER_X
EOF

echo "Running simulate-reads with Conda env '$ENV_NAME'..."
conda run -n "$ENV_NAME" nextflow run pipelines/simulate-reads/workflow/main.nf \
  --input "$SIM_SAMPLESHEET" \
  --outdir "$SIM_OUT" \
  --mode shortReadPaired \
  --readCount 4 \
  --readLength 75

for path in \
  "$SIM_OUT/reads/SAMPLE_A_R1.fastq.gz" \
  "$SIM_OUT/reads/SAMPLE_A_R2.fastq.gz" \
  "$SIM_OUT/reads/SAMPLE_B_R1.fastq.gz" \
  "$SIM_OUT/reads/SAMPLE_B_R2.fastq.gz" \
  "$SIM_OUT/manifests/SAMPLE_A.json" \
  "$SIM_OUT/manifests/SAMPLE_B.json" \
  "$SIM_OUT/summary/simulation-summary.tsv"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected simulator output: $path" >&2
    echo "Temporary run directory: $TMP_DIR" >&2
    exit 1
  fi
done

grep -q 'SAMPLE_A' "$SIM_OUT/summary/simulation-summary.tsv"
grep -q 'SAMPLE_B' "$SIM_OUT/summary/simulation-summary.tsv"

cat > "$CHECKSUM_SAMPLESHEET" <<EOF
sample_id,fastq_1,fastq_2
SAMPLE_A,$SIM_OUT/reads/SAMPLE_A_R1.fastq.gz,$SIM_OUT/reads/SAMPLE_A_R2.fastq.gz
SAMPLE_B,$SIM_OUT/reads/SAMPLE_B_R1.fastq.gz,$SIM_OUT/reads/SAMPLE_B_R2.fastq.gz
EOF

echo "Running fastq-checksum with Conda env '$ENV_NAME'..."
conda run -n "$ENV_NAME" nextflow run pipelines/fastq-checksum/workflow/main.nf \
  --input "$CHECKSUM_SAMPLESHEET" \
  --outdir "$CHECKSUM_OUT"

for path in \
  "$CHECKSUM_OUT/checksums/SAMPLE_A.json" \
  "$CHECKSUM_OUT/checksums/SAMPLE_B.json" \
  "$CHECKSUM_OUT/summary/checksum-summary.tsv"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected checksum output: $path" >&2
    echo "Temporary run directory: $TMP_DIR" >&2
    exit 1
  fi
done

grep -q 'SAMPLE_A' "$CHECKSUM_OUT/summary/checksum-summary.tsv"
grep -q 'SAMPLE_B' "$CHECKSUM_OUT/summary/checksum-summary.tsv"

echo "Order pipeline smoke test passed."
echo "Temporary run directory: $TMP_DIR"
if [[ "$KEEP_TEMP" -eq 0 ]]; then
  echo "Temporary files will be removed on exit."
else
  echo "Temporary files preserved."
fi
