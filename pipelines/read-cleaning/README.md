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
