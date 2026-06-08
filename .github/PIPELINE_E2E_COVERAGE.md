# Pipeline E2E Coverage

What the **Pipeline SLURM E2E** (`.github/workflows/pipeline-slurm-e2e.yml`, self-hosted runner on the private `hzi-bifo/SeqDesk-ci` mirror) actually exercises. The workflow boots a real SeqDesk app against an ephemeral Postgres, seeds dummy data, and drives pipelines through the app's HTTP API in **local** and **SLURM** execution modes, then asserts the database writeback.

> Keep this in sync when adding a pipeline or an assertion. It's the quick answer to "is X tested, and how?"

## Pipeline coverage


| Pipeline              | Local | SLURM | Target | DB writeback asserted                                                        | Failure path | External DB / dataset                        | Status                               |
| --------------------- | ----- | ----- | ------ | ---------------------------------------------------------------------------- | ------------ | -------------------------------------------- | ------------------------------------ |
| **fastq-checksum**    | ✅     | ✅     | order  | `Read.checksum1/2` (merge) **+ md5 round-trip**                              | ✅            | —                                            | **covered**                          |
| **simulate-reads**    | ✅     | ✅     | order  | new active `Read` (replace) + checksum/readCount                             | —            | —                                            | **covered** (runtime local+SLURM; also SLURM smoke) |
| **study-demo-report** | ✅     | ✅     | study  | `PipelineArtifact` rows (`html_report`, `markdown_report`, `sample_summary`) | —            | —                                            | **covered**                          |
| fastqc                | ✅     | ✅    | order  | `PipelineArtifact` (`sample_qc_reports`, `sample_qc_data`)                   | —            | per-process `fastqc` conda — reused from shared cacheDir on SLURM | **covered** |
| reads-qc              | —     | —     | study  | `Read.readCount/avgQuality` + artifacts                                      | —            | per-process `seqkit`/`python` conda (use shared cacheDir like fastqc) | planned (unblocked) |
| read-cleaning         | —     | —     | order  | cleaned reads + artifacts                                                    | —            | **kraken2 DB**                               | planned (needs DB staged)            |
| mag                   | —     | —     | study  | assemblies/bins + artifacts                                                  | —            | **GTDB** (large)                             | planned (needs DB staged)            |
| submg                 | —     | —     | study  | ENA submission result                                                        | —            | ENA upload credentials                       | planned                              |
| metaxpath             | —     | —     | study  | taxonomy/path results                                                        | —            | **MetaXpath DB** (private pipeline)          | planned (needs DB staged)            |


Legend: ✅ asserted · — not covered yet.

**How conda-tool pipelines run on SLURM (compute nodes have no network).** Per-process `conda create` for a `bioconda::` directive hangs on the compute node (no outbound network to conda-forge/bioconda). Solved by the **`conda.cacheDir` feature** (`SEQDESK_CONDA_CACHE_DIR` → `pipelines.execution.conda.cacheDir`, emitted into the generated `nextflow.config`): the pipeline's **local** run on the networked runner builds the per-process env into a shared cacheDir, and the **SLURM** run reuses it by hash — no fetch. fastqc proves this end to end; reads-qc will reuse the same mechanism. To get there, fastqc also runs **early** (before simulate-reads/the failure test churn the shared order), which surfaced + fixed app bug #5 (terminal-run resurrection) and the unconditional failure-test restore.

**Open follow-ups:**

- **reads-qc** — study target; per-process `seqkit`/`python` conda. Unblocked by the shared cacheDir; just needs wiring (a study-target `--pipeline-id reads-qc` step + a read-field/artifact spec).
- **Known flake — fastqc run-scoped `summary` artifact.** The `summary/fastqc-summary.tsv` file is always produced, but its `PipelineArtifact` row ingests inconsistently, so the assertion requires the reliable per-sample artifacts instead. Likely a real intermittent output-resolution bug worth pinning.
- **High-value app-behaviour tests (added).** Implemented and green: no-data/empty-order validation, run visibility/permissions, notifications, and stuck-run reconciliation live in `scripts/run-pipeline-appcheck-e2e.mjs` (`--check nodata|access|stuck`, wired as separate SLURM-E2E steps after the proven pipeline steps). Output *correctness* (assert artifact content, not just presence) is folded into the runtime E2E's `assertArtifactContent` for the artifact pipelines. Note: the failure-path test is pipeline-agnostic (it tests the app's failed-run reconciliation), so it is NOT duplicated per pipeline — different failure *modes* (stuck vs failed) are higher value than the same mode on every pipeline.

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
| **Stop / cancel**                            | `DELETE` → `scancel` → DB `cancelled`; `sacct` shows the job CANCELLED                          | ✅ covered                  |
| **Artifact + log retrieval**                 | produced files/logs downloadable via the app's `file`/`logs` endpoints (real bytes)            | ✅ covered                  |
| **statusSource**                             | which path finalized the run — on this cluster it is `queue` (the `/sync` API), not weblog      | ✅ covered                  |
| **Step-level progress**                      | run exposes Nextflow trace steps; every step terminal once completed                            | ✅ covered                  |
| **No-data / empty-order validation**         | starting a run on a read-less order is rejected with a clean 4xx, never a 500/crash             | ✅ covered                  |
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
2. Add a `WRITEBACK_SPEC` entry: `checksum` (md5 merged onto reads), `replace` (new active read attributed to the run), or `artifacts` (PipelineArtifact rows by outputId) — or extend for read-field writebacks.
3. If its read-field writebacks aren't exposed by the run-GET select (`pipeline-run-ops-service.ts`), extend that select.
4. Add a workflow step: `npm run pipeline:e2e:runtime -- --ensure-dummy-data --pipeline-id <id>` (runs local + SLURM).
5. If the pipeline needs an external DB, stage it on the shared cluster filesystem and point the install profile / env at it; only then flip its row to covered.

