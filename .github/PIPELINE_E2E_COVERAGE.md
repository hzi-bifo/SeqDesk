# Pipeline E2E Coverage

What the **Pipeline SLURM E2E** (`.github/workflows/pipeline-slurm-e2e.yml`, self-hosted runner on the private `hzi-bifo/SeqDesk-ci` mirror) actually exercises. The workflow boots a real SeqDesk app against a local Postgres (an existing local cluster on the `db-local` runner if present, otherwise a throwaway user-space cluster), seeds dummy data, and drives pipelines through the app's HTTP API in **local** and **SLURM** execution modes, then asserts the database writeback.

> Keep this in sync when adding a pipeline or an assertion. It's the quick answer to "is X tested, and how?"

## Pipeline coverage


| Pipeline              | Local | SLURM | Target | DB writeback asserted                                                        | Failure path | External DB / dataset                        | Status                               |
| --------------------- | ----- | ----- | ------ | ---------------------------------------------------------------------------- | ------------ | -------------------------------------------- | ------------------------------------ |
| **fastq-checksum**    | ✅     | ✅     | order  | `Read.checksum1/2` (merge) **+ md5 round-trip on file1 _and_ file2**         | ✅            | —                                            | **covered**                          |
| **simulate-reads**    | ✅     | ✅     | order  | new active `Read` (replace) + checksum/readCount **+ config→output** (summary `read_count1` == configured `readCount`) | —            | —                                            | **covered** (runtime local+SLURM; also SLURM smoke) |
| **study-demo-report** | ✅     | ✅     | study  | `PipelineArtifact` rows (`html_report`, `markdown_report`, `sample_summary`) **+ config→output** (custom `report_title` in HTML/MD) | —            | —                                            | **covered**                          |
| fastqc                | ✅     | ✅    | order  | `PipelineArtifact` (`sample_qc_reports`, `sample_qc_data`) **+ read-field DB writeback** (`Read.readCount1/avgQuality1` plausibility, via the extended run-GET select) **+ summary-TSV metrics** (`r1_read_count`>0, avg quality in range) | —            | per-process `fastqc` conda — reused from shared cacheDir on SLURM | **covered** |
| reads-qc              | —     | —     | study  | `Read.readCount/avgQuality` + artifacts                                      | —            | per-process `seqkit`/`python` conda (use shared cacheDir like fastqc) | planned (unblocked) |
| read-cleaning         | —     | —     | order  | cleaned reads + artifacts                                                    | —            | **kraken2 DB** (staged)                      | planned — DB staged; needs a **raw/unknown**-reads order to exercise (Gemma reads are already cleaned) |
| mag                   | —     | —     | study  | assemblies/bins + artifacts                                                  | —            | **GTDB** (large)                             | planned (needs DB staged)            |
| submg                 | —     | —     | study  | ENA submission result                                                        | —            | ENA upload credentials                       | planned                              |
| metaxpath             | —     | —     | order  | taxonomy/path results                                                        | —            | **MetaXpath DB bundle** (private pkg; **no GTDB** — mag-only) | preflight wired (Alma install E2E); pkg **v0.1.6** now on the profile, install under diagnosis; run planned |


Legend: ✅ asserted · — not covered yet.

**How conda-tool pipelines run on SLURM (compute nodes have no network).** Per-process `conda create` for a `bioconda::` directive hangs on the compute node (no outbound network to conda-forge/bioconda). Solved by the **`conda.cacheDir` feature** (`SEQDESK_CONDA_CACHE_DIR` → `pipelines.execution.conda.cacheDir`, emitted into the generated `nextflow.config`): the pipeline's **local** run on the networked runner builds the per-process env into a shared cacheDir, and the **SLURM** run reuses it by hash — no fetch. fastqc proves this end to end; reads-qc will reuse the same mechanism. To get there, fastqc also runs **early** (before simulate-reads/the failure test churn the shared order), which surfaced + fixed app bug #5 (terminal-run resurrection) and the unconditional failure-test restore.

**Open follow-ups:**

