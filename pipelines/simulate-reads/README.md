# Simulate Reads

Order-scoped utility pipeline that generates dummy FASTQ data for selected samples.

This package is intended for local testing and demos. It produces synthetic reads with simple
short-read and long-read modes and writes the generated files back into SeqDesk through the
`sample_reads` output destination.

## Citation

The Simulate Reads pipeline is a SeqDesk-internal test/demo utility. It does not wrap any
external read simulator: reads are produced by SeqDesk's own generator
(`scripts/generate-reads.mjs`), which either synthesises FASTQ records directly or replays
facility-provided template FASTQ pairs. There is no upstream Nextflow pipeline or third-party
tool to attribute.

If you use this pipeline, please cite SeqDesk:

- SeqDesk — https://seqdesk.org

Note: output from this pipeline is synthetic/dummy data for testing and demonstration only and
should not be used as real sequencing data in scientific analyses.
