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

The package declares that TSV as a typed `sample-summary` table in its manifest.
The shared report data picker offers it for tables and charts using the declared
labels and units (`reads`, `bp`, `Phred`); no NanoPlot-specific report UI is needed.
Each row summarizes one sample. A chart of mean lengths across samples must not
be interpreted as a distribution of individual read lengths; use the original
NanoPlot HTML report for those plots. Existing compatible summary TSV artifacts
can be used after the package declaration is updated without rerunning NanoPlot.

## Dependencies

- `NanoPlot` (installed via Conda from Bioconda, `nanoplot=1.42.0`), with
  Python 3.12 and `python-kaleido=0.2.1` pinned because NanoPlot 1.42 uses the
  pre-1.0 `kaleido.scopes` API

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

- SeqDesk's admin dummy dataset includes a dedicated single-end ONT order. The
  required self-hosted acceptance gate runs this package against that order in
  both local and real SLURM modes and verifies report/stat artifacts, summary
  metrics, and exact per-run `Read` writeback.
