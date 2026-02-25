# MetaxPath Pipeline Package

This package integrates MetaxPath into SeqDesk and **hosts the workflow source locally**.

## Hosting Model

- SeqDesk package path: `pipelines/metaxpath/`
- Nextflow entrypoint used by SeqDesk: `pipelines/metaxpath/workflow/main.nf`
- Manifest execution reference: `./workflow`

This means SeqDesk does not need to pull `hzi-bifo/MetaxPath` at runtime for this pipeline.

## Package Contents

- `manifest.json`: execution contract and parameter mapping
- `definition.json`: DAG/process mapping for UI progress
- `registry.json`: UI form schema and defaults
- `samplesheet.yaml`: samplesheet generation rules
- `workflow/`: vendored Nextflow workflow source (config, scripts, bundled reference assets)

## Notes

- The bundled workflow is an initial Nextflow port of the original Snakemake implementation.
- Runtime still requires external databases/tools configured in pipeline settings (Metax/Kraken2/Sylph, etc.).
- If upstream MetaxPath logic changes, sync changes into `workflow/` and update package versioning in the store.

## Pipeline Store Publishing

Keep this package as source of truth, then publish metadata in SeqDesk.com:

- `src/data/registry/index.json`
- `src/data/registry/pipelines/metaxpath.json`
- `src/data/registry/packages/metaxpath/<version>.json`
