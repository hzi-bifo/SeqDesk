# FastQC quality overview

A small, reusable report analysis for **actual saved FastQC results**. It reads
the summary TSV exposed by the FastQC pipeline, not the FASTQs. It requires no
reference database and works with a single sample as well as several samples.
Figures are interactive Plotly artifacts in the report;
this lightweight kit does not launch server-side Chrome to render PNG files.

## Use in SeqDesk

1. Complete a FastQC run on a sequencing data collection.
2. In a report, choose **Add → Pipeline outputs → FastQC quality summary**.
   Optionally choose a particular completed run to pin the source.
3. Add an analysis using **FastQC quality overview**, attach that table as `qc`
   and run it with the installed `seqdesk-explore-python` environment.
4. Add the three figures, key figures and **FastQC results by mate** table to
   the report page. The analysis records the input dataset version and source
   pipeline run; use the pipeline page for the full R1/R2 HTML reports.

Input columns: `r1_read_count`, `r1_avg_quality`, `r1_pass`, `r1_warn`, `r1_fail`,
and the equivalent optional `r2_*` columns, plus the mapped sample identity.
Duplicate sample rows fail with an actionable error rather than double-counting
repeated runs. Missing values and missing mates are never replaced with zero.
Totals affected by missing values stay unknown instead of presenting partial
sums as complete results; a wholly unmeasured sample fails with an explanation.

The overview shows reads **per mate**, mean per-sequence Phred quality (not Q30)
and counts of FastQC check flags. A successful pipeline can still have WARN or
FAIL checks. Those checks require inspection of the original reports; this kit
does not classify reads as cleaned, validate benchmark accuracy or perform
case-control inference. A one-sample report compares mates, not replicates.

The bundled regression fixture uses the saved CAMI sample_0 summary from
FASTQC-20260908-001, with a test-only sample record identifier. It contains
16,647,395 reads per mate and mean qualities 33.7 / 31.9. No scientific values
are invented for the example report.

Tests: `python -m pytest explore/kits/fastqc-overview/test-data -q`.

## Pipeline authors

Report-ready tables are declared in a pipeline manifest under `outputs[].table`:
`label`, `description`, `columnLabels` (column key → readable label), `tableKind`,
`format`, `sampleColumn` and optional semantic `roles`. The picker groups actual
completed output artifacts by pipeline, shows the producing runs, and links back
to the original pipeline reports. It does not turn HTML files into table data.
The bundled FastQC manifest is an example; a compatibility entry also exposes
summaries already produced by older FastQC packages. No rerun is required.

## Citation

The source measurements come from FastQC; retain the software version and
citation supplied by the original pipeline reports. This kit uses pandas for
tabular data and Plotly for figures. SeqDesk records the analysis code revision,
input dataset version and environment with each run.
