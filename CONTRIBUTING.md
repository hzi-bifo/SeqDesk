# Contributing to SeqDesk

This guide covers developing and testing the SeqDesk repository. End-user and operator
documentation lives at [seqdesk.org/docs](https://seqdesk.org/docs).

## Prerequisites

- Node.js 18+ and a local PostgreSQL (SeqDesk is PostgreSQL-only).
- For pipeline work: Conda and/or Nextflow; SLURM for cluster-mode tests.

## Local setup

```bash
git clone https://github.com/hzi-bifo/SeqDesk.git
cd SeqDesk
npm ci
cp seqdesk.config.example.json seqdesk.config.json
```

Set at least the `runtime` block:

```json
{
  "runtime": {
    "databaseUrl": "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public",
    "directUrl": "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public",
    "nextAuthUrl": "http://localhost:3000",
    "nextAuthSecret": "replace-with-a-random-secret"
  }
}
```

On a pooled provider (e.g. Neon), point `databaseUrl` at the pooled endpoint and `directUrl` at the
**direct, unpooled** endpoint. `migrate deploy` acquires a session-level advisory lock that a
transaction-mode pooler can't hold (it fails with `P1002`), so migrations always run through
`directUrl`. As a safety net, `scripts/run-prisma.mjs` strips Neon's `-pooler` host label from the
resolved `DIRECT_URL` automatically, so a deploy still works if only the pooled URL is configured.

For `npm run dev`, keep `runtime.nextAuthUrl` aligned with the URL you open in the browser
(typically `http://localhost:3000`). The installer-oriented config example uses port `8000`, which
is for installed service mode rather than local Next.js development.

Then initialize the database and start the dev server:

```bash
npm run db:migrate:deploy
npm run db:seed
npm run dev          # http://localhost:3000
```

macOS shortcut (Homebrew PostgreSQL): `npm run dev:mac` starts local PostgreSQL if needed, creates
the local `seqdesk` database and role, runs migrations and seed data, then starts Next.js with local
runtime overrides.

> SeqDesk is PostgreSQL-only and uses Prisma migrations (`npm run db:migrate:dev`). Avoid
> `prisma db push` — it causes schema/migration drift.

### Source installer

For advanced/dev checkouts rather than the recommended production npm path:

```bash
bash scripts/install.sh -y --dir ./seqdesk-source
```

## Common commands

```bash
npm run dev
npm run build
npm run start
npm test
```

Vitest assumes a local PostgreSQL test database at
`postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_test?schema=public` unless you override
`DATABASE_URL` and `DIRECT_URL`.

### Test tiers

- `npm test` / `npm run test:fast` — fast tier (mocked DB); the default.
- `npm run test:live` — real-DB integration tests (`*.live.test.ts`).
- `npm run test:all` — the full suite, including the live tests.
- `npm run test:coverage` — fast tier with coverage (thresholds enforced in `vitest.config.ts`).

## Live test dashboard

A local dashboard groups tests by section and shows live pass/fail/running state while the suite runs:

```bash
npm run test:dashboard          # fast Vitest, one-shot
npm run test:dashboard:watch    # fast Vitest, persistent dashboard
npm run test:dashboard:live     # live-tier Vitest files
npm run test:dashboard:ui       # Playwright UI/E2E tests in the dashboard shell
npm run test:dashboard:all      # all Vitest tiers (Vitest-only, not Playwright)
```

The dashboard prints a local URL on start (and can open the browser), has a tier selector and a
`Run Tests` button, and accepts file filters:

```bash
npm run test:dashboard -- --no-open src/lib/testing/dashboard.test.ts
npm run test:dashboard:ui -- --no-open playwright/tests/auth.setup.ts
```

## UI E2E (Playwright)

```bash
npm run test:e2e
```

Uses the repo Playwright config, starts `npm run dev` at `http://127.0.0.1:3000`, and expects
PostgreSQL. Covered flows include:

| Area | Covered flows |
| --- | --- |
| Orders | wizard validation, multi-sample orders, sample-table copy/import, draft delete, submitted-order edit, mark sent, order notes |
| Studies | creation from order samples, ready/draft transitions, delete, notes sidebar |
| Admin | order creation, cross-user visibility, access guard, form-builder roundtrip, facility-only/required field enforcement, submitted-order deletion policy |
| Pipelines | admin simulate-reads run, settings persistence, replace-existing behavior |
| Demo | seeded workspace, session isolation/reset, shared-workspace behavior, pipeline execution blocked in demo |

Codecov tracks `src/**` source coverage; Playwright browser coverage is tracked separately from the
Codecov percentage in the README.

## Update + rollback E2E (release gate)

`update-rollback-e2e-ubuntu.yml` is a pre-release gate (run via **workflow_dispatch**, or chained
before a release with **workflow_call**) that proves the in-app updater works end to end. It builds
the current release, derives a distinct "to" release from that same tarball with no second build
(re-stamped `package.json` version + one additive `CREATE TABLE IF NOT EXISTS` migration), installs
the "from" release under PM2, then drives the real `POST /api/admin/updates/install` and
`POST /api/admin/updates/rollback` routes against the running app. It asserts the running version
flips, the new migration applies (`migrate deploy` ran), the `current/` symlink moves between
`releases/<version>` directories, data is preserved (orders/samples/studies/users counts stay at or
above the pre-update baseline and a sentinel order survives both transitions), and admin/researcher
login still work on each release. Completion is judged on the disk-persisted update state, so it
tolerates the PM2 restart window.

```bash
gh workflow run update-rollback-e2e-ubuntu.yml --ref main
```

## Background workers

Two long-lived helper processes run alongside the Next.js server:

```bash
npm run pipeline:monitor          # poll SLURM/local pipeline runs, update PipelineRun rows
npm run stream:monitor            # watch MinKNOW output dirs, ingest reads into active StreamRuns
npm run stream:monitor:simulate   # drop MinKNOW-shaped FASTQs for end-to-end testing without hardware
```

`stream:monitor` reads its configuration (output root, gRPC host/port, TLS cert) from *Application
Settings → MinKNOW Stream* in the admin UI. Facility admins attach a running sequencing run to an
order from *Sequencing Data → Stream* on the order page. The simulator drops MinKNOW-shaped FASTQs
into a target directory at a configurable cadence (`SIMULATE_INTERVAL_MS`, `SIMULATE_BARCODES`) so
the full pipeline can be exercised without a real device.

## Headless pipeline runtime smoke test

On a Linux dev server with SeqDesk running, verify pipeline execution without a browser. The test
logs in through the API, chooses an order, runs the lightweight `simulate-reads` order pipeline once
locally and once through SLURM, then checks the generated run scripts, Nextflow config, queue IDs,
logs, and output files:

```bash
SEQDESK_RUNTIME_E2E_BASE_URL="https://your-seqdesk.example.org" \
SEQDESK_RUNTIME_E2E_EMAIL="admin@example.com" \
SEQDESK_RUNTIME_E2E_PASSWORD="admin-password" \
npm run pipeline:e2e:runtime -- --ensure-dummy-data
```

If `--order-id` is omitted, the script prefers the admin-owned dummy orders created by
**Admin → Settings → Load dummy data**; with `--ensure-dummy-data` it calls that seed endpoint
automatically when those orders are missing. Useful variants:

```bash
npm run pipeline:e2e:runtime -- --skip-slurm --ensure-dummy-data
npm run pipeline:e2e:runtime -- --skip-local --ensure-dummy-data
npm run pipeline:e2e:runtime -- --include-default-policy --expect-default-mode slurm
npm run pipeline:e2e:runtime -- --order-id <order-id>
```

The full local + SLURM run requires `sbatch`, `squeue`, and `sacct` on the host. Use `--skip-slurm`
for a local-only check on machines without SLURM.
