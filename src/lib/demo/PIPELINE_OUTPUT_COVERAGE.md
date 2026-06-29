# Demo pipeline-output coverage

Tracks which pipeline example output is wired into the public demo
(demo.seqdesk.org) for browsing. Reports are **real self-hosted SLURM-runner
output**: the Surface Resistome / Gut Recovery showcase runs on synthetic dummy
data, and the **Mouse Gut Metagenome (PRJDB6165) study on genuine public ENA
data** (eight real mouse-fecal Illumina MiSeq read pairs). Pipelines can't be
launched in the demo (view-only). MetaxPath is excluded on purpose (private).

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

### Real ENA data — Mouse Gut Metagenome (PRJDB6165)

Eight real public mouse-fecal Illumina MiSeq read pairs (DRR099973–DRR099980),
run on the self-hosted SLURM runner via the opt-in `run_mouse_real_data`
workflow input; reports bundled under `public/demo/pipeline/` with `mouse-*`
basenames (study-level) and per-sample `DRR######_R[12]_fastqc.html`.

| Pipeline | Display name | In demo? | Surfaced on | Bundled report | Sample data |
|---|---|---|---|---|---|
| `reads-qc` | Quality Overview | ✅ | Mouse Gut Metagenome (**study**) | `mouse-reads-qc-report.html` | DRR099973–80 (real) |
| `study-demo-report` | Study Demo Report | ✅ | Mouse Gut Metagenome (**study**) | `mouse-demo-report.html` | DRR099973–80 (real) |
| `fastqc` | FastQC | ✅ | Mouse Gut Metagenome (**study**) + per sample | `mouse-fastqc-summary.tsv` + 16 real per-sample HTML | DRR099973–80 (real) |
| `fastq-checksum` | FASTQ Checksum | ✅ | Mouse Gut Metagenome (**study**) | `mouse-checksum-summary.tsv` | DRR099973–80 (real) |

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
- [x] ~~Reports are all wired to one study using dummy data~~ — the Mouse Gut
      (PRJDB6165) study now showcases four pipelines on **real ENA data**.
- [ ] `read-cleaning` + a long-read pipeline still missing for the mouse study
      (read-cleaning has no standalone report; no long-read mouse data).
