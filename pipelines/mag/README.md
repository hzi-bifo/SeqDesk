# nf-core/mag Pipeline Package

This package describes how SeqDesk integrates the nf-core/mag pipeline.

## Contents

- manifest.json: Source of truth for inputs, outputs, and execution
- definition.json: Workflow DAG + process matchers
- registry.json: UI configuration and settings schema
- samplesheet.yaml: Declarative samplesheet generation
- parsers/: Output parsers (CheckM, GTDB-Tk)

## Notes

- Samplesheets are generated per-sample and require paired-end reads.
- Outputs are routed through the SeqDesk output resolver (no direct DB writes).
- If custom logic is needed, add scripts in scripts/.
