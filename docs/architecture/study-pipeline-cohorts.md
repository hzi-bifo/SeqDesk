# Study pipeline cohort inputs — September 8, 2026

Local branch: `codex/modular-deployment-modes`. No push, migration or data reset.

## Behavior

- Analysis inputs are the union of directly assigned samples and `StudySample`
  links. The source owner's permissions still apply; a link does not grant access.
  SQL selection deduplicates by database ID. Equal sample codes on different
  selected records are rejected before generating ambiguous file names.
- The study response exposes `analysisSamples` separately from `samples`, so
  pipeline selection includes controls without changing metadata/submission
  ownership or moving records. Changing study groups refreshes that selection.
- New study runs freeze the chosen IDs, including an implicit "all" selection.
  Starting rechecks access and membership. Older pending runs without a snapshot
  retain their primary-only default unless the operator explicitly selects inputs.
  Preparation rejects a selection that shrank concurrently instead of silently
  executing only the remaining samples.
- Metadata checks, derived settings, generic/custom samplesheets and the legacy
  MAG adapter use the same membership rule. Samplesheet study fields describe the
  analysis study, not a control's original repository project.
- Earlier sample artifacts can come from an order run or another study. Only the
  selected samples are staged. A combined report is usable only from the same
  study with a known, fully contained source selection. Unknown legacy aggregate
  selections require rerunning that source pipeline.
- Completion, manual output resolution, debugging and run cleanup use saved input
  IDs. Unlinking a sample after launch does not lose its output mapping. Older
  completed runs without saved IDs keep their legacy primary-study behavior.
- Publication pipelines, including SubMG, remain primary-only. Linking a public
  control to an analysis never automatically includes it in an ENA submission.

## Verification

- **2,170 automated tests across 133 files passed**, including new regression
  cases for cohort-only studies, access filters, duplicate links/codes, frozen
  selection, legacy pending runs, unlinks, metadata/read compatibility, study
  samplesheet context, scoped artifact reuse and parent UI refresh.
- A real local PostgreSQL integration test passed. It combined a direct case
  with a linked control, excluded another owner's linked sample, checked admin
  scope and deduplication, staged the selected control's file from another study,
  and verified historical ID resolution after unlinking. All inserted test
  records were rolled back; their absence was checked after rollback. Files were
  internal file-copy fixtures, not fabricated scientific benchmark outputs.
- Production TypeScript checking and a webpack app build passed. These checks
  do not constitute the release installation/update/rollback gates.

The full scientific MetaPhlAn → OPAL acceptance run remains separate and requires
the installed marker database plus matching CAMI taxonomic Ground Truth. This
change does not implement automatic merging of partial prediction runs or new
group-aware statistical algorithms.
