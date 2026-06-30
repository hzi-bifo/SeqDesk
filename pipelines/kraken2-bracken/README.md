# Kraken2 + Bracken Taxonomic Profiling

Per-sample taxonomic profiling of short reads. Classifies reads with
[Kraken2](https://github.com/DerrickWood/kraken2), re-estimates abundances with
[Bracken](https://github.com/jenniferlu717/Bracken), and renders an interactive
[Krona](https://github.com/marbl/Krona) chart for each sample.

## What it does

For each sample's FASTQ files (R1 and optionally R2):

1. **Kraken2** assigns taxonomy to every read against the configured database
   and writes a classification report.
2. **Bracken** re-estimates abundances at the configured rank (species by
   default) from the Kraken2 report.
3. **Krona** renders an interactive HTML chart of the Bracken abundances.
4. A run-level summary TSV records the top taxon per sample.

The discover-outputs script also parses the top-N taxa (name, taxonomy id,
estimated reads, fraction) out of each Bracken table and stores them in the
per-sample artifact metadata for display in the Taxonomic Profile result column.

## Dependencies

- `kraken2` (bioconda)
- `bracken` (bioconda)
- `krakentools` + `krona` (bioconda)

## Reference database

The pipeline requires a Kraken2 database directory (`kraken2Db`). On the runner
this is pinned to `/net/broker/checkm_refdata/kraken2_db` via the install
profile (`hideWhenServerConfigured: true`).

Bracken additionally needs `databaseXXmers.kmer_distrib` files inside that same
directory, built once with `bracken-build` for the relevant read length (see
`brackenReadLength`). This is a one-time runner setup step.

## Inputs

| Column | Source | Required |
|--------|--------|----------|
| sample_id | sample.sampleId | Yes |
| fastq_1 | read.file1 | Yes |
| fastq_2 | read.file2 | No |

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `kraken2Db` | — | Kraken2 database directory (also holds Bracken kmer distributions) |
| `confidence` | 0.0 | Kraken2 confidence threshold (0.0-1.0) |
| `brackenReadLength` | 150 | Read length selecting the Bracken kmer distribution |
| `brackenLevel` | `S` | Bracken rank (`S` species, `G` genus, `F` family) |
| `krona` | true | Render a per-sample Krona chart |

## Outputs

| Output | Scope | Description |
|--------|-------|-------------|
| `kraken2/{sample_id}.kraken2.report.txt` | Sample | Kraken2 classification report |
| `bracken/{sample_id}.bracken.tsv` | Sample | Bracken abundance table (top taxa parsed into metadata) |
| `krona/{sample_id}.krona.html` | Sample | Interactive Krona chart (previewable) |
| `summary/kraken2-bracken-summary.tsv` | Run | Top taxon per sample |
