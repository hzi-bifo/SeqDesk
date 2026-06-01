# SeqDesk

[![CI](https://github.com/hzi-bifo/SeqDesk/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/test.yml)
[![Playwright E2E](https://github.com/hzi-bifo/SeqDesk/actions/workflows/playwright.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/playwright.yml)
[![Order Pipeline E2E](https://github.com/hzi-bifo/SeqDesk/actions/workflows/order-pipeline-e2e.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/order-pipeline-e2e.yml)
[![Study Pipeline E2E](https://github.com/hzi-bifo/SeqDesk/actions/workflows/study-pipeline-e2e.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/study-pipeline-e2e.yml)
[![Pipeline SLURM E2E](https://github.com/hzi-bifo/SeqDesk/actions/workflows/pipeline-slurm-e2e.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/pipeline-slurm-e2e.yml)
[![Install E2E (Ubuntu)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-e2e-ubuntu.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-e2e-ubuntu.yml)
[![Alma Install E2E](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-profile-alma.yml/badge.svg?branch=main)](https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-profile-alma.yml)
[![codecov](https://codecov.io/gh/hzi-bifo/SeqDesk/branch/main/graph/badge.svg?token=SMQXMDYACH)](https://codecov.io/gh/hzi-bifo/SeqDesk)

**Sequencing facility management — from order submission to data publishing.** SeqDesk handles
sequencing orders, samples, studies, sequencing files, and bioinformatics pipeline execution, and
runs self-hosted on your own infrastructure.

> 📖 **Full documentation: [seqdesk.com/docs](https://www.seqdesk.com/docs)** — installation,
> configuration, orders & studies, sequencing files, pipelines, ENA submission, administration, and
> updates. This README covers installing and developing **the repository itself**.

## Features

- **Orders & samples** — submit and track sequencing orders; collect per-sample data with configurable forms.
- **Studies & metadata** — group samples across orders into studies with standardized MIxS metadata.
- **Sequencing files** — discover, assign, and track raw/cleaned read files with checksums and barcode-based matching.
- **Pipelines** — run bioinformatics workflows (FASTQ QC, read cleaning, assembly/MAG, …) locally or on SLURM, with live monitoring and result write-back.
- **ENA submission** — register studies and samples and submit reads, assemblies, and bins to ENA.
- **Self-hosted** — runs on your own infrastructure; your data stays with you.

## Requirements

- Node.js 18+
- PostgreSQL (SeqDesk is PostgreSQL-only)
- Optional, for pipelines: Conda and/or Nextflow — and SLURM for cluster execution

## Install

Recommended — the npm launcher handles installs and upgrades:

```bash
npm i -g seqdesk
seqdesk
```

Installer flags pass straight through the launcher, for example:

```bash
seqdesk -y --config ./infrastructure-setup.json
seqdesk -y --profile <id> --profile-code <code>   # apply a hosted install profile
```

Organizations can create install profiles at [seqdesk.com](https://www.seqdesk.com) that bundle form
fields, pipeline settings, and module configuration; the installer fetches and applies them during
setup. Fallback when npm is unavailable:

```bash
curl -fsSL https://seqdesk.com/install.sh | bash
```

Full installation, configuration, unattended, and hosted-profile options are documented at
**[seqdesk.com/docs/installation](https://www.seqdesk.com/docs/installation)**.

> The npm package is the supported public entry point; it downloads and runs the public installer
> served from `seqdesk.com/install.sh`. Editing `scripts/install-dist.sh` in this repository does
> **not** change the live installer until the matching `public/install.sh` in the SeqDesk.com
> repository has been updated and deployed.

## Local development

```bash
git clone https://github.com/hzi-bifo/SeqDesk.git
cd SeqDesk
npm ci
cp seqdesk.config.example.json seqdesk.config.json   # set runtime.databaseUrl and nextAuthSecret
npm run db:migrate:deploy
npm run db:seed
npm run dev                                           # http://localhost:3000
```

On macOS with Homebrew PostgreSQL, `npm run dev:mac` starts/creates the local database, runs
migrations and seed data, and launches the dev server in one step.

Default seeded users:

- Admin — `admin@example.com` / `admin`
- Researcher — `user@example.com` / `user`

For configuration details, testing, the live test dashboard, background workers, and the pipeline
e2e harnesses, see **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

## Documentation

- User & operator guide: [seqdesk.com/docs](https://www.seqdesk.com/docs)
- Releases and update info: [seqdesk.com](https://www.seqdesk.com)

## License

Licensed under the Apache License 2.0 — see [LICENSE](./LICENSE).
