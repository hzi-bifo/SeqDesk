#!/usr/bin/env bash

set -euo pipefail

ENV_NAME="${PIPELINE_CONDA_ENV:-seqdesk-pipelines}"
KEEP_TEMP=0
RUNNER_LABEL="${PIPELINE_E2E_RUNNER_LABEL:-local}"
WORKFLOW_LABEL="${PIPELINE_E2E_WORKFLOW_LABEL:-Study Pipeline End-to-End}"
TMP_DIR=""

SIMULATE_STATUS="not run"
MAG_STATUS="not run"
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

fail_e2e() {
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
    fail_e2e "Missing expected $label output: $path"
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
    echo "Study pipeline end-to-end artifact manifest"
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
  local assembly_count

  if [[ "$exit_code" -ne 0 ]]; then
    result="failed"
    case "$CURRENT_STAGE" in
      simulate-reads)
        if [[ "$SIMULATE_STATUS" != "passed" ]]; then
          SIMULATE_STATUS="failed"
        fi
        ;;
      mag)
        if [[ "$MAG_STATUS" != "passed" ]]; then
          MAG_STATUS="failed"
        fi
        ;;
    esac
  fi

  if [[ -z "$FAILURE_MESSAGE" && "$exit_code" -ne 0 ]]; then
    FAILURE_MESSAGE="Stage '$CURRENT_STAGE' failed. Check the workflow logs for details."
  fi

  simulate_fastq_count="$(count_matching_files "$SIM_OUT/reads" '*.fastq.gz')"
  assembly_count="$(find "$MAG_OUT" -name '*.contigs.fa.gz' 2>/dev/null | wc -l | tr -d ' ')"
  result_label="$(printf '%s' "$result" | tr '[:lower:]' '[:upper:]')"

  write_artifact_manifest "$result"

  {
    echo "# $WORKFLOW_LABEL"
    echo
    echo "- Result: **$result_label**"
    echo "- Runner: \`$RUNNER_LABEL\`"
    echo "- Simulate reads: \`$SIMULATE_STATUS\`"
    echo "- MAG assembly: \`$MAG_STATUS\`"
    echo "- Temporary run directory: \`$TMP_DIR\`"
    echo "- Artifact manifest: \`$(basename "$ARTIFACT_MANIFEST")\`"
    if [[ -n "$FAILURE_MESSAGE" ]]; then
      echo "- Failure detail: \`$FAILURE_MESSAGE\`"
    fi
    echo
    echo "## Produced outputs"
    echo "- Simulated FASTQ files: \`$simulate_fastq_count\`"
    echo "- Assembly files: \`$assembly_count\`"
    echo
    echo "## Key output files"
    append_key_file "$SIM_OUT/summary/simulation-summary.tsv"
    echo
    echo "### MAG outputs"
    if [[ -d "$MAG_OUT" ]]; then
      find "$MAG_OUT" -type f -name '*.contigs.fa.gz' | head -5 | while read -r f; do
        echo "- \`${f#"$TMP_DIR"/}\`"
      done
    fi
    echo
    echo "Inspect the uploaded artifact to browse the generated FASTQ files and MAG assembly outputs."
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
require_env_command node node -v

if [[ -n "${PIPELINE_E2E_TMPDIR:-}" ]]; then
  TMP_DIR="${PIPELINE_E2E_TMPDIR}"
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"
else
  TMP_DIR="$(mktemp -d)"
fi

SIM_SAMPLESHEET="$TMP_DIR/sim-samplesheet.csv"
MAG_SAMPLESHEET="$TMP_DIR/mag-samplesheet.csv"
SIM_OUT="$TMP_DIR/sim-output"
MAG_OUT="$TMP_DIR/mag-output"
SUMMARY_FILE="$TMP_DIR/STUDY_PIPELINE_E2E_SUMMARY.md"
ARTIFACT_MANIFEST="$TMP_DIR/STUDY_PIPELINE_E2E_ARTIFACTS.txt"

# Step 1: Simulate paired-end reads for two samples (study-scoped)
cat > "$SIM_SAMPLESHEET" <<'EOF'
sample_id,order_id
STUDY_SAMPLE_A,STUDY_ORDER_1
STUDY_SAMPLE_B,STUDY_ORDER_1
EOF

CURRENT_STAGE="simulate-reads"
SIMULATE_STATUS="running"
echo "Running simulate-reads with Conda env '$ENV_NAME'..."
conda run -n "$ENV_NAME" nextflow run pipelines/simulate-reads/workflow/main.nf \
  --input "$SIM_SAMPLESHEET" \
  --outdir "$SIM_OUT" \
  --mode shortReadPaired \
  --readCount 100 \
  --readLength 150

for path in \
  "$SIM_OUT/reads/STUDY_SAMPLE_A_R1.fastq.gz" \
  "$SIM_OUT/reads/STUDY_SAMPLE_A_R2.fastq.gz" \
  "$SIM_OUT/reads/STUDY_SAMPLE_B_R1.fastq.gz" \
  "$SIM_OUT/reads/STUDY_SAMPLE_B_R2.fastq.gz"; do
  require_output_file "$path" "simulate-reads"
done

SIMULATE_STATUS="passed"

# Step 2: Run MAG (lightweight: skip binning, taxonomy, and QC to keep it fast)
cat > "$MAG_SAMPLESHEET" <<EOF
sample,group,short_reads_1,short_reads_2,long_reads
STUDY_SAMPLE_A,0,$SIM_OUT/reads/STUDY_SAMPLE_A_R1.fastq.gz,$SIM_OUT/reads/STUDY_SAMPLE_A_R2.fastq.gz,
STUDY_SAMPLE_B,0,$SIM_OUT/reads/STUDY_SAMPLE_B_R1.fastq.gz,$SIM_OUT/reads/STUDY_SAMPLE_B_R2.fastq.gz,
EOF

CURRENT_STAGE="mag"
MAG_STATUS="running"
echo "Running nf-core/mag (lightweight assembly-only) with Conda env '$ENV_NAME'..."
conda run -n "$ENV_NAME" nextflow run nf-core/mag \
  -r 3.0.0 \
  -profile conda \
  --input "$MAG_SAMPLESHEET" \
  --outdir "$MAG_OUT" \
  --max_cpus 4 \
  --max_memory 15.GB \
  --skip_spades \
  --skip_prokka \
  --skip_concoct \
  --skip_binqc \
  --skip_gtdbtk \
  --skip_quast

# Verify at least the assembly outputs exist
ASSEMBLY_COUNT="$(find "$MAG_OUT" -name '*.contigs.fa.gz' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$ASSEMBLY_COUNT" -eq 0 ]]; then
  fail_e2e "MAG produced no assembly files (*.contigs.fa.gz)"
fi
echo "MAG produced $ASSEMBLY_COUNT assembly file(s)"

MAG_STATUS="passed"
CURRENT_STAGE="completed"

echo "Study pipeline end-to-end test passed (simulate-reads, mag)."
echo "Temporary run directory: $TMP_DIR"
if [[ "$KEEP_TEMP" -eq 0 ]]; then
  echo "Temporary files will be removed on exit."
else
  echo "Temporary files preserved."
fi
