# FASTQ Checksum Pipeline

Minimal local Nextflow pipeline used by SeqDesk to compute MD5 checksums for linked FASTQ files.

Inputs come from order-linked `Read` records. The pipeline emits per-sample JSON files and a run-level TSV summary. SeqDesk uses the package-local discover script to write checksum values back into `Read.checksum1` and `Read.checksum2`.
