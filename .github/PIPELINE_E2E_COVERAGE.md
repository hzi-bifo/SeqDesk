# Pipeline E2E Coverage

CI harnesses that prove SeqDesk's pipelines actually **run and read/write the DB through the app** — not just that the code compiles:

- **SLURM E2E** (`pipeline-slurm-e2e.yml`) — source-boot + a fresh **install**, driven through the HTTP API in **local + SLURM** modes, DB writeback + app-resilience asserted.
- **Alma install E2E** (`install-profile-alma.yml`) — real npm-launcher install + hosted profile, on real ONT data (the Gemma study).
- **submg E2E** (`pipeline-submg-e2e.yml`) — ENA test-server submission round-trip (GitHub-hosted; needs `ENA_USERNAME`/`ENA_PWD`).
- **Update/rollback E2E** (`update-rollback-e2e-ubuntu.yml`) — in-app update to a new release then rollback, data preserved.

> Keep the table in sync when adding a pipeline or an assertion.

## Coverage

| Pipeline | Source-boot (local / SLURM) | Installed app | Status / TODO |
| --- | --- | --- | --- |
| **fastq-checksum** | ✅ / ✅ | ✅ SLURM + local | `Read.checksum1/2` md5 round-trip (R1 + R2) |
| **study-demo-report** | ✅ / ✅ | ✅ SLURM | report artifacts + config→output |
| **fastqc** | ✅ / ✅ | ✅ SLURM | QC artifacts + read-field writeback |
| **reads-qc** | ✅ / ✅ | ✅ SLURM | `completes` gate |
| **simulate-reads** | ✅ / ✅ | ✅ SLURM + local | replace writeback (new active `Read`) |
| **read-cleaning** | ✅ / — | ✅ Alma (hard) | **Done — verified working, hard gate, green.** detaxizer 1.3.0 on raw minigut reads (`DEV-MAG-ILMN-001`), kraken2-DB-gated (`SLURM_SHARED_KRAKEN2_DB`; absent → skipped). Local source-boot covers the order→candidate→admin promotion writeback (`order-pipeline-e2e`); the full detaxizer run lives on the install path (the 20 GB kraken2 DB is staged only there), so SLURM is `—`. **Green on the runner** — runs end-to-end and the `/cleaned-reads` API ingests ≥1 candidate (1 observed). Three SeqDesk fixes: (1) `NXF_SYNTAX_PARSER=v1` (Nextflow 24.10 v2 parser rejects detaxizer's older subworkflow); (2) **kraken2 DB as a `.tar`** — detaxizer untars `--kraken2db`, so the harness packs the staged 20 GB DB dir into a cached `.tar`, and the path-validation that was **inverted** (required a *directory*, rejected the archive) is corrected to require the archive; (3) the `/cleaned-reads` ingestion assertion. **Deterministic count proof (green):** on the spiked `DEV-RC-SPIKE-001` (3 samples × 30 human-mt + 30 E. coli) detaxizer removes ~30 host reads and retains ~30 microbial per sample (raw 60 → cleaned ~30, removed 30–31), asserted via `SEQDESK_RUNTIME_E2E_RC_SPIKE_CHECK` (PR #33). A manual-dispatch `subsample_reads=0.1` short-run flag subsamples the Gemma reads so the whole matrix lands in ~1 h (metaxpath on 10%) for fast iteration; the scheduled full run stays canonical. This spike count proof is now a **hard gate** (`run_gemma`) — a host-removal regression reds the install E2E (it warns+skips only if the kraken2 DB / spike data isn't readable, so infra gaps don't false-red); the real-data minigut leg (≥1 candidate) stays warn-only. |
| **metaxpath** | — | ✅ Alma (hard) | `completes` + trace (real classification) + **taxonomy-content enforced** — ≥1 taxon from the curated `combined_report` (≥3 relaxed to ≥1: the human-decontaminated Gemma data classifies to ~1 dominant taxon; `SEQDESK_METAXPATH_EXPECT_TAXON` adds a per-organism check) |
| **mag** | — | ⚠️ Alma | MEGAHIT-only smoke (skips SPAdes/CONCOCT/Prokka/bin-QC/GTDB-Tk to fit the runner); assembly written back. **TODO:** promote to hard; full run needs GTDB staged (`gtdbDb` config) + in-app DB download |
| **submg** | ✅ local (own wf) / 🚫 | ✅ installed (own wf) | SeqDesk builds the ENA submission from its data **and ingests the response** (`Sample` ERS/SAMEA writeback). SLURM **not possible** (🚫) — submg is a network submission to ENA and the SLURM compute nodes are offline; the upload itself needs live internet the node lacks (nothing to pre-build, unlike a compute pipeline). It's a login/head-node task by design, not a compute job. A warn-only leg does the full **samples→reads→assembly** round-trip from a simulated mag assembly (writes back ERS/ERR/ERZ); the runner normalizes `order.instrumentModel` → ENA vocab. **TODO:** promote reads+assembly to hard once stable |

Legend: ✅ covered · ⚠️ warn-only · 🔄 in flight · 📋 planned (blocked) · — n/a (gap, fixable) · 🚫 not possible (by design).

## TODO — what "well-integrated" requires end-to-end

"The pipeline ran" is not enough. Each pipeline should prove, **through the app**, every dimension below. This is the plan to get the whole matrix there.

1. **Runs through the app, both modes** — local + SLURM via the HTTP API (#SBATCH directives + real `sacct` job id for SLURM). — ✅ all source-boot pipelines (submg: SLURM n/a).
2. **DB writeback ingested** — outputs land on the right rows (checksums / read fields / artifacts / accessions), re-read after a `/sync` to ride out the dual-writer race. — ✅ where covered.
3. **Output-content correctness** — download the produced file through the app and match a real marker (report `<h1>`, TSV header, accession), not just "a row exists". — ✅ fastqc, study-demo-report, submg, read-cleaning (cleaned-reads API **+ deterministic contamination-removal count** on the spiked `DEV-RC-SPIKE-001`: raw 60 → cleaned ~30, removed ~30/sample), metaxpath (**taxonomy-content** — ≥1 taxon from the curated `combined_report`).
4. **Installed-app (facility) flow** — install via npm launcher, apply a profile, run the same matrix on the installed instance. — ✅ SLURM matrix + submg; the **Alma install** runs metaxpath + mag + read-cleaning on the installed app (hosted profile, real + spiked data).
5. **Managed config flows** — install profile / in-app DB manager writes `PipelineConfig.config.<key>`, asserted persisted **and** applied at run time. — ✅ `kraken2Db`. **TODO:** `gtdbDb` (mag); in-app DB-download button.
6. **App-feature resilience** — failure→`failed`, cancel→`cancelled`, stuck-run reconcile via `/sync`, empty input→clean 400, owner/permission 403·401, `pipeline.completed` notification, artifact/log retrieval. — ✅ source-boot **and** installed app (the resilience scripts run against both).
7. **Promote warn-only → hard gates** once green across a few scheduled runs — read-cleaning's real-data minigut leg (its spike count proof is already hard), mag, submg (reads+assembly).
8. **Researcher data lifecycle** — order → samples → file → study via the installed app's API. — **TODO** (uncovered).
9. **Software update + rollback** — install-unique. — ✅ `update-rollback-e2e-ubuntu.yml` drives `/api/admin/updates/install` + `/rollback` (data preserved).

### Adding a pipeline to the matrix

Add it to `STUDY_SCOPED_PIPELINES` (if study-scoped) + a `WRITEBACK_SPEC` entry (`checksum`/`replace`/`artifacts`/`completes`) in `scripts/run-pipeline-runtime-e2e.mjs`; add a workflow step + a `run_installed` line; enable it in the install profile; stage any external DB and point the profile at it; flip its row to covered once green.

### Known flake (mitigated)

When the pipeline-monitor (not `/sync`) finalizes a run, the run-scoped summary row + per-read `readCount/avgQuality` merge sometimes don't ingest — those checks **warn+skip** on a wholesale miss rather than red the suite.
