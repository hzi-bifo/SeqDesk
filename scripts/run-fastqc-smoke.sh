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
  local label="$1"
  shift
  if ! conda run -n "$ENV_NAME" "$@" >/dev/null 2>&1; then
    echo "Conda environment '$ENV_NAME' is missing required command: $label" >&2
    exit 1
  fi
}

require_env_command nextflow nextflow -version
require_env_command java java -version

if [[ -n "${PIPELINE_SMOKE_TMPDIR:-}" ]]; then
  TMP_DIR="${PIPELINE_SMOKE_TMPDIR}"
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"
else
  TMP_DIR="$(mktemp -d)"
fi

cleanup() {
  if [[ "$KEEP_TEMP" -eq 0 ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT

READS_DIR="$TMP_DIR/reads"
OUTPUT_DIR="$TMP_DIR/fastqc-output"
SAMPLESHEET="$TMP_DIR/samplesheet.csv"

mkdir -p "$READS_DIR"

cat > "$READS_DIR/SINGLE_A_R1.fastq" <<'EOF'
@SINGLE_A:1
ACGTACGT
+
IIIIIIII
@SINGLE_A:2
TGCATGCA
+
HHHHHHHH
EOF
gzip -c "$READS_DIR/SINGLE_A_R1.fastq" > "$READS_DIR/SINGLE_A_R1.fastq.gz"

cat > "$READS_DIR/PAIRED_B_R1.fastq" <<'EOF'
@PAIRED_B:1/1
AACCGGTT
+
JJJJJJJJ
@PAIRED_B:2/1
GATTACAA
+
IIIIIIII
EOF
gzip -c "$READS_DIR/PAIRED_B_R1.fastq" > "$READS_DIR/PAIRED_B_R1.fastq.gz"

cat > "$READS_DIR/PAIRED_B_R2.fastq" <<'EOF'
@PAIRED_B:1/2
TTGGCCAA
+
JJJJJJJJ
@PAIRED_B:2/2
TTGTAATC
+
IIIIIIII
EOF
gzip -c "$READS_DIR/PAIRED_B_R2.fastq" > "$READS_DIR/PAIRED_B_R2.fastq.gz"

cat > "$SAMPLESHEET" <<EOF
sample_id,fastq_1,fastq_2
SINGLE_A,$READS_DIR/SINGLE_A_R1.fastq.gz,
PAIRED_B,$READS_DIR/PAIRED_B_R1.fastq.gz,$READS_DIR/PAIRED_B_R2.fastq.gz
EOF

echo "Running fastqc with Conda env '$ENV_NAME'..."
conda run -n "$ENV_NAME" nextflow run pipelines/fastqc/workflow/main.nf \
  -with-conda \
  --input "$SAMPLESHEET" \
  --outdir "$OUTPUT_DIR"

for path in \
  "$OUTPUT_DIR/fastqc_reports/SINGLE_A_R1_fastqc.html" \
  "$OUTPUT_DIR/fastqc_reports/SINGLE_A_R1_fastqc.zip" \
  "$OUTPUT_DIR/fastqc_reports/PAIRED_B_R1_fastqc.html" \
  "$OUTPUT_DIR/fastqc_reports/PAIRED_B_R1_fastqc.zip" \
  "$OUTPUT_DIR/fastqc_reports/PAIRED_B_R2_fastqc.html" \
  "$OUTPUT_DIR/fastqc_reports/PAIRED_B_R2_fastqc.zip" \
  "$OUTPUT_DIR/summary/fastqc-summary.tsv"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected FastQC output: $path" >&2
    echo "Temporary run directory: $TMP_DIR" >&2
    exit 1
  fi
done

grep -q 'SINGLE_A' "$OUTPUT_DIR/summary/fastqc-summary.tsv"
grep -q 'PAIRED_B' "$OUTPUT_DIR/summary/fastqc-summary.tsv"

echo "FASTQC smoke test passed."
echo "Temporary run directory: $TMP_DIR"
if [[ "$KEEP_TEMP" -eq 0 ]]; then
  echo "Temporary files will be removed on exit."
else
  echo "Temporary files preserved."
fi
