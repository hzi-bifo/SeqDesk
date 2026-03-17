# FastQC Pipeline

Local Nextflow pipeline used by SeqDesk to run FastQC quality control on linked FASTQ files.

Inputs come from order-linked `Read` records. The pipeline produces per-sample HTML reports, zip archives with detailed metrics, and a run-level summary TSV with pass/warn/fail counts. Both single-end and paired-end reads are supported.

## Outputs

- `fastqc_reports/{sampleId}_R1_fastqc.html` - Interactive HTML report for R1
- `fastqc_reports/{sampleId}_R1_fastqc.zip` - Detailed metrics archive for R1
- `fastqc_reports/{sampleId}_R2_fastqc.html` - Interactive HTML report for R2 (paired-end only)
- `fastqc_reports/{sampleId}_R2_fastqc.zip` - Detailed metrics archive for R2 (paired-end only)
- `summary/fastqc-summary.tsv` - Per-sample pass/warn/fail counts
