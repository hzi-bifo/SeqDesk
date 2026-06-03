# Browser (UI) end-to-end test coverage

SeqDesk's UI is exercised by [Playwright](https://playwright.dev/) tests that drive a real browser
against a running instance backed by PostgreSQL (the **Playwright E2E** check in the README). This
page maps what those tests cover today — and, just as importantly, what they do **not** yet cover —
so it's clear which user-facing flows are verified end to end.

Run them locally with:

```bash
npm run test:e2e
```

## Covered

| Area | What the tests verify | Spec file |
| --- | --- | --- |
| Auth & roles | A researcher is redirected away from admin-only pages, **and denied admin-only API routes** (401/403 on `/api/admin/users`, `/api/admin/departments`, `/api/admin/activity`) | `admin-access.spec.ts`, `admin-access-rbac.spec.ts` |
| Orders — researcher | Wizard validation (order name required), create & submit, multiple samples, delete a draft, edit a submitted order, orders list shows sample count, mark as sent, create a study from order samples | `order-create.spec.ts` |
| Orders — admin | Create & submit, create a study from own order samples, see other researchers' orders, submitted-order deletion gated by the Data-Handling policy (both on and off) | `order-admin.spec.ts` |
| Sample table | Copy organism, add/remove rows, **duplicate sample-alias rejection**, **Excel import** populates rows and allows continuing | `order-wizard.spec.ts` |
| Order notes | Autosave from the sidebar, collapse/reopen the sidebar, @-mention a sample and keep it after reload | `order-notes.spec.ts` |
| Studies | Mark a study ready → return it to draft → delete it | `study-lifecycle.spec.ts` |
| Study notes | Autosave, sidebar shown across study sub-pages, @-mention related order and sample | `study-notes.spec.ts` |
| Form builder | Admin field changes propagate to the researcher form **and required fields are enforced** (including per-sample fields that block progress); facility-only fields stay hidden from researchers; facility fields appear on the existing-order edit page | `form-config-roundtrip.spec.ts` |
| Pipelines — admin | Run a simulate-reads order pipeline with default settings; settings (mode, read count, read length) persist; template mode replays facility templates and writes reads back; clear error when template mode has no usable templates; `replaceExisting=false` preserves the original reads and source run | `order-sequencing-pipelines.admin.spec.ts` |
| Sequencing files | Admin uploads a read file to a submitted order and it is assigned to a sample (linked as `file1`, single-end) — verified both in the UI ("Single read linked") and via the sequencing API | `sequencing-file-assignment.spec.ts` |
| Demo mode | Public demo boots with seeded data and hides infrastructure-backed tabs; changes persist within a session and disappear after reset; separate browser contexts stay isolated; researcher and facility demos share one seeded workspace; facility demo shows seeded analysis data but **rejects pipeline execution** | `demo-flow.spec.ts` |
| ENA submission (UI) | The "Register at ENA" view surfaces a Submission Requirements checklist derived from the study (title, description, samples, taxonomy ID); a sample missing its taxId renders the Taxonomy ID check as **"Missing"**; submitting an incomplete study is rejected server-side (HTTP 400) with **no real ENA submission** and no accession side effects | `ena-submission-ui.spec.ts` |
| Notifications | A created in-app notification is returned by the notifications API and surfaces in the dashboard footer bell — unread badge count and the notification in the opened panel (self-skips where in-app notifications are disabled) | `notifications.spec.ts` |
| Studies — multi-order | A study built from samples drawn from **two different orders** shows both samples and both source orders on its Samples tab, then transitions Mark as Ready → Back to Draft | `multi-order-study.spec.ts` |
| MIxS checklist picker | The new-study checklist picker is **populated from the registry** (not a hardcoded list): it offers checklists that were never hardcoded (a GSC environment package and a non-environmental genome checklist); creating a study with one persists its **ENA accession**; the metadata page then resolves that accession to the checklist name (the previously broken fetch is fixed) | `study-checklist-picker.spec.ts` |
| MIxS checklist availability | An admin toggling a checklist's **availability off** (admin → MIxS Checklists → Save) removes it from the new-study picker — verified both via the picker's data source and in the wizard UI (the disabled checklist is gone, an available one remains); the config is restored afterward | `mixs-checklist-availability.spec.ts` |

## Not yet covered end to end (in the UI tests)

These flows are either unit/integration-tested elsewhere, covered by a different CI job, or are
genuine gaps we intend to close:

- **File discovery / link-existing + paired (R2) assignment** — the upload → assign (R1) flow is now
  covered (`sequencing-file-assignment.spec.ts`); the disk-scan *discover/auto-assign* path, the
  *link-existing* picker, and paired-end (R2) assignment are not yet covered.
- **ENA real submission / success path** — the in-app required-data checklist and the server-side
  submit gate are now covered (`ena-submission-ui.spec.ts`), but a *successful* registration (which
  needs Webin credentials) is verified separately by a CI job that registers a study and sample
  against the ENA **test server** (`wwwdev.ebi.ac.uk`), not in the Playwright UI tests.
- **Notification preferences & delivery channels** — in-app display is now covered
  (`notifications.spec.ts`); the per-channel preference toggles and email/relay delivery are not.
- **Software updates / rollback** — the staged-release and one-click rollback admin flow.
- **Pipeline failure & retry** path (the happy path is covered above).
- **Standalone MIxS metadata validation** as a dedicated UI test (currently exercised indirectly via
  the form-builder required-field tests).

Pipeline *execution* on real infrastructure (a SLURM cluster, AlmaLinux) is covered by separate
self-hosted CI, described in the README.
