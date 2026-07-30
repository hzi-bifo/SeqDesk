# New pipelines — TODO plan (Kraken2/Bracken · MultiQC · NanoPlot)

Plan for adding the next three pipelines plus the cross-cutting work to make them
*usable*. Adding a pipeline here is **declarative** (no TypeScript): a `pipelines/<id>/`
package + a thin Nextflow wrapper. The real cost is (a) reference-DB management and
(b) wiring the output into the demo + the seqdesk.org store/docs.

Repos:
- **App / pipelines**: `hzi-bifo/SeqDesk` (`pipelines/`, `src/lib/pipelines`, `src/lib/demo`, `.github/workflows`)
- **Landing + docs + store**: `hzi-bifo/SeqDesk.com` (`src/app/pipelines/page.tsx`, `src/data/pipelines.json`, `src/app/docs/pipelines/`)

---

## 0. Definition of Done — the 5 tracks every pipeline needs

Each pipeline below repeats this checklist. A pipeline is "done" when all five are green.

1. **Implement** (SeqDesk repo, `pipelines/<id>/`) — declarative package:
   - [ ] `manifest.json` — id/version/provider, `targets.supported` (order|study), `inputs`, `outputs` (with `discovery` glob patterns + `previewable`), `writeback` (which DB fields/records), conda/profile.
   - [ ] `definition.json` — step DAG + `processMatchers` (map Nextflow process names → semantic steps).
   - [ ] `registry.json` — UI config: `visibility.showToUser`, `userCanStart`, `configSchema` (params), `sortOrder`, icon, `sequencingCompatibility` (platform/read-length guards).
   - [ ] `samplesheet.yaml` — declarative columns (sample_id, fastq_1/2, platform) with transforms (`prepend_path`).
   - [ ] `parsers/*.yaml` — TSV/CSV → metadata extraction (if writing stats to records).
   - [ ] `scripts/discover-outputs.mjs` — emit `{type, path, sampleId, metadata}` for non-trivial outputs.
   - [ ] `workflow/main.nf` (+ `nextflow.config`) — the actual workflow (usually a thin wrapper over nf-core/modules).
   - [ ] `README.md`.
   - [ ] `npm run pipeline:validate` passes; unit fixtures added.
2. **Runner integration** (SeqDesk repo, `.github/workflows`) — prove it runs on the self-hosted runner:
   - [ ] Add a step to `pipeline-slurm-e2e.yml` (or a dedicated e2e) that runs `npm run pipeline:e2e:runtime -- --pipeline-id <id>` on dummy data (local + SLURM), per the existing pattern.
   - [ ] Stage any reference DB on the shared FS (reuse `SLURM_SHARED_*` + the conda cache).
   - [ ] Optional opt-in step to run on a **real example dataset** (the `*-ena-example.ts` pattern) for demo artifacts.
   - [ ] Transport real reports out via the **`demo-*-reports` branch-push** (the artifact-upload quota is chronically full; the mirror only touches `main`, so a side branch survives).
3. **Demo wiring** (SeqDesk repo, `src/lib/demo`) — make the output browsable on demo.seqdesk.org:
   - [ ] Bundle the real report(s) under `public/demo/pipeline/` (served by basename via `serveDemoPipelineFile`; only `html/tsv/csv/txt`).
   - [ ] Seed a completed + published run on a demo study: `PipelineRun` (+ `PipelineRunStep`/`Event` for realism) + `PipelineArtifact` + `PipelineResultSelection` (`targetKey: study:<id>`), mirroring `seedMouseShowcaseRun` / the native MAG block in `server.ts`. Use a fresh `runNumber` index to avoid the unique-runNumber collision.
   - [ ] If the output maps to a first-class record (assembly/bin/taxonomy), create that record too so the **native** view is populated — not just a report on top.
   - [ ] Bump `DEMO_SEED_VERSION` (`src/lib/demo/config.ts`); update `src/lib/demo/server.test.ts` counts; update `src/lib/demo/PIPELINE_OUTPUT_COVERAGE.md`.
   - [ ] Verify on a real Postgres DB (overlay + bootstrap) then live after deploy.
4. **Pipeline store** (SeqDesk.com repo) — list it in the catalog:
   - [ ] Add an entry to `src/data/pipelines.json` (keys: `id, name, shortName, version, summary, description, workflowDescription, category, provider, status, tags, capabilities, inputTypes, documentation, requirements, inputs, outputs, dag`). Match the existing `mag` entry's shape.
   - [ ] Confirm it renders on `src/app/pipelines/page.tsx` (and any filters/categories).
