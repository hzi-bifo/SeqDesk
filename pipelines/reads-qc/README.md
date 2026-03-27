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
