#!/bin/bash
set -e

# Log file paths
STDOUT_LOG="/Users/pmu15/Documents/github.com/hzi-bifo/Broker4Microbiota/v2/pipeline_output/MAG-20260126-001/logs/pipeline.out"
STDERR_LOG="/Users/pmu15/Documents/github.com/hzi-bifo/Broker4Microbiota/v2/pipeline_output/MAG-20260126-001/logs/pipeline.err"

echo "Starting MAG pipeline at $(date)" > "$STDOUT_LOG"

# Activate conda if configured
# No conda path configured

# Run nf-core/mag with trace and DAG output for monitoring
nextflow run nf-core/mag -r latest \
  --input /Users/pmu15/Documents/github.com/hzi-bifo/Broker4Microbiota/v2/pipeline_output/MAG-20260126-001/samplesheet.csv \
  --outdir /Users/pmu15/Documents/github.com/hzi-bifo/Broker4Microbiota/v2/pipeline_output/MAG-20260126-001/output \
  -with-trace /Users/pmu15/Documents/github.com/hzi-bifo/Broker4Microbiota/v2/pipeline_output/MAG-20260126-001/trace.txt \
  -with-dag /Users/pmu15/Documents/github.com/hzi-bifo/Broker4Microbiota/v2/pipeline_output/MAG-20260126-001/dag.dot \
  -with-report /Users/pmu15/Documents/github.com/hzi-bifo/Broker4Microbiota/v2/pipeline_output/MAG-20260126-001/report.html \
  -with-timeline /Users/pmu15/Documents/github.com/hzi-bifo/Broker4Microbiota/v2/pipeline_output/MAG-20260126-001/timeline.html \
  -stub \
  --skip_megahit \
  --skip_spades \
  --skip_prokka \
  >> "$STDOUT_LOG" 2>> "$STDERR_LOG"

EXIT_CODE=$?
echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"
exit $EXIT_CODE
