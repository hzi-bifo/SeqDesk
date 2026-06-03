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
| Auth & roles | A researcher is redirected away from admin-only pages (form builder) | `admin-access.spec.ts` |
| Orders — researcher | Wizard validation (order name required), create & submit, multiple samples, delete a draft, edit a submitted order, orders list shows sample count, mark as sent, create a study from order samples | `order-create.spec.ts` |
| Orders — admin | Create & submit, create a study from own order samples, see other researchers' orders, submitted-order deletion gated by the Data-Handling policy (both on and off) | `order-admin.spec.ts` |
| Sample table | Copy organism, add/remove rows, **duplicate sample-alias rejection**, **Excel import** populates rows and allows continuing | `order-wizard.spec.ts` |
| Order notes | Autosave from the sidebar, collapse/reopen the sidebar, @-mention a sample and keep it after reload | `order-notes.spec.ts` |
| Studies | Mark a study ready → return it to draft → delete it | `study-lifecycle.spec.ts` |
| Study notes | Autosave, sidebar shown across study sub-pages, @-mention related order and sample | `study-notes.spec.ts` |
| Form builder | Admin field changes propagate to the researcher form **and required fields are enforced** (including per-sample fields that block progress); facility-only fields stay hidden from researchers; facility fields appear on the existing-order edit page | `form-config-roundtrip.spec.ts` |
| Pipelines — admin | Run a simulate-reads order pipeline with default settings; settings (mode, read count, read length) persist; template mode replays facility templates and writes reads back; clear error when template mode has no usable templates; `replaceExisting=false` preserves the original reads and source run | `order-sequencing-pipelines.admin.spec.ts` |
| Demo mode | Public demo boots with seeded data and hides infrastructure-backed tabs; changes persist within a session and disappear after reset; separate browser contexts stay isolated; researcher and facility demos share one seeded workspace; facility demo shows seeded analysis data but **rejects pipeline execution** | `demo-flow.spec.ts` |

## Not yet covered end to end (in the UI tests)

These flows are either unit/integration-tested elsewhere, covered by a different CI job, or are
genuine gaps we intend to close:

- **Sequencing file upload → assignment to samples** through the UI (file discovery/assignment is
  unit-tested; an end-to-end UI test is a gap).
- **ENA submission UI flow** (the in-app submit wizard). The submission *engine* is verified
  separately by a CI job that registers a study and sample against the ENA **test server**
  (`wwwdev.ebi.ac.uk`); the UI walkthrough is not yet a Playwright test.
- **Notifications** — display and per-channel preferences.
- **Software updates / rollback** — the staged-release and one-click rollback admin flow.
- **Pipeline failure & retry** path (the happy path is covered above).
- **Standalone MIxS metadata validation** as a dedicated UI test (currently exercised indirectly via
  the form-builder required-field tests).

Pipeline *execution* on real infrastructure (a SLURM cluster, AlmaLinux) is covered by separate
self-hosted CI, described in the README.
