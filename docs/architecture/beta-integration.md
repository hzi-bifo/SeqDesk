# Local beta integration

This is one SeqDesk application, not a fourth deployment mode. `main` remains
the stable branch. No beta release, tag, updater-channel change or remote push
is part of this integration.

## Preserved source work

The local `beta` worktree is at `/private/tmp/seqdesk-beta`.

| Source branch | Source commit | Working-copy checkpoint |
| --- | --- | --- |
| `codex/modular-deployment-modes` | `57854cfa` | `c5d8b3ce` |
| `explore-analysis-layer` | `53abde47` | `df0cff3d` |

The checkpoints include all 25 module/cohort and 22 report/layout working-copy
changes present at snapshot time. They use separate Git indexes, so the source
branches, source indexes and source working files were not changed. Local
backup refs are `refs/seqdesk/beta-snapshots/20260908-modules` and
`refs/seqdesk/beta-snapshots/20260908-reports`. The merge retains both histories.
Later edits on either source branch are not automatically copied into beta.

## Integrated surfaces

- One sequencing data/studies sidebar, with the existing Files and Pipelines
  pages plus Reports. Imported entries retain shortened display identifiers.
- Both sources' layout work, the profile provider and report footer provider.
- The import worker starts once; pipeline and Explore monitors both start.
- Reports is registered in the profile-aware module catalog, respects module
  disablement, and requires the analysis domain.
- MetaPhlAn's `cami_profile` output declares its tabular format, marked header
  and taxon/rank/percentage roles in its pipeline manifest.
- The new `abundance-composition` Explore kit plots these percentage profiles.
  It does not mislabel percentages as read counts or make count-based kits
  accept them. It rejects mixed/duplicate profiling results and invalid
  percentages, requires the requested rank, and preserves unreported abundance.

## Intended workflow

1. Create a sequencing data entry and import CAMI **short reads** with metadata.
2. Configure/enable MetaPhlAn in the pipeline store, including its verified
   marker database, and run the sequencing-data-level pipeline.
3. Open **Reports** in the same entry. Add the pipeline table **MetaPhlAn
   relative abundance (CAMI profile)** and select **Relative abundance
   composition**. Its figure and table can be included in the report.
4. For cross-source comparisons, link facility/imported samples to a study
   with study-specific cohort groups. Study pipelines and Report datasets both
   include the accessible primary-plus-linked sample union. Reports can reuse
   per-sample profiles from earlier source runs without copying unrelated
   samples from those runs.

The optional CAMI/OPAL ground-truth comparison remains a separate study-level
pipeline with explicit reference/taxonomy configuration. It is not silently
run by the importer or the report kit.

## CAMI import storage

The global 100 GiB archive/expanded-read safety limits are not free-space
reservations. Queue admission uses three times the selected download size
(capped at the overall preparation limit), plus a 1 GiB safety reserve. For the
5,550,020,311-byte CAMI II Marine sample archive, this is about 16.51 GiB rather
than a fixed 201 GiB. It is an initial estimate, not a promise about final size.

Extraction checks the actual read entry size from the tar header; benchmark
truth files are drained without being written. The outer archive is removed
before pairing. Pair preparation checks the measured, validated FASTQ byte
count plus gzip overhead, and long reads reuse the extracted file. Periodic
free-space checks, cancellation, checksums and archive safety limits remain.

If space runs out later, the worker cleans only that attempt's partial cache
and retains its learned peak requirement in the job directory. It will not
re-download the same archive until that requirement fits. Signed previews and
idempotency keys are unchanged; waiting messages expose only the import's
requirement, not installation-wide free-space figures.

## Authorization and cohort integration

Implemented on `beta` after explicit user approval:

- Reports use the shared capability model. Shared-lab members and center
  operators retain installation-scoped scientific access; a system admin who
  is a center requester or research-preset user does **not** get global data
  access merely from configuration rights.
- Private Explore projects and workbench workspaces remain owner-only in every
  preset, including for system admins and operators.
- Every authenticated Explore API rejects invalidated identities. Environment
  installation and sandbox configuration require `system.pipelines.manage`;
  operational form-field visibility uses `orders.process` independently.
