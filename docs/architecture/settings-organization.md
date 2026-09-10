# Settings in the unified application

SeqDesk has one administration surface at `/admin/settings`. Installation presets
still supply account/ownership defaults; they do not select a separate settings UI.

## Where settings live

- Overview: searchable links, enabled-module count and the saved setup-check status.
- Modules: the existing feature registry, grouped into data sources, metadata/forms,
  validation, access, communication and analysis. `?category=data-sources` and the
  other existing category IDs support direct links.
- Metadata & forms: shared sample/sequencing fields, study definitions and MIxS.
- Pipelines & analysis: the pipeline catalog/database setup, execution settings and
  report-analysis environments/isolation. Nextflow pipelines and report analyses
  have separate requirements; neither is configured specially for FastQC or CAMI.
- Storage: shared data paths, facility discovery when enabled, infrastructure checks.
- Users & access: members, invitations, administrators and sharing. Department and
  support access retain the existing account-policy restrictions.
- Facility sequencing: instruments, run-assignment fields and MinKNOW; shown when
  sequencing management is enabled. Shared metadata remains accessible without it.
- System & services: installation details, notifications, ENA publishing, workers,
  updates and diagnostics. Archive publishing is distinct from importing ENA reads.

`src/lib/settings/catalog.ts` supplies navigation and search descriptions to the
overview and sidebar. It is not a new module registry or a configuration store.
Import identities come from the import catalog; workflow configuration remains in
pipeline manifests and existing settings services.

## Compatibility and safety

- Existing configuration pages/APIs retain their routes and authorization checks.
  The former diagnostics-heavy `/admin/settings` page is now at
  `/admin/settings/system`; update notifications and banners link there.
- `/admin/settings/analysis` and `/explore/environments` share one component. With
  Reports disabled, explain how to enable it instead of querying disabled APIs.
- Module changes retain individual choices. Resuming globally paused modules is an
  explicit confirmed action; it does not enable every module.
- Loading/errors are separate from disabled/unconfigured states. Failed settings
  reads must not expose editable default forms that can overwrite real values.
- Operator-controlled paths/identity remain locked and explain their source.
  Changing a data path does not move files. Database downloads and environment
  builds remain explicit actions; opening settings must not start them.
- The checklist uses effective enabled modules and workflow settings. It preserves
  applicable saved confirmations and automatic-check fingerprints. Checks are
  explicit; reading the overview/checklist does not write probe files or mark items
  complete. Unverified means “not checked yet”, not “broken”.

## Verification

Unit tests cover the catalog/navigation, loading and retry, source precedence,
module save rollback, profile/module combinations and checklist evidence.
`playwright/tests/settings-navigation.admin.spec.ts` is opt-in with
`SETTINGS_UI_READ_ONLY=1`. Use an isolated browser configuration with an existing
administrator session; the test blocks non-read API requests and never seeds data,
toggles modules, runs checks or starts downloads. It is not a replacement for a
separate disposable-database save/integration test.
