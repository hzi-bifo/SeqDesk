# MetaxPath Pipeline Package

This package integrates MetaxPath into SeqDesk. The workflow source lives in a separate private repository and is pulled by Nextflow at runtime.

## Hosting Model

- Workflow source: `github.com/hzi-bifo/MetaxPath` (branch `Nextflow`)
- SeqDesk package path: `pipelines/metaxpath/`
- Nextflow pulls the code at runtime via: `nextflow run hzi-bifo/MetaxPath -r Nextflow`

## Package Contents

- `manifest.json`: execution contract and parameter mapping
- `definition.json`: DAG/process mapping for UI progress
- `registry.json`: UI form schema and defaults
- `samplesheet.yaml`: samplesheet generation rules

## Server Requirements

Since `hzi-bifo/MetaxPath` is a private repository, the server running SeqDesk needs GitHub access for Nextflow to clone the workflow at runtime. This requires one of:

- An SSH key (`~/.ssh/id_*`) with read access to the repo
- A GitHub personal access token configured via `SCM_FILE` or `~/.nextflow/scm` (see [Nextflow docs](https://www.nextflow.io/docs/latest/sharing.html#scm-configuration))

Runtime also requires external databases/tools configured in pipeline settings (Metax, Kraken2, Sylph, etc.).

## Pipeline Store Publishing

Keep this package as source of truth for SeqDesk integration, then publish metadata in SeqDesk.com:

- `src/data/registry/index.json`
- `src/data/registry/pipelines/metaxpath.json`
- `src/data/registry/packages/metaxpath/<version>.json`
