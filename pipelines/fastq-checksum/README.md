# FASTQ Checksum Pipeline

Minimal local Nextflow pipeline used by SeqDesk to compute MD5 checksums for linked FASTQ files.

Inputs come from order-linked `Read` records. The pipeline emits per-sample JSON files and a run-level TSV summary. SeqDesk uses the package-local discover script to write checksum values back into `Read.checksum1` and `Read.checksum2`.

## Citation

The FASTQ Checksum pipeline is a SeqDesk-internal pipeline. It wraps no external bioinformatics pipeline: it runs a small package-local Nextflow workflow that computes MD5 checksums with the standard `md5sum` utility (GNU coreutils).

If you use this pipeline, please cite SeqDesk:

- SeqDesk — https://seqdesk.org

The workflow is orchestrated with Nextflow. If you wish to acknowledge the workflow engine, please cite the upstream Nextflow project; see https://www.nextflow.io for citation details.
