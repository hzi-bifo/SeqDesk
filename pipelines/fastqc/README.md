# FastQC Pipeline

Local Nextflow pipeline used by SeqDesk to run FastQC quality control on linked FASTQ files.

Inputs come from order-linked `Read` records. The pipeline produces per-sample HTML reports, zip archives with detailed metrics, and a run-level summary TSV with pass/warn/fail counts plus read counts and average sequence quality. Both single-end and paired-end reads are supported.

## Outputs

- `fastqc_reports/{sampleId}_R1_fastqc.html` - Interactive HTML report for R1
- `fastqc_reports/{sampleId}_R1_fastqc.zip` - Detailed metrics archive for R1
- `fastqc_reports/{sampleId}_R2_fastqc.html` - Interactive HTML report for R2 (paired-end only)
- `fastqc_reports/{sampleId}_R2_fastqc.zip` - Detailed metrics archive for R2 (paired-end only)
- `summary/fastqc-summary.tsv` - Per-sample pass/warn/fail counts, read counts, and average sequence quality

## Citation

This is a SeqDesk-internal Nextflow pipeline that wraps the **FastQC** quality-control tool (bioconda `fastqc=0.12.1`). It is not an nf-core pipeline.

If you use this pipeline, please cite:

- **FastQC** — Andrews S. *FastQC: A Quality Control Tool for High Throughput Sequence Data*. Babraham Bioinformatics. Available online at: https://www.bioinformatics.babraham.ac.uk/projects/fastqc/ (the tool's official page lists no formal paper or DOI; please cite the tool and URL as above).
- **SeqDesk** — the pipeline wrapper and orchestration. See https://seqdesk.org.
