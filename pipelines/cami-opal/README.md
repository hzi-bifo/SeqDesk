# CAMI taxonomic benchmark (OPAL)

Study-level evaluation of completed MetaPhlAn profiles against a **separately
supplied CAMI taxonomic Ground Truth**. The reference is never passed to the
profiler. This package runs OPAL **1.0.12** with Python **3.10** via Conda.

## Use in the existing SeqDesk UI

1. Profile the reads with `metaphlan` at sequencing-data or study level.
2. Link the samples through the existing study sample relationship. The generic
   pipeline runtime currently uses `Sample.studyId`; the newer multi-study
   cohort-only membership does not yet substitute for this pipeline input link.
3. An administrator supplies `groundTruthFile`, an absolute execution-host path
   to a real CAMI profile, and enables the package in pipeline settings. It must
   be the matching challenge/dataset/read technology, not an assembly, genome
   abundance file with another schema, or per-read mapping file. No reference
   file or accession is invented or downloaded automatically.
4. In the study's existing Analysis/Pipelines tab, select the benchmark samples.
   Fill `sampleMap` with a JSON object mapping each SeqDesk sample code to its
   **exact** `@SampleID` in the Ground Truth. No filename heuristics are used.
5. Supply completed MetaPhlAn run IDs, comma separated. Blank is accepted only
   if the staged inputs contain exactly one run. Every chosen run must cover
   every selected sample. For multiple sequencing entries, first make a common
   study-level MetaPhlAn run; separate partial runs are not silently stitched.
6. Record challenge, dataset, reference version, database/taxonomy snapshot and
   abundance assumptions in `taxonomyNote`, then confirm compatibility. Start.

SeqDesk stages only declared artifacts from completed runs associated with this
study. Explicit per-sample CAMI profiles and database provenance are required.
Unrelated samples within the same study are excluded from the benchmark. Newer
cohort membership support and a graphical reference-file/sample-mapping picker
are follow-ups; this first version uses the existing configuration form.

## Safeguards and outputs

- Reject missing samples, duplicate mappings/codes/taxa, partial runs, invalid
  percentages, malformed profiles, nonnumeric IDs above strain rank and conflicting
  lineages for a shared taxon. Reference-only samples are explicitly recorded
  as excluded, not counted as missing predictions.
- No implicit GTDB/SGB → NCBI mapping, strain inference, normalization or
  abundance filtering. `normalize` defaults off and is recorded when enabled.
- Evaluation is explicitly superkingdom through species. CAMI's suffixed strain
  identifiers are accepted in references but strain rows are excluded from both
  selected input snapshots and scoring, because MetaPhlAn exports no strain
  predictions. This scope is recorded in provenance.
- Taxonomy checks cannot detect all reference-version differences or database
  coverage biases. Confirmation is an informed declaration, not an automatic
  scientific validation.
- Keep HTML report (`results.html`), machine-readable per-sample/rank `results.tsv`, and
  provenance with reference/prediction SHA-256 values. The ZIP includes HTML
  dependencies, selected input snapshots and provenance for reproducibility.
- References and individual profiles are limited to 64 MiB; generic artifact
  staging also enforces its file-count and total-size limits.

Do not interpret a smoke test or a subsampled run as validation against the full
CAMI sample's expected abundances. Define acceptance thresholds per rank/dataset
before benchmarking. Existing Kraken2/Bracken is available for profiling, but
its native Bracken tables need an explicit taxonomic-format conversion package
before they can be included here; this version accepts MetaPhlAn CAMI exports.

Sources: [OPAL documentation](https://github.com/CAMI-challenge/OPAL),
[CAMI examples](https://cami-challenge.org/examples/).
