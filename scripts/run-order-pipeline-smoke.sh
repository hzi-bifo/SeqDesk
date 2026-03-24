#!/usr/bin/env bash

set -euo pipefail

ENV_NAME="${PIPELINE_CONDA_ENV:-seqdesk-pipelines}"
KEEP_TEMP=0
RUNNER_LABEL="${PIPELINE_SMOKE_RUNNER_LABEL:-local}"
WORKFLOW_LABEL="${PIPELINE_SMOKE_WORKFLOW_LABEL:-Order Pipeline End-to-End Smoke}"
TMP_DIR=""

SIMULATE_STATUS="not run"
CHECKSUM_STATUS="not run"
FASTQC_STATUS="not run"
CURRENT_STAGE="setup"
FAILURE_MESSAGE=""
SUMMARY_FILE=""
ARTIFACT_MANIFEST=""

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

cleanup() {
  if [[ "$KEEP_TEMP" -eq 0 && -n "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

fail_smoke() {
  FAILURE_MESSAGE="$1"
  echo "$FAILURE_MESSAGE" >&2
  if [[ -n "$TMP_DIR" ]]; then
    echo "Temporary run directory: $TMP_DIR" >&2
  fi
  exit 1
}

require_output_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    fail_smoke "Missing expected $label output: $path"
  fi
}

count_matching_files() {
  local dir="$1"
  local pattern="$2"
  if [[ ! -d "$dir" ]]; then
    echo 0
    return
  fi

  find "$dir" -maxdepth 1 -type f -name "$pattern" | wc -l | tr -d ' '
}

append_key_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    echo "- \`${path#"$TMP_DIR"/}\`"
  fi
}

write_artifact_manifest() {
  local result="$1"
  if [[ -z "$ARTIFACT_MANIFEST" ]]; then
    return
  fi

  {
    echo "Order pipeline end-to-end smoke artifact manifest"
    echo "Result: $result"
    echo "Runner: $RUNNER_LABEL"
    echo "Temporary run directory: $TMP_DIR"
    echo
    if [[ -d "$TMP_DIR" ]]; then
      find "$TMP_DIR" -type f | sort | sed "s|^$TMP_DIR/||"
    fi
  } > "$ARTIFACT_MANIFEST"
}

write_summary() {
  local exit_code="$1"
  local result="passed"
  local result_label
  local simulate_fastq_count
  local checksum_json_count
  local fastqc_report_count

  if [[ "$exit_code" -ne 0 ]]; then
    result="failed"
    case "$CURRENT_STAGE" in
      simulate-reads)
        if [[ "$SIMULATE_STATUS" != "passed" ]]; then
          SIMULATE_STATUS="failed"
        fi
        ;;
      fastq-checksum)
        if [[ "$CHECKSUM_STATUS" != "passed" ]]; then
          CHECKSUM_STATUS="failed"
        fi
        ;;
      fastqc)
        if [[ "$FASTQC_STATUS" != "passed" ]]; then
          FASTQC_STATUS="failed"
        fi
        ;;
    esac
  fi

  if [[ -z "$FAILURE_MESSAGE" && "$exit_code" -ne 0 ]]; then
    FAILURE_MESSAGE="Stage '$CURRENT_STAGE' failed. Check the workflow logs for details."
  fi

  simulate_fastq_count="$(count_matching_files "$SIM_OUT/reads" '*.fastq.gz')"
  checksum_json_count="$(count_matching_files "$CHECKSUM_OUT/checksums" '*.json')"
  fastqc_report_count="$(count_matching_files "$FASTQC_OUT/fastqc_reports" '*')"
  result_label="$(printf '%s' "$result" | tr '[:lower:]' '[:upper:]')"

  write_artifact_manifest "$result"

  {
    echo "# $WORKFLOW_LABEL"
    echo
    echo "- Result: **$result_label**"
    echo "- Runner: \`$RUNNER_LABEL\`"
    echo "- Simulate reads: \`$SIMULATE_STATUS\`"
    echo "- FASTQ checksum: \`$CHECKSUM_STATUS\`"
    echo "- FastQC: \`$FASTQC_STATUS\`"
    echo "- Temporary run directory: \`$TMP_DIR\`"
    echo "- Artifact manifest: \`$(basename "$ARTIFACT_MANIFEST")\`"
    if [[ -n "$FAILURE_MESSAGE" ]]; then
      echo "- Failure detail: \`$FAILURE_MESSAGE\`"
    fi
    echo
    echo "## Produced outputs"
    echo "- Simulated FASTQ files: \`$simulate_fastq_count\`"
    echo "- Checksum JSON files: \`$checksum_json_count\`"
    echo "- FastQC report files: \`$fastqc_report_count\`"
    echo
    echo "## Key output files"
    append_key_file "$SIM_OUT/summary/simulation-summary.tsv"
    append_key_file "$CHECKSUM_OUT/summary/checksum-summary.tsv"
    append_key_file "$FASTQC_OUT/summary/fastqc-summary.tsv"
    append_key_file "$CHECKSUM_OUT/checksums/SAMPLE_A.json"
    append_key_file "$CHECKSUM_OUT/checksums/SAMPLE_B.json"
    append_key_file "$FASTQC_OUT/fastqc_reports/SAMPLE_A_R1_fastqc.html"
    append_key_file "$FASTQC_OUT/fastqc_reports/SAMPLE_A_R2_fastqc.html"
    append_key_file "$FASTQC_OUT/fastqc_reports/SAMPLE_B_R1_fastqc.html"
    append_key_file "$FASTQC_OUT/fastqc_reports/SAMPLE_B_R2_fastqc.html"
    echo
    echo "Inspect the uploaded artifact to browse the generated FASTQ files, checksum JSON, summary TSVs, and FastQC reports."
  } > "$SUMMARY_FILE"
}

