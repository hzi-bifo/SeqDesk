# NanoPlot (Long-read QC) Pipeline

Quality control of long reads (Oxford Nanopore / PacBio) using
[NanoPlot](https://github.com/wdecoster/NanoPlot). Produces an interactive
HTML report per sample plus a `NanoStats.txt` metrics file, and writes the key
read metrics back onto the linked `Read` records.

## Scope and compatibility

- **Scope:** sequencing **order** (operates on linked long-read files in an order).
- **Read length class:** `long` — the pipeline is only offered on long-read
  orders. `sequencingCompatibility.readLengthClass = "long"` guards execution so
  it does not appear on short-read (Illumina) orders.
- **Read layout:** single-end (ONT/PacBio).
- **Platform families:** `oxford-nanopore`, `pacbio`.

## What it does

For each sample's long-read FASTQ file, NanoPlot computes and reports:

- **Read count** and **total bases**
- **Read length** statistics (mean, median, **N50**)
- **Mean read quality** (Phred)
- Read-length and quality distribution plots in an interactive HTML report

A run-level summary TSV combines the per-sample metrics.

## Dependencies

- `NanoPlot` (installed via conda from bioconda, `nanoplot=1.42.0`)

## Inputs

| Column | Source | Required |
|--------|--------|----------|
| sample_id | sample.sampleId | Yes |
| fastq | read.file1 | Yes |

## Outputs

| Output | Scope | Description |
|--------|-------|-------------|
| `nanoplot/{sample_id}_NanoPlot-report.html` | Sample | Interactive NanoPlot HTML report (previewable) |
| `nanoplot/{sample_id}_NanoStats.txt` | Sample | NanoStats summary metrics |
| `summary/nanoplot-summary.tsv` | Run | Combined long-read statistics for all samples |

## Writeback

Updates the `Read` model with `readCount1` (number of reads) and `avgQuality1`
(mean read quality). Read length N50 and mean length are also carried in the
artifact metadata.

## Notes

- A long-read demo dataset for SeqDesk does not yet exist; the pipeline has not
  been exercised against bundled demo data.
