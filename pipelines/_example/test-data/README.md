# Test-Data Fixture

This directory holds the minimal dummy input fixture for the pipeline package.

## Convention

**Every pipeline package in the store ships a minimal test-data fixture here.**
SeqDesk CI runs the pipeline on this dummy data to prove the package works end to
end before it is accepted. Contributors MUST include a fixture when submitting a
pipeline PR.

Keep the fixture as small as possible:

- Just enough input to exercise every declared step on tiny data.
- A handful of synthetic reads per file (not real biological data).
- Plain-text `.fastq` is preferred over binary `.fastq.gz` so the fixture stays
  human-reviewable in the PR and editable as text. (Gzipped fixtures are allowed
  if a step strictly requires them, but avoid them when text works.)
- File names must match what `samplesheet.yaml` / `manifest.json` reference so the
  generated samplesheet resolves against these files.

## Files in this fixture

This example declares short-read, **paired-end Illumina** input. The samplesheet
(`../samplesheet.yaml`) emits one row per sample with `fastq_1` (`read.file1`) and
`fastq_2` (`read.file2`) columns, so the fixture provides one sample with an
R1/R2 pair:

| File              | Role                          |
| ----------------- | ----------------------------- |
| `sample1_R1.fastq` | Forward reads (`fastq_1` / R1) |
| `sample1_R2.fastq` | Reverse reads (`fastq_2` / R2) |

Each file contains 4 synthetic 32 bp reads with uniform high quality (`I`).

## How CI uses these files

CI generates the samplesheet from the package's declarative `samplesheet.yaml`,
resolving `fastq_1` / `fastq_2` against the files in this directory (the
`prepend_path` transform's `${DATA_BASE_PATH}` points at this fixture during the
dummy run), then runs the Nextflow pipeline on them. A real package's fixture
should produce non-empty outputs for each discovery pattern declared in
`manifest.json`.
