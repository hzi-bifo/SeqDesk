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
   with study-specific cohort groups. Study pipelines already support these
   links; the remaining Report integration is listed below.

The optional CAMI/OPAL ground-truth comparison remains a separate study-level
pipeline with explicit reference/taxonomy configuration. It is not silently
run by the importer or the report kit.

## Pending authorization-sensitive integration

The automated safety review paused the proposed changes below pending explicit
user approval; they have **not** been applied:

- Replace legacy Report role comparisons with the shared capability model.
  Shared-lab scientific-data permissions must be consistent with pipelines;
  system configuration rights must not become blanket access to private data.
- Honor invalidated sessions and separate environment-management permission
  from scientific-data permission.
- Use the authorized direct-plus-cohort sample union in Report sample,
  sequencing and pipeline-table builders; carry group labels/source-study IDs.
- Reuse earlier per-sample outputs from linked controls while excluding other
  samples in the same source run; handle ambiguous sample labels and aggregate
  tables conservatively.
- Test operator/requester/system-admin/shared-lab combinations, inaccessible
  links, removed memberships and cross-scope artifact filtering.

Until these items are completed, do not treat beta as ready for multi-user
deployment or claim the full linked-control Report workflow is finished. The
authorization architecture test correctly reports the two remaining legacy
role comparisons in Explore.

## Verification and boundaries

- Clean offline dependency installation succeeds; the production webpack build
  and production TypeScript check pass.
- All twelve Explore kit manifests validate. The new kit's seven Python tests
  execute the real analysis code on explicitly internal fixtures.
- The full Python Explore helper/kit suite passes: **51 tests**.
- The combined targeted Vitest suite contains **2,520 tests across 188 files**:
  **2,519 pass after the local-socket rerun**. The remaining failure is the
  authorization architecture check described above. The separately rerun
  launcher suite passes all 52 tests with loopback permission.
- The importer/workbench suite passes **237 tests across 40 files**. Both live
  PostgreSQL tests (cohort pipelines and the new pipeline-to-Report link) pass
  together. The final webpack build passes after the module integration.
- The live PostgreSQL integration test exercises a stored imported-data entry,
  real pipeline artifact queries, the manifest parser, persisted dataset
  versions, an analysis bound to the kit, and a saved Report table. It always
  rolls back its database records and removes its own temporary files.
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
