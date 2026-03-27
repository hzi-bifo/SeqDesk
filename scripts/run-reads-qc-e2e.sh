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
  echo "conda is required for the end-to-end test" >&2
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

USE_LOCAL_TOOLS=0
LOCAL_PATH_PREFIX=""
if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
  if ! command -v seqkit >/dev/null 2>&1; then
    echo "seqkit is required on macOS ARM for reads-qc local-tool execution" >&2
    exit 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required on macOS ARM for reads-qc local-tool execution" >&2
    exit 1
  fi

  USE_LOCAL_TOOLS=1
  LOCAL_PATH_PREFIX="$(dirname "$(command -v seqkit)")":"$(dirname "$(command -v python3)")"
fi

assert_summary_value() {
  local file="$1"
  local sample="$2"
  local read_end="$3"
  local column="$4"
  local expected="$5"

  local actual
  actual="$(awk -F'\t' -v sample="$sample" -v read_end="$read_end" -v column="$column" '
    NR == 1 {
      for (i = 1; i <= NF; i += 1) {
        if ($i == column) {
          target = i
          break
        }
      }
      next
    }
    $1 == sample && $2 == read_end && target > 0 {
      print $target
      exit
    }
  ' "$file")"

  if [[ "$actual" != "$expected" ]]; then
    echo "Unexpected $column for $sample $read_end: expected '$expected', got '${actual:-<empty>}'" >&2
    echo "Summary file: $file" >&2
    exit 1
  fi
}

assert_summary_float_close() {
  local file="$1"
  local sample="$2"
  local read_end="$3"
  local column="$4"
  local expected="$5"
  local tolerance="$6"

  local actual
  actual="$(awk -F'\t' -v sample="$sample" -v read_end="$read_end" -v column="$column" '
    NR == 1 {
      for (i = 1; i <= NF; i += 1) {
        if ($i == column) {
          target = i
          break
        }
      }
      next
    }
    $1 == sample && $2 == read_end && target > 0 {
      print $target
      exit
    }
  ' "$file")"

  if [[ -z "$actual" ]]; then
    echo "Missing $column for $sample $read_end in $file" >&2
    exit 1
  fi

  awk -v actual="$actual" -v expected="$expected" -v tolerance="$tolerance" '
    BEGIN {
      diff = actual - expected
      if (diff < 0) diff = -diff
      exit(diff <= tolerance ? 0 : 1)
    }
  ' || {
    echo "Unexpected $column for $sample $read_end: expected ~$expected, got $actual" >&2
    echo "Summary file: $file" >&2
    exit 1
  }
}

assert_summary_row_count() {
  local file="$1"
  local sample="$2"
  local expected="$3"

  local actual
  actual="$(awk -F'\t' -v sample="$sample" 'NR > 1 && $1 == sample { count += 1 } END { print count + 0 }' "$file")"

  if [[ "$actual" != "$expected" ]]; then
    echo "Unexpected row count for $sample: expected '$expected', got '$actual'" >&2
    echo "Summary file: $file" >&2
    exit 1
  fi
}

if [[ -n "${PIPELINE_E2E_TMPDIR:-}" ]]; then
  TMP_DIR="${PIPELINE_E2E_TMPDIR}"
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
OUTPUT_DIR="$TMP_DIR/reads-qc-output"
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

echo "Running reads-qc with Conda env '$ENV_NAME'..."
if [[ "$USE_LOCAL_TOOLS" -eq 1 ]]; then
  echo "macOS ARM detected; using local seqkit/python3 without -with-conda."
  env PATH="$LOCAL_PATH_PREFIX:$PATH" \
    conda run -n "$ENV_NAME" nextflow run pipelines/reads-qc/workflow/main.nf \
      --input "$SAMPLESHEET" \
      --outdir "$OUTPUT_DIR"
else
  conda run -n "$ENV_NAME" nextflow run pipelines/reads-qc/workflow/main.nf \
    -with-conda \
    --input "$SAMPLESHEET" \
    --outdir "$OUTPUT_DIR"
fi

for path in \
  "$OUTPUT_DIR/per_sample/SINGLE_A.tsv" \
  "$OUTPUT_DIR/per_sample/PAIRED_B.tsv" \
  "$OUTPUT_DIR/summary/reads-qc-summary.tsv" \
  "$OUTPUT_DIR/report/reads-qc-report.html"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected reads-qc output: $path" >&2
    echo "Temporary run directory: $TMP_DIR" >&2
    exit 1
  fi
done

grep -q 'sample_id' "$OUTPUT_DIR/summary/reads-qc-summary.tsv"
grep -q 'SINGLE_A' "$OUTPUT_DIR/summary/reads-qc-summary.tsv"
grep -q 'PAIRED_B' "$OUTPUT_DIR/summary/reads-qc-summary.tsv"
grep -q 'Reads QC Report' "$OUTPUT_DIR/report/reads-qc-report.html"
grep -q 'Mean Quality' "$OUTPUT_DIR/report/reads-qc-report.html"
grep -q 'SINGLE_A' "$OUTPUT_DIR/report/reads-qc-report.html"
grep -q 'PAIRED_B' "$OUTPUT_DIR/report/reads-qc-report.html"

assert_summary_row_count "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "SINGLE_A" "1"
assert_summary_row_count "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "PAIRED_B" "2"

assert_summary_value "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "SINGLE_A" "R1" "num_reads" "2"
assert_summary_value "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "PAIRED_B" "R1" "num_reads" "2"
assert_summary_value "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "PAIRED_B" "R2" "num_reads" "2"

assert_summary_float_close "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "SINGLE_A" "R1" "avg_quality" "39.5" "0.1"
assert_summary_float_close "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "PAIRED_B" "R1" "avg_quality" "40.5" "0.1"
assert_summary_float_close "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "PAIRED_B" "R2" "avg_quality" "40.5" "0.1"
assert_summary_float_close "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "SINGLE_A" "R1" "q30_pct" "100" "0.01"
assert_summary_float_close "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "PAIRED_B" "R1" "q30_pct" "100" "0.01"
assert_summary_float_close "$OUTPUT_DIR/summary/reads-qc-summary.tsv" "PAIRED_B" "R2" "q30_pct" "100" "0.01"

echo "READS-QC end-to-end test passed."
echo "Temporary run directory: $TMP_DIR"
if [[ "$KEEP_TEMP" -eq 0 ]]; then
  echo "Temporary files will be removed on exit."
else
  echo "Temporary files preserved."
fi
