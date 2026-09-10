# Read Cleaning

SeqDesk wrapper for `nf-core/detaxizer` 1.3.0.

This order-scoped package only accepts active reads marked `raw` or `unknown`.
Pipeline completion stores cleaned FASTQ files as run artifacts. An admin must
review the cleaning report and promote selected candidates before SeqDesk uses
them as active `cleaned` reads for delivery or downstream pipelines.

Required runtime configuration:

- `kraken2Db` when Kraken2 classification is enabled.
- `bbdukReference` when BBDuk classification is enabled.

SeqDesk intentionally does not pick or download a contaminant database
implicitly.

## Report table

The package's output-discovery script preserves `summary/summary.tsv` and writes
an additional standard JSON table, `seqdesk-read-screening-summary.json`. Its
manifest owns the sample identity mapping, measurement labels, types and units;
Explore uses the same table preview and chart controls as for any other package.

The adapter follows the pinned [detaxizer 1.3.0 summary format](https://nf-co.re/detaxizer/1.3.0/docs/output#summary):
an unnamed sample-index column, classifier-dependent headers and `_longReads`
sample suffixes. Ambiguous sample names, unexpected columns or malformed counts
prevent the derived table from being registered. The original summary remains
available, with a discovery error explaining why the report table is unavailable.
Repeated discovery reuses an identical table; existing files are not overwritten.

`classified_read_ids` counts IDs flagged by the contaminant classification step,
**not** total, retained or necessarily removed reads. Missing BLAST validation
statistics are null, not zero. Reporting never promotes cleaned reads or changes
the existing admin-review policy. For historical runs, the JSON artifact must be
created and registered by explicitly re-discovering outputs; simply opening a
report never runs this adapter or reruns the pipeline.

## Citation

This package runs the **nf-core/detaxizer** Nextflow pipeline (host/contaminant
read screening and filtering), which is built on the nf-core framework and
wraps upstream tools including Kraken2, BBDuk/BBMap, seqkit, and MultiQC.

If you use this pipeline, please cite:

- **nf-core/detaxizer** — Seidel J, Kaipf C, Straub D, Nahnsen S. nf-core/detaxizer:
  a benchmarking study for decontamination from human sequences. *NAR Genomics and
  Bioinformatics*. 2025;7(3):lqaf125. doi:[10.1093/nargab/lqaf125](https://doi.org/10.1093/nargab/lqaf125)
- **nf-core framework** — Ewels PA, Peltzer A, Fillinger S, et al. The nf-core
  framework for community-curated bioinformatics pipelines. *Nature Biotechnology*.
  2020;38:276-278. doi:[10.1038/s41587-020-0439-x](https://doi.org/10.1038/s41587-020-0439-x)

Please also cite the upstream tools used by your run, as listed on the pipeline's
citation page (https://nf-co.re/detaxizer) and in its `CITATIONS.md`:

- **Kraken2** — Wood DE, Lu J, Langmead B. (2019). doi:[10.1186/s13059-019-1891-0](https://doi.org/10.1186/s13059-019-1891-0)
- **seqkit** — Shen W, Le S, Li Y, Hu F. (2016). doi:[10.1371/journal.pone.0163962](https://doi.org/10.1371/journal.pone.0163962)
- **MultiQC** — Ewels P, Magnusson M, Lundin S, Käller M. (2016). doi:[10.1093/bioinformatics/btw354](https://doi.org/10.1093/bioinformatics/btw354)
- **BBDuk / BBMap** — Bushnell B. BBMap (no DOI assigned); see https://nf-co.re/detaxizer
  for the reference details to cite.

For any tool not listed above, see https://nf-co.re/detaxizer for full citation details.
