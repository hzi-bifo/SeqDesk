# SeqDesk

[![CI](https://github.com/hzi-bifo/SeqDesk/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/test.yml)
[![Playwright E2E](https://github.com/hzi-bifo/SeqDesk/actions/workflows/playwright.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/playwright.yml)
[![Order Pipeline E2E](https://github.com/hzi-bifo/SeqDesk/actions/workflows/order-pipeline-smoke.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/order-pipeline-smoke.yml)
[![Install Smoke (Ubuntu)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-smoke-ubuntu.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-smoke-ubuntu.yml)
[![Install Twincore Instance (Alma Linux)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-twincore-alma.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-twincore-alma.yml)
[![codecov](https://codecov.io/gh/hzi-bifo/SeqDesk/branch/main/graph/badge.svg?token=SMQXMDYACH)](https://codecov.io/gh/hzi-bifo/SeqDesk)

SeqDesk is a sequencing facility management system for handling orders, samples, studies, sequencing files, and pipeline execution.

This repository intentionally keeps documentation minimal for public use.
Full user and operator documentation is published at:
[https://www.seqdesk.com/docs](https://www.seqdesk.com/docs)

## Quick Install

Recommended for regular installs and upgrades:

```bash
curl -fsSL https://seqdesk.com/install.sh | bash
```

NPM launcher (same installer flow):

```bash
npm i -g seqdesk
seqdesk
```

Common flags:

```bash
curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y --config ./infrastructure-setup.json
curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y --reconfigure --config ./infrastructure-setup.json
seqdesk -y --use-pm2 --dir /opt/seqdesk
```

## Source Installer

Use the source installer for advanced/dev checkouts rather than the recommended production path above:

```bash
bash scripts/install.sh -y --dir ./seqdesk-source
```

## Local Development

macOS shortcut for local testing with Homebrew PostgreSQL:

```bash
npm run dev:mac
```

This starts local PostgreSQL if needed, creates the default local `seqdesk`
database and role, runs migrations and seed data, then starts Next.js with
local PostgreSQL env overrides. It also sidesteps stale `.env` SQLite values.

### 1. Clone and install

```bash
git clone https://github.com/hzi-bifo/SeqDesk.git
cd SeqDesk
npm ci
```

### 2. Configure runtime values

```bash
cp seqdesk.config.example.json seqdesk.config.json
```

Set at least:

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

### 3. Initialize database

```bash
npm run db:migrate:deploy
npx prisma db seed
```

SeqDesk is now PostgreSQL-only. Existing SQLite installs must remain on the last
SQLite-compatible release until they are migrated manually.

### 4. Start

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Default seeded users:
- Admin: `admin@example.com` / `admin`
- Researcher: `user@example.com` / `user`

## Common Commands

```bash
npm run dev
npm run build
npm run start
npm test
```

## Live Test Dashboard

SeqDesk includes a local test dashboard that groups tests by section and shows live pass/fail/running state while the suite executes.

Start the default fast watcher:

```bash
npm run test:dashboard:watch
```

Other entry points:

```bash
npm run test:dashboard          # fast Vitest, one-shot
npm run test:dashboard:watch    # fast Vitest, persistent local dashboard
npm run test:dashboard:all      # all current Vitest tiers
npm run test:dashboard:risk     # risk-tier Vitest files
npm run test:dashboard:live     # live-tier Vitest files
npm run test:dashboard:ui       # Playwright UI/E2E tests in the same dashboard shell
```

Useful examples:

```bash
npm run test:dashboard -- --no-open src/lib/testing/dashboard.test.ts
npm run test:dashboard:ui -- --no-open playwright/tests/auth.setup.ts
```

Notes:
- The dashboard prints a local URL when it starts and can open the browser automatically.
- The page includes a tier selector and `Run Tests` button for local reruns.
- `ui` is a separate Playwright tier. `all` currently means Vitest-only, not Vitest + Playwright combined.

## UI E2E Coverage

Codecov now tracks repository source coverage across `src/**`.
Playwright browser coverage is still tracked separately from the Codecov percentage shown above, and the badge above reports the E2E workflow status.
Current local UI E2E coverage includes:

| Area | Covered Flows |
| --- | --- |
| Orders | order creation, multi-sample orders, order editing, mark sent |
| Studies | study creation from order samples |
| Admin | admin order creation, cross-user order visibility, submitted-order deletion blocked/allowed by Data Handling settings |

Run locally with:

```bash
npm run test:e2e
```

## Public Docs

- Main docs: [https://www.seqdesk.com/docs](https://www.seqdesk.com/docs)
- Releases and update info: [https://www.seqdesk.com](https://www.seqdesk.com)

## License

This project is licensed under the GNU Affero General Public License v3.0.
See the [LICENSE](./LICENSE) file for the full license text.