5. **Docs** (SeqDesk.com repo, `src/app/docs/pipelines/`):
   - [ ] Add a section to `available-pipelines/page.mdx` (What it does · Configuration table · Outputs table · Scope).
   - [ ] Update `_meta.ts` / `page.mdx` index if a new doc page is warranted.
   - [ ] Cross-link from `running-pipelines` / `results` where relevant.

---

## A. Prerequisite (cross-cutting) — reference-DB management

This is the real gatekeeper for taxonomy/profiling. **Do this first** — it unblocks Kraken2,
GTDB-Tk and any future profiler.

- [ ] **Generalize the `kraken2Db` flow** (already exists for `read-cleaning`) into a reusable "managed reference DB" concept: `PipelineConfig.<dbField>`, an admin in-app download button, and the install-profile pin (`apply-install-profile.mjs`).
  - read-cleaning already does this for `kraken2Db` (`SLURM_SHARED_KRAKEN2_DB`, packed `.tar` on the shared FS) — extract the pattern.
- [ ] Add `gtdbDb` (for MAG taxonomy) using the same flow — `mag/manifest.json` already references it.
- [ ] **CI**: stage the DBs on the shared FS once; smoke tests use a tiny stub DB (read-cleaning's `.tar` cache pattern) so they don't pull 50 GB every run.
- [ ] Decide **DB hosting** for Kraken2 (standard 8 GB vs 50+ GB): bundled in the conda/singularity image vs mounted NFS vs on-demand download. Document the default for facility installs.

---

## B. Pipeline 1 — Kraken2 + Bracken (taxonomic profiling) ⭐ highest value

Answers "what organisms are in this sample" — the #1 missing metagenomics capability.
nf-core modules exist for both Kraken2 and Bracken.

**Implement** (`pipelines/kraken2-bracken/`):
- [ ] manifest: scope `study` (and/or `order`); inputs = paired/single reads; outputs = Kraken2 report (`*.kraken2.report.txt`), Bracken abundance TSV (`*.bracken.tsv`), Krona HTML (`*.krona.html`); writeback = top-N taxa onto `Sample` metadata (decision A below) + artifacts.
- [ ] registry config: `kraken2Db` (managed ref DB, track A), `confidence`, `brackenReadLength`, `brackenLevel` (S/G/F), `krona` toggle.
- [ ] samplesheet: sample_id, fastq_1, fastq_2.
- [ ] parsers: `bracken.yaml` → top taxa + fractions for the dashboard.
- [ ] workflow/main.nf: KRAKEN2_KRAKEN2 → BRACKEN_BRACKEN → KRONA_KTIMPORTTAXONOMY (copy from nf-core/modules).
- [ ] **Decision A (writeback scope)**: write top-5 taxa to `Sample.metadata` JSON (+1 day, enables a per-sample dashboard) vs artifact-only (0 extra, fully declarative). Recommend: top-N to metadata — it's what makes taxonomy *useful* in the UI.

**Runner**: needs the Kraken2 DB on the shared FS (track A). Run on the human-gut + mouse demo data (both have real reads already staged via the example datasets).

**Demo wiring**: bundle a real Krona HTML (browsable) + a `*-bracken-top-taxa.tsv`; seed a `kraken2-bracken` showcase run on the **mouse 16S** and/or **human-gut shotgun** study (both already exist with real reads). If Decision A = metadata, also write top taxa onto the demo samples so the native per-sample view shows composition.

**Store**: `pipelines.json` entry — category "Taxonomic profiling", status "beta", provider "Kraken2 + Bracken".
**Docs**: available-pipelines section (DB requirement, confidence/level params, Krona output).

Effort: ~2–3 days impl + DB track A.

---

## C. Pipeline 2 — MultiQC (study-level aggregate QC) ⭐ best ROI / lowest effort

One report per study instead of N scattered FastQC/reads-qc/read-cleaning reports.

**Implement** (`pipelines/multiqc/`):
- [ ] manifest: scope `study`; input = the QC outputs of prior runs in the study (the tricky bit — gather `*_fastqc.zip` / `multiqc_data/` / seqkit TSVs produced by fastqc, reads-qc, read-cleaning). outputs = `multiqc_report.html` + `multiqc_data/`.
- [ ] samplesheet/inputs: resolve prior-run output dirs for the study's samples (may need a small `discover-inputs` step or a study-scoped collector; confirm what the generic adapter exposes about sibling runs).
- [ ] workflow/main.nf: single MULTIQC process over the gathered dir.
- [ ] discover-outputs: the `multiqc_report.html` (+ size).

**Runner**: run after fastqc/reads-qc in the e2e; point MultiQC at their output dirs.
**Demo wiring**: bundle the real `multiqc_report.html` (rename to avoid the existing MAG `multiqc_report.html` basename collision, e.g. `study-multiqc.html`); seed a `multiqc` showcase run on a demo study.
**Store + Docs**: catalog entry (category "Quality control / Reporting") + available-pipelines section.

Open question to resolve first: **how MultiQC gets its inputs** — does the adapter let a study-scoped run read sibling runs' output dirs, or do we pass a glob over `SEQDESK_PIPELINE_RUN_DIR`? Spike this (~half day) before committing the 1-day estimate.

Effort: ~1 day once the input-gathering question is answered.

---

## D. Pipeline 3 — NanoPlot (long-read QC)

Only worth it if ONT/PacBio data is coming — there's no long-read QC today.

**Implement** (`pipelines/nanoplot/`):
- [ ] manifest: scope `order`; input = long reads; outputs = NanoPlot HTML report + `NanoStats.txt`; `registry.sequencingCompatibility` guards execution to `readLengthClass: long`.
- [ ] workflow/main.nf: NANOPLOT process (nf-core/modules).
- [ ] parsers: NanoStats → read N50/length/quality onto the read records.

**Prereq**: confirm the data model tracks read type (`readLengthClass`) end-to-end (the recon flagged long-read MAG is gated in `metadata-validation.ts`; NanoPlot is QC-only so lighter, but still needs long-read reads present).
**Runner**: use `simulate-reads --mode longRead` to generate test ONT data, or a small real ONT dataset.
**Demo wiring**: needs a **long-read demo study** (none exists yet) — either add a small real ONT example dataset (ENA) or use simulated long reads; then bundle the NanoPlot HTML + wire the showcase run.
**Store + Docs**: catalog entry (category "Quality control", tag "long-read") + docs.

Effort: ~1 day impl + ~1 day for a long-read demo dataset if we want it browsable.

---

## E. Parallel track — integrate what we already have (don't let outputs pile up)

Because adding pipelines is cheap, the bottleneck is *viewing/acting on* outputs. Do these
alongside B–D so new outputs (taxonomy, bins) land in real UIs.

- [ ] **Verify MAG GTDB-Tk / CheckM2 parsing** → `Bin.completeness/contamination/classification` (recon flagged unverified; `mag/parsers/gtdbtk.yaml` exists). ~0.5 day; quick parser fix if broken.
- [ ] **Assembly / Bin viewer** UI — the records exist (`Assembly`, `Bin`) but the view is thin (we hit this wiring the human-gut MAG). Add `samples/[id]/assemblies` + `bins` views (completeness/contamination, download w/ `allowUserAssemblyDownload`).
- [ ] **Un-hide cleaned-reads promotion** for read-cleaning — `/api/pipelines/runs/[id]/cleaned-reads` exists but the review/promote UI is hidden.
- [ ] **Per-sample QC aggregator** endpoint (`/api/samples/[id]/qc-summary`) collecting fastqc + reads-qc across runs (complements MultiQC at the sample level).
- [ ] (cleanup) Remove legacy `metaxpath-compatibility.ts` references (pipeline folder is gone).

---

## F. Suggested sequence

1. **Track A** (reference-DB generalization) + **E: verify MAG taxonomy** — unblock + de-risk. (~3 days)
2. **MultiQC** (C) — fastest visible win once the input-gathering spike is done. (~1–2 days)
3. **Kraken2 + Bracken** (B) — the real capability gap; needs Track A. (~2–3 days)
4. **E: assembly/bin viewer** — so MAG + (future) taxonomy outputs are usable. (~4–5 days)
5. **NanoPlot** (D) — when long-read data is on the roadmap. (~1–2 days)

Defer (month 2+): HUMAnN (functional), geNomad (viral), AMRFinder/abricate (AMR) — specialist, large DBs, lower facility adoption.

---

## G. Per-pipeline quick status table (fill in as we go)

| Pipeline | Implement | Runner | Demo wiring | Store (.com) | Docs (.com) |
|---|---|---|---|---|---|
| kraken2-bracken | ☐ | ☐ | ☐ | ☐ | ☐ |
| multiqc | ☐ | ☐ | ☐ | ☐ | ☐ |
| nanoplot | ☐ | ☐ | ☐ | ☐ | ☐ |
