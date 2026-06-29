# Demo pipeline-output coverage

Tracks which pipeline example output is wired into the public demo
(demo.seqdesk.org) for browsing. All reports are **real self-hosted CI output run
on dummy data**; pipelines can't be launched in the demo (view-only). MetaxPath is
excluded on purpose (private).

How it's wired: reports are bundled under `public/demo/pipeline/` and served by
basename via `src/lib/demo/pipeline-preview.ts` (the demo runs on Vercel with no
pipeline runtime, so files ship in the deploy). Each run is seeded as a completed
+ published `PipelineRun` + `PipelineArtifact` + `PipelineResultSelection` in
`src/lib/demo/server.ts` (the `seedShowcaseRun` helper), so both demo personas can
browse it.

## Coverage

| Pipeline | Display name | In demo? | Surfaced on | Bundled report | Sample data |
|---|---|---|---|---|---|
| `mag` | nf-core/mag | ✅ | Surface Resistome Pilot (**study**) | `multiqc_report.html` (MultiQC) | SR-01/02 — metagenome, short-read |
| `reads-qc` | Quality Overview | ✅ | Surface Resistome Pilot (**study**) | `reads-qc-report.html` | SR-01/02 |
| `study-demo-report` | Study Demo Report | ✅ | Surface Resistome Pilot (**study**) | `demo-report.html` | SR-01/02 |
| `fastqc` | FastQC | ✅ | Surface Resistome (**study**) + Gut Recovery (**order**) | `fastqc-summary.tsv` + per-read FastQC HTML | SR + GR-01/02/03 |
| `simulate-reads` | Simulate Reads | ✅ | Surface Resistome (**study**) + Gut Recovery (**order**) | `simulation-summary.tsv` | SR + GR |
| `fastq-checksum` | FASTQ Checksum | ✅ | Surface Resistome (**study**) + Gut Recovery (**order**) | `checksum-summary.tsv` | SR + GR |
| `read-cleaning` | Read Cleaning | ❌ TODO | — | none (no standalone report) | — |
| `submg` | Submit to ENA | ◐ partial | samples (ENA accessions) | n/a — submission, not a report | IBD + others |
| `metaxpath` | MetaxPath | ⛔ excluded | — | private | — |

All current example data is **short-read (Illumina)**. There is no long-read
showcase.

## Where to look in the demo
- Researcher (`/demo`) or facility (`/demo/admin`) → **Analysis** → study **Surface
  Resistome Pilot** → the 6 published runs above (each opens a report).
- Gut Recovery Cohort **order** → its pipeline history (`fastqc` / `simulate-reads`
  / `fastq-checksum`, with per-sample reads + FastQC reports).

## TODO / gaps
- [ ] **read-cleaning** — produces no standalone report (only `pipeline_info/`).
      Show the raw→cleaned read lineage instead, or add a small summary.
- [ ] **Long-read showcase** — none. Would need an ONT pipeline run's output
      (MetaxPath is excluded as private; no other long-read reports are available
      from CI yet).
- [ ] **submg** — ENA accessions are on samples, but there's no submission-summary
      report view.
- [ ] Reports are all wired to one study (Surface Resistome) using its SR samples;
      could spread across more studies for variety.
- [ ] Report data is the CI dummy run (e.g. `study-demo-report` shows a CI run
      title like `e2e-config-plumb-report-…`); could regenerate with nicer labels.
