# Study Demo Report

This is a tiny built-in Nextflow pipeline for checking the SeqDesk pipeline integration path. It does not call external services, require reference databases, or depend on sample FASTQ files.

The package runs on a study target and emits:

- `report/demo-report.html`
- `report/demo-report.md`
- `tables/sample-summary.tsv`

Use it when you want to verify that SeqDesk can generate a samplesheet, launch a Nextflow workflow, discover outputs, and preview or download pipeline artifacts.

## Citation

Study Demo Report is a built-in SeqDesk pipeline. It is a self-contained demo/integration workflow that wraps no external bioinformatics tool (it only uses the standard Unix `awk` utility), so there is no separate upstream pipeline or method to attribute.

If you use this pipeline, please cite SeqDesk:

- SeqDesk — https://seqdesk.org