- **reads-qc** — study target; per-process `seqkit`/`python` conda. Unblocked by the shared cacheDir; just needs wiring (a study-target `--pipeline-id reads-qc` step + a read-field/artifact spec). **Caveat:** the real-data Gemma run surfaced a local-run `completed`→`running` re-sync flip (distinct from the queue-side bug #5 guard) that must be fixed first, so "unblocked" isn't "free"; read-field writebacks (`readCount`/`avgQuality`) also need the run-GET select extended (step 3 in *Adding a pipeline*).
- **Known flake — run-scoped `summary` artifacts ingest inconsistently.** Observed for both fastqc (`summary/fastqc-summary.tsv`) and simulate-reads (`summary/simulation-summary.tsv`): the file is always produced on disk, but its `PipelineArtifact` row sometimes isn't created (one execution mode in a run can have it, the other not). So required-artifact assertions use the reliable per-sample artifacts, and the summary-TSV content checks **warn+skip** when the row is absent rather than red the suite. Likely a real intermittent output-resolution bug worth pinning.
- **High-value app-behaviour tests (added).** Implemented and green: no-data/empty-order validation, run visibility/permissions, notifications, and stuck-run reconciliation live in `scripts/run-pipeline-appcheck-e2e.mjs` (`--check nodata|access|stuck`, wired as separate SLURM-E2E steps after the proven pipeline steps). Output *correctness* (assert artifact content, not just presence) is folded into the runtime E2E's `assertArtifactContent` for the artifact pipelines. Note: the failure-path test asserts a pipeline-agnostic app behaviour (failed-run reconciliation), even though its deliberate-failure trigger is pinned to fastq-checksum (the only pipeline with a guaranteed missing-input non-zero exit), so it is NOT duplicated per pipeline — different failure *modes* (stuck vs failed) are higher value than the same mode on every pipeline.
- **Per-pipeline depth (added).** Each covered pipeline now asserts one thing beyond "it ran": **config→output** plumbing for simulate-reads (summary `read_count1` == the configured non-default `readCount`) and study-demo-report (a unique `report_title` we pass appears verbatim in the rendered HTML `<h1>` + Markdown — proves user config reaches the SLURM job, untested before); **paired-read correctness** for fastq-checksum (the on-disk md5 round-trip now covers `file2`/`checksum2`, not just `file1`); and **real QC metrics** for fastqc, now on two surfaces: the artifact-content check (`fastqc-summary.tsv` `r1_read_count`/`avg_quality` plausibility) **plus the DB read-field writeback** — the run-GET select (`pipeline-run-ops-service.ts`) was extended to expose `readCount1/2`/`avgQuality1/2`, so `assertFastqcReadFieldWriteback` proves fastqc's in-place `Read` merge actually ingested (not just the artifact rows), with plausibility bounds to catch garbage and single-end reads correctly skipping the `*2` fields — **exercised green on the self-hosted runner in both local and SLURM** (every active read carried a populated, plausible `readCount1`/`avgQuality1`). The two summary-TSV checks fetch via the file endpoint and **warn+skip** if the run-scoped summary file isn't servable (its `PipelineArtifact` row ingests flakily), hard-asserting only when present — coverage without flake. (The same select extension also activated simulate-reads' dormant `readCount1 > 0` check and is the prerequisite for a future reads-qc read-field spec.)
- **MetaxPath preflight + Gemma dataset (cross-workflow, now green).** MetaxPath is a *private* package (not in this repo's `pipelines/`), so it isn't part of the SLURM E2E. Its first checks live in the **Alma install E2E** (`install-profile-alma.yml` → `scripts/assert-install-profile-applied.mjs`), gated on the relevant option being enabled on the admin-configurable `ci-runner` profile: (1) **MetaxPath preflight** — the package is **installed** (`pipelines/metaxpath/manifest.json`) and its **DB params file exists on disk** (`paramsFile`); (2) **Gemma example dataset** — when the `gemma-nanopore-metaxpath-5sample` fixture is enabled, the seeded `DEV-GEMMA-ONT-001` order exists with its **5 ONT samples** and each sample's FASTQ is present on disk. **Staging that made this pass:** the kraken2 DB is staged on the shared FS with a real `path`; the Gemma bundle is staged locally and the profile points at it via a `file://` URL (the bundle host isn't resolvable from the runner — `curl 6`); and MetaxPath is treated as an **optional add-on** (`SEQDESK_METAXPATH_OPTIONAL`) so a package-install failure *warns* instead of aborting the whole install. **MetaxPath version (resolved):** the package is published up to **v0.1.6** and the `ci-runner` profile now points at that asset (the installer floor `≥0.1.1` is correct; the profile had been pinned to the stale `0.1.0` asset). The remaining metaxpath gates are: the package install actually **succeeding** (currently failing sub-second — under diagnosis via a newly **surfaced install-log tail** on failure in `install-dist.sh`), the DB **params file** present on disk, and a **pre-warmed conda cacheDir**. **GTDB is mag-only — not a metaxpath dependency.**

### Real-data pipeline runs on the Gemma study (Alma install E2E) — planned

The SLURM E2E uses synthetic/dummy data to prove the pipeline *mechanics*. The Alma install E2E now also seeds a **real 5-sample ONT MinION dataset** (the Gemma study `gemma-nanopore-metaxpath`, order `DEV-GEMMA-ONT-001`) with on-disk FASTQs — so it's the natural home to run the read-consuming pipelines on **real input** and assert their outputs (login → `POST /api/pipelines/runs` on the Gemma study/order → poll → assert), complementing (not duplicating) the SLURM E2E.

Wired as post-install steps inside the Alma E2E's app-startup verify step (the app is live there), driven by `run-pipeline-runtime-e2e.mjs --order-number DEV-GEMMA-ONT-001` / `--study-alias gemma-nanopore-metaxpath --skip-slurm --skip-if-disabled` (a pipeline not enabled on the profile is a clean skip, not a failure).

| Pipeline | Real Gemma input makes sense? | Status |
| ----------------- | ----------------------------- | ------------------------------------------------------------- |
| fastq-checksum    | ✅ checksums of the real reads | ✅ **green** — md5 round-trip verified against the real ONT read on disk |
| fastqc            | ✅ QC on real ONT reads        | ✅ **green** — runs through the installed app (per-process conda builds on the networked runner) |
| study-demo-report | ✅ study report on the study   | ⏭️ skips — covered in the SLURM E2E; just not yet enabled on the ci-runner profile (enable it to also cover on Gemma) |
| reads-qc          | ✅ read QC/metrics             | ⛔ deferred — the local study run reached `completed` then a re-sync flipped it back to `running` (a local-run completed→running flip; needs its own fix, distinct from the queue-side guard) |
| read-cleaning     | ❌ needs **raw/unknown** reads | n/a — the Gemma reads are already **cleaned** (`No active raw or unknown reads found`); the kraken2 DB is staged but read-cleaning only runs on raw/unknown input (`order-pipeline-readiness.ts` → `Needs raw or unknown reads`) |
| metaxpath         | ✅ taxonomy/path (the point)   | wiring ready (warn-only) — profile now points at pkg **v0.1.6**; install under diagnosis (surfaced log); needs DB params file on disk + pre-warmed conda cacheDir. **GTDB not needed** (mag-only) |
| mag               | ✅ assembly/binning            | blocked — **GTDB** staged |
| simulate-reads    | ❌ it *generates* reads        | n/a |
| submg             | ❌ ENA submission, not analysis| n/a |

Legend: ✅ green (runs + asserted) · ⏭️ clean skip (not enabled on the profile — a no-op, not a failure) · ⛔ deferred (known blocker, see cell) · ❌ n/a (real Gemma input doesn't apply).

Infra notes that got the install green: the kraken2 DB is staged with a real `path`; the Gemma bundle is staged locally and the profile points at it via a `file://` URL (the bundle host isn't resolvable from the runner); MetaxPath is optional (`SEQDESK_METAXPATH_OPTIONAL`) so a package-install failure warns instead of aborting. The profile now points at MetaxPath **v0.1.6** (the GitHub API asset URL `releases/assets/425394883`, not the browser `releases/download` URL — a private package needs the API endpoint + token); it had been pinned to the stale `0.1.0` asset, which the installer floor `≥0.1.1` correctly rejected.

Follow-ups: get the MetaxPath **v0.1.6** package install green (the current failure is sub-second — diagnosing via the install-log tail now surfaced on failure in `install-dist.sh`) and pre-warm its conda cacheDir, then land the metaxpath-on-Gemma run (add `metaxpath: { kind: "completes" }` to `WRITEBACK_SPEC` + an order-scoped `run_gemma metaxpath` line, **warn-only** until proven green); investigate the reads-qc local completed→running flip; enable study-demo-report on the profile to cover it; stage **GTDB for mag** (not metaxpath — metaxpath needs only its own DB bundle).

### What every covered run asserts

- The pipeline **runs to completion** on the compute node (SLURM) / runner (local) and produces its output files.
- DB run state: `status='completed'`, `completedAt` set, `progress=100` (re-fetched after a sync + settle to ride out the dual-writer race).
- DB **writeback** appropriate to the pipeline (see table) — i.e. results are *ingested into the database*, not just written to disk.
- SLURM runs additionally: `#SBATCH` directives present, a numeric `sacct` job id, and the node-local SLURM capture logs copied back (NFS-lag tolerant).

### Failure-path coverage

`run-slurm-failure-e2e.mjs` deliberately fails a **fastq-checksum** SLURM run (moves the sample FASTQ aside) and asserts the DB reconciles to `status='failed'` with `completedAt` + a `Failed` marker — the status-reconciliation path that previously got stuck at 99%.

## App-feature coverage (beyond "the pipeline ran")


| Feature                                      | What it proves                                                                                 | Status                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| Local **and** SLURM execution                | both execution modes through the app                                                           | ✅ covered                  |
| DB writeback (checksums / reads / artifacts) | results ingested, not just files written                                                       | ✅ covered                  |
| md5 round-trip correctness                   | stored checksum == real md5 of the input                                                       | ✅ covered (fastq-checksum) |
| Failure → DB `failed`                        | status reconciliation on a real process failure                                                | ✅ covered                  |
| **Stop / cancel**                            | `DELETE` → `scancel` → DB `cancelled` (hard); `sacct` CANCELLED confirmed best-effort (sacct lag tolerated) | ✅ covered                  |
| **Artifact + log retrieval**                 | produced files/logs downloadable via the app's `file`/`logs` endpoints (real bytes)            | ✅ covered                  |
| **statusSource**                             | which path finalized the run — logged (diagnostic); on this cluster it is `queue` (the `/sync` API), not weblog | ✅ logged (step terminality asserted) |
| **Step-level progress**                      | run exposes Nextflow trace steps; every step terminal once completed                            | ✅ covered                  |
| **No-data / empty-order validation**         | starting a run on a read-less order is rejected with a clean 400 validation error, never a 500/crash             | ✅ covered                  |
| **Run visibility / permissions**             | a non-admin researcher cannot read (403) or cancel (403) another's run; anonymous is 401        | ✅ covered                  |
| **Notifications**                            | a completed run fires a `pipeline.completed` in-app notification (recipient = owner + admins)   | ✅ covered                  |
| **Stuck-run reconciliation**                 | a SLURM job scancelled out-of-band is reconciled to terminal via `/sync`, not left wedged       | ✅ covered                  |
| **Output correctness**                       | downloaded artifacts contain real content markers (report `<h1>`, TSV headers), not just rows   | ✅ covered (study-demo, fastqc) |


## Execution / topology notes (CI-specific)

- The runner and SLURM compute nodes share **only a dedicated cluster filesystem**; `/home` is per-node. The run dir, input data, conda env, and pipeline packages all live on the shared filesystem (configured via the `SLURM_SHARED_*` Actions variables on the private mirror). The conda env is referenced by **full prefix path** (names don't resolve across nodes here).
- QOS caps the user to **1 submitted job**, so pipelines run as a **single SLURM job** with Nextflow's local executor inside (`SEQDESK_SLURM_INLINE_EXECUTOR=1`) rather than one job per process. Real multi-node parallelism (e.g. MAG at scale) needs the admin to raise the QOS limit.
- There is **no weblog block** in the generated `nextflow.config` (compute nodes can't reach the app's loopback), so output resolution runs via the **`/sync` API** and the **pipeline-monitor**, not weblog callbacks. (Confirmed at runtime: `statusSource=queue`.)

## Real bugs this E2E has caught

The suite exists to find app issues, not just to be green. So far it surfaced and fixed:

1. **Config loader dropped `SEQDESK_CONDA_ENV`** — a configured conda env name was silently ignored (default-config `trackSources` gap).
2. **Pipeline packages dir was not relocatable** — Nextflow ran against a path the compute node couldn't see.
3. **`simpleGlob` ignored literal (wildcard-free) discovery patterns** — script-less pipelines ingested **zero artifacts**.
4. **The pipeline-monitor never resolved outputs** — runs finalized by the safety-net daemon (vs the `/sync` API) were marked completed but had **no artifacts/writebacks** persisted.
5. **A terminal run could be resurrected on trace re-sync** — `syncPipelineRunForOperator`'s with-trace branch had no terminal guard, so a re-sync that saw a stale trace task still reading RUNNING (or a momentarily-active queue) flipped a `completed` run back to `running` and nulled its `completedAt`. Same class as the original stuck-at-99% bug.

## Adding a pipeline to the matrix

1. If study-scoped, add it to `STUDY_SCOPED_PIPELINES` in `scripts/run-pipeline-runtime-e2e.mjs`.
2. Add a `WRITEBACK_SPEC` entry: `checksum` (md5 merged onto reads), `replace` (new active read attributed to the run), `artifacts` (PipelineArtifact rows by outputId), or `completes` (run reached `completed`/`progress=100` with retrievable outputs/logs, for pipelines whose writeback isn't exposed by the run-GET select) — or extend for read-field writebacks.
3. If its read-field writebacks aren't exposed by the run-GET select (`pipeline-run-ops-service.ts`), extend that select.
4. Add a workflow step: `npm run pipeline:e2e:runtime -- --ensure-dummy-data --pipeline-id <id>` (runs local + SLURM).
5. If the pipeline needs an external DB, stage it on the shared cluster filesystem and point the install profile / env at it; only then flip its row to covered.