on_exit() {
  local exit_code="$1"
  if [[ -n "$TMP_DIR" ]]; then
    write_summary "$exit_code"
  fi
  cleanup
}

trap 'on_exit $?' EXIT

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
require_env_command node node -v
require_env_command md5sum md5sum --version

if [[ -n "${PIPELINE_SMOKE_TMPDIR:-}" ]]; then
  TMP_DIR="${PIPELINE_SMOKE_TMPDIR}"
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"
else
  TMP_DIR="$(mktemp -d)"
fi

SIM_SAMPLESHEET="$TMP_DIR/sim-samplesheet.csv"
CHECKSUM_SAMPLESHEET="$TMP_DIR/checksum-samplesheet.csv"
FASTQC_SAMPLESHEET="$TMP_DIR/fastqc-samplesheet.csv"
SIM_OUT="$TMP_DIR/sim-output"
CHECKSUM_OUT="$TMP_DIR/checksum-output"
FASTQC_OUT="$TMP_DIR/fastqc-output"
SUMMARY_FILE="$TMP_DIR/ORDER_PIPELINE_SMOKE_SUMMARY.md"
ARTIFACT_MANIFEST="$TMP_DIR/ORDER_PIPELINE_SMOKE_ARTIFACTS.txt"

cat > "$SIM_SAMPLESHEET" <<'EOF'
sample_id,order_id
SAMPLE_A,ORDER_X
SAMPLE_B,ORDER_X
EOF

CURRENT_STAGE="simulate-reads"
SIMULATE_STATUS="running"
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
  require_output_file "$path" "simulate-reads"
done

grep -q 'SAMPLE_A' "$SIM_OUT/summary/simulation-summary.tsv"
grep -q 'SAMPLE_B' "$SIM_OUT/summary/simulation-summary.tsv"
SIMULATE_STATUS="passed"

cat > "$CHECKSUM_SAMPLESHEET" <<EOF
sample_id,fastq_1,fastq_2
SAMPLE_A,$SIM_OUT/reads/SAMPLE_A_R1.fastq.gz,$SIM_OUT/reads/SAMPLE_A_R2.fastq.gz
SAMPLE_B,$SIM_OUT/reads/SAMPLE_B_R1.fastq.gz,$SIM_OUT/reads/SAMPLE_B_R2.fastq.gz
EOF

CURRENT_STAGE="fastq-checksum"
CHECKSUM_STATUS="running"
echo "Running fastq-checksum with Conda env '$ENV_NAME'..."
conda run -n "$ENV_NAME" nextflow run pipelines/fastq-checksum/workflow/main.nf \
  --input "$CHECKSUM_SAMPLESHEET" \
  --outdir "$CHECKSUM_OUT"

for path in \
  "$CHECKSUM_OUT/checksums/SAMPLE_A.json" \
  "$CHECKSUM_OUT/checksums/SAMPLE_B.json" \
  "$CHECKSUM_OUT/summary/checksum-summary.tsv"; do
  require_output_file "$path" "fastq-checksum"
done

grep -q 'SAMPLE_A' "$CHECKSUM_OUT/summary/checksum-summary.tsv"
grep -q 'SAMPLE_B' "$CHECKSUM_OUT/summary/checksum-summary.tsv"
CHECKSUM_STATUS="passed"

cat > "$FASTQC_SAMPLESHEET" <<EOF
sample_id,fastq_1,fastq_2
SAMPLE_A,$SIM_OUT/reads/SAMPLE_A_R1.fastq.gz,$SIM_OUT/reads/SAMPLE_A_R2.fastq.gz
SAMPLE_B,$SIM_OUT/reads/SAMPLE_B_R1.fastq.gz,$SIM_OUT/reads/SAMPLE_B_R2.fastq.gz
EOF

CURRENT_STAGE="fastqc"
FASTQC_STATUS="running"
echo "Running fastqc with Conda env '$ENV_NAME'..."
conda run -n "$ENV_NAME" nextflow run pipelines/fastqc/workflow/main.nf \
  -with-conda \
  --input "$FASTQC_SAMPLESHEET" \
  --outdir "$FASTQC_OUT"

for path in \
  "$FASTQC_OUT/fastqc_reports/SAMPLE_A_R1_fastqc.html" \
  "$FASTQC_OUT/fastqc_reports/SAMPLE_A_R1_fastqc.zip" \
  "$FASTQC_OUT/fastqc_reports/SAMPLE_A_R2_fastqc.html" \
  "$FASTQC_OUT/fastqc_reports/SAMPLE_A_R2_fastqc.zip" \
  "$FASTQC_OUT/fastqc_reports/SAMPLE_B_R1_fastqc.html" \
  "$FASTQC_OUT/fastqc_reports/SAMPLE_B_R1_fastqc.zip" \
  "$FASTQC_OUT/fastqc_reports/SAMPLE_B_R2_fastqc.html" \
  "$FASTQC_OUT/fastqc_reports/SAMPLE_B_R2_fastqc.zip" \
  "$FASTQC_OUT/summary/fastqc-summary.tsv"; do
  require_output_file "$path" "fastqc"
done

grep -q 'SAMPLE_A' "$FASTQC_OUT/summary/fastqc-summary.tsv"
grep -q 'SAMPLE_B' "$FASTQC_OUT/summary/fastqc-summary.tsv"
FASTQC_STATUS="passed"
CURRENT_STAGE="completed"

echo "Order pipeline smoke test passed (simulate-reads, fastq-checksum, fastqc)."
echo "Temporary run directory: $TMP_DIR"
if [[ "$KEEP_TEMP" -eq 0 ]]; then
  echo "Temporary files will be removed on exit."
else
  echo "Temporary files preserved."
fi
