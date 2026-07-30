# Study MultiQC

Study-scoped aggregate QC. Runs a single [MultiQC](https://multiqc.info) pass
over declared QC artifacts produced by completed runs in the same study
(FastQC zips and NanoPlot `NanoStats.txt` files) and produces one
consolidated, previewable HTML report.

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
under `params.outdir` (`--input` / `--outdir` are injected by SeqDesk).

During preparation the generic executor reads the manifest's
`priorRunArtifacts` contract, selects only completed study runs and
sample-scoped order-run artifacts that belong to the same study, validates
every selected artifact against its owning run folder, and copies it beneath
`<runFolder>/prior-run-inputs/`. Symlinks, missing files, empty files and path
escapes are rejected. The exact source/staged-file mapping is recorded in
`<runFolder>/prior-run-inputs.json`.

The run fails if no supported prior artifact is available or if MultiQC parses
no sample/module statistics. A content-free report shell is therefore never
accepted as a successful SeqDesk run.
