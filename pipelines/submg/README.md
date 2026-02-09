# SubMG Pipeline Package

This package exposes `submg` submission in SeqDesk's pipeline UI.

Execution is handled by SeqDesk's custom SubMG runner (`src/lib/pipelines/submg/submg-runner.ts`), which:
- Generates SubMG YAML files from study/sample/read/assembly/bin data.
- Executes `submg submit` for each generated config.
- Parses SubMG output logs and receipts.
- Persists ENA accession numbers back to SeqDesk models.

The package files are still required for the shared package loader and UI metadata.
