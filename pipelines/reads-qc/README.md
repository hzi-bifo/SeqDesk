# Reads QC Pipeline

Computes per-sample FASTQ statistics using [seqkit](https://bioinf.shenwei.me/seqkit/) and generates a consolidated HTML summary report.

## What it does

For each sample's FASTQ files (R1 and optionally R2), computes:

- **Read count** and **total bases**
- **Read length** statistics (min, avg, max, N50)
- **Average quality** score (Phred)
- **GC content** percentage
- **Q20 / Q30** percentages

Results are collected into a summary TSV and rendered as a self-contained HTML report with color-coded quality indicators.

## Dependencies

- `seqkit` (installed via conda from bioconda)
- `python >=3.9` (installed via conda from conda-forge)

## Inputs

| Column | Source | Required |
|--------|--------|----------|
| sample_id | sample.sampleId | Yes |
| fastq_1 | read.file1 | Yes |
| fastq_2 | read.file2 | No |

## Outputs

| Output | Scope | Description |
|--------|-------|-------------|
| `per_sample/{sample_id}.tsv` | Sample | Per-sample statistics |
| `summary/reads-qc-summary.tsv` | Run | Combined statistics for all samples |
| `report/reads-qc-report.html` | Run | HTML summary report |

## Writeback

Updates the `Read` model with: `readCount1`, `readCount2`, `avgQuality1`, `avgQuality2`.

## Citation

The Reads QC ("Quality Overview") pipeline is part of SeqDesk. Its statistics are
computed by the upstream tool [seqkit](https://bioinf.shenwei.me/seqkit/) (pinned to
`seqkit=2.8.0`); statistics collection and the HTML report are SeqDesk-internal steps.

If you use this pipeline, please cite SeqDesk (https://seqdesk.org) and the upstream
**seqkit** tool:

- Shen W, Sipos B, Zhao L. SeqKit2: A Swiss Army Knife for Sequence and Alignment
  Processing. *iMeta*. 2024;3(3):e191. doi:10.1002/imt2.191
  (SeqKit2 — corresponds to the `seqkit` 2.x release used here.)
- Shen W, Le S, Li Y, Hu F. SeqKit: A Cross-Platform and Ultrafast Toolkit for FASTA/Q
  File Manipulation. *PLoS ONE*. 2016;11(10):e0163962. doi:10.1371/journal.pone.0163962
  (original SeqKit paper.)

See https://bioinf.shenwei.me/seqkit/ for the current citation guidance.