- Report sample, sequencing and pipeline-table builders intersect direct-plus-
  cohort membership with source-entry access. They carry `source_study_id`,
  `cohort_group` and `cohort_role`; groups are specific to the comparison study.
  Linking a control does not transfer ownership or change its source study.
- The ordinary editable/submission Study table remains primary-only; the
  read-only Report builder explicitly opts into the authorized analysis union.
- Earlier per-sample outputs are reusable even from another sequencing entry
  or study. Other artifacts from the source run are excluded. The selected
  final run of the Report scope takes precedence; remaining samples use their
  latest eligible completed run. Older overlapping results are not counted a
  second time. An explicitly empty run selection stays empty.
- Whole-scope tables are eligible only for the same target with known, nonempty
  frozen input IDs wholly contained in the current authorized sample union.
  Legacy aggregates without that provenance must be regenerated or replaced
  with per-sample outputs; membership is not guessed.
- Combined-table rows must match an unambiguous accessible sample that was a
  frozen input of that run. Duplicate labels/aliases (including collisions with
  database IDs) are not guessed. Per-sample artifacts retain stable IDs even
  when samples from different sources have identical display names.
- Pipeline manifests determine declared table parsing. File columns cannot
  replace server-resolved identity/group columns. Reads stay inside the real
  run directory, including symlink checks, and skipped files are not recorded
  as successful provenance. Unusable formats/labels return actionable errors.

Removing a cohort link changes subsequent builds and source selection. Existing
dataset versions and report snapshots remain historical copies for
reproducibility; unlinking is **not** retrospective erasure or withdrawal of a
previously created/shared report. Scope access still applies to those copies.
Use a rebuild to refresh a Report dataset after changing the cohort.

## Verification and boundaries

- Clean offline dependency installation succeeds; the production webpack build
  and production TypeScript check pass.
- All twelve Explore kit manifests validate. The new kit's seven Python tests
  execute the real analysis code on explicitly internal fixtures.
- The full Python Explore helper/kit suite passes: **51 tests**.
- The expanded targeted Vitest suite passes **2,614 tests across 197 files**,
  including Report/pipeline/Study authorization, source filtering and the
  unchanged no-direct-role-checks architecture guard. The separate launcher
  suite passes **52 tests** with local-loopback permission: **2,666 total**.
  An old Study authorization fixture was corrected to remove the study domain
  explicitly; the research preset now correctly has the same Study UI.
- The importer/workbench suite passes **237 tests across 40 files**. Both live
  PostgreSQL tests (cohort pipelines and the expanded pipeline-to-Report link)
  pass together. Production webpack and targeted ESLint checks pass.
- The live PostgreSQL integration test exercises a stored imported-data entry,
  real pipeline artifact queries, the manifest parser, persisted dataset
  versions, an analysis bound to the kit, and a saved Report table. It also
  tests linked-control metadata/groups, inaccessible links, unrelated source
  artifacts, shared access, removed membership, primary-only editing and
  preserved source-study ownership. It always rolls back its database records
  and removes its own temporary files.
- Fresh installation: `seqdesk_beta_validation_20260908`.
- Upgrade from modules: `seqdesk_beta_modules_test_20260908`.
- Upgrade from reports: `seqdesk_beta_reports_test_20260908`.
  Both upgrade tests retain their original internal user/order/study/sample
  records and expose both the cohort and Report models afterward. These are
  isolated databases; existing development data was not reset, migrated or
  seeded.
- A migration/schema comparison also reports historical differences in two
  Order indexes and five timestamp defaults. No migration drops those indexes
  or rewrites defaults as part of this merge.
- The running MetaPhlAn reference download belongs to the original module
  worktree and development database. This merge does not cancel it, copy its
  staging files or imply it is installed in the isolated beta test databases.
- No full public CAMI download → MetaPhlAn scientific run → ground-truth
  benchmark has been performed in this beta integration.

Re-run the explicit live test with a local beta test database:

```sh
SEQDESK_TEST_TIER=live \
SEQDESK_BETA_DATABASE_URL=postgresql://pmu15@127.0.0.1:5432/seqdesk_beta_reports_test_20260908 \
node node_modules/vitest/vitest.mjs run src/lib/explore/beta-pipeline.database.live.test.ts
```
