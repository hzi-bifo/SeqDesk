# MinKNOW stream regression fixtures

Drop a real captured `fastq_pass/` directory into this folder to give the FASTQ
parser regression coverage against actual nanopore output. The synthetic
simulator data is well-formed but doesn't exercise edge cases that real runs
expose (mixed compression, long-read variance, header oddities, etc.).

## Expected layout

```
__fixtures__/
  fastq_pass/
    barcode01/
      FAS00000_pass_barcode01_<flowcell>_<run>_0.fastq.gz
      ...
    barcode02/
      ...
    expected.json     <-- per-barcode totals you expect the parser to report
```

`expected.json` should look like:

```json
{
  "barcode01": { "reads": 80000, "bases": 142500000 },
  "barcode02": { "reads": 41200, "bases":  73900000 }
}
```

If `expected.json` is present, the regression test asserts the parser's output
matches it byte-for-byte. If it's absent, the test still walks every FASTQ in
the tree and asserts each file is parseable (a softer but useful check).

## How to populate

1. Take a 10-minute MinKNOW run (or copy a few minutes of `fastq_pass/` from a
   colleague — even one barcode is enough for first coverage).
2. Truncate any single barcode subfolder to ~5 files (~20 MB) to keep the
   fixture small. The point is variety, not volume.
3. Compute the expected totals once with the parser itself:
   `npx tsx scripts/seed-expected-fastq-stats.ts <path-to-fixture>` (TODO —
   easy follow-up once we have a real fixture to dogfood with).
4. Commit the `fastq_pass/` tree and `expected.json` together.

## Why this matters

The current parser handles well-formed FASTQ. Real-world drift includes:

- CRLF line endings if files were ever round-tripped through Windows
- gzip files that were re-compressed with different block sizes
- Headers longer than the default `readline` buffer (~64 KB)
- Truncated final records (run ended mid-write)
- Mixed `.fastq` and `.fastq.gz` in the same `barcode01/`

Without a real fixture, we won't notice these regress until prod.
