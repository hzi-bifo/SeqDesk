# Study MultiQC

Study-scoped aggregate QC. Runs a single [MultiQC](https://multiqc.info) pass
over the QC outputs produced by earlier runs in the same study (FastQC zips,
seqkit TSVs, read-cleaning `multiqc_data`) and produces one consolidated,
previewable HTML report.

## Inputs

- The study's samples (for samplesheet / report context).
- The **output directories of prior QC runs in the same study**, staged into a
  single gathered directory that the workflow scans recursively.

## Outputs

| Output | Path | Destination |
|---|---|---|
| MultiQC report | `multiqc/study-multiqc.html` | `study_report` (previewable) |
| MultiQC data | `multiqc/multiqc_data/*` | `run_artifact` (download) |

The report basename is `study-multiqc.html` (not the default
`multiqc_report.html`) so it never collides with the `multiqc_report.html`
emitted by the MAG pipeline in the same study/demo.

## Configuration

| Key | Default | Description |
|---|---|---|
| `reportTitle` | `Study MultiQC report` | Title shown at the top of the report |

## Workflow

`workflow/main.nf` defines a single `MULTIQC` process (conda
`bioconda::multiqc=1.21`) that scans `params.qc_dir` recursively and publishes
under `params.outdir` (`--input` / `--outdir` are injected by SeqDesk). If no
prior QC outputs are gathered, an empty scan directory is materialized so the
run still completes with a report shell rather than failing.

## Gathering sibling runs (open item)

The SeqDesk generic executor injects only `--input` (the samplesheet) and
`--outdir`. It does **not** currently stage the output directories of prior
study runs. The declarative samplesheet generator likewise has no source that
resolves prior-run `PipelineArtifact` paths.

To make sibling-run gathering work, a small code hook is needed (smallest
viable change): in the generic executor's run preparation, when the package id
is `multiqc` (or more generally when an input declares a
`prior_run_qc_outputs` source), query the study's completed
`PipelineRun.runFolder`/`PipelineArtifact` paths, copy or symlink each prior
run's `output/` directory under `<runFolder>/qc_inputs/<runId>/`, and export
`--qc_dir <runFolder>/qc_inputs`. The workflow already reads `params.qc_dir`
(falling back to `<samplesheet.parent>/qc_inputs`), so once that directory is
populated no workflow change is required.
