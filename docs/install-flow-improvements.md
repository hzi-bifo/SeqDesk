# Install Flow Improvements (Implementation Notes)

This document describes the current installer behavior and the requirements it
must continue to satisfy. It is not a user guide.

## Entry Points
- Distribution: `curl -fsSL https://seqdesk.com/install.sh | bash`
- Source: `curl -fsSL https://raw.githubusercontent.com/hzi-bifo/SeqDesk/main/scripts/install.sh | bash`

## Implemented Flow (High Level)

### Source installer (`scripts/install.sh`) — 8 steps
1. Step 1/8: Detect system (OS, arch).
2. Step 2/8: Check dependencies (git, node, npm). Installs missing deps.
3. Step 3/8: Pipeline support prompt (Conda + Nextflow).
4. Step 4/8: Download SeqDesk (git clone).
5. Step 5/8: Install npm dependencies.
6. Step 6/8: Configure environment (wizard or prompts, `.env` + `seqdesk.config.json`).
7. Step 7/8: Initialize database (Prisma).
8. Step 8/8: Pipeline environment setup (skipped if disabled).

### Distribution installer (`scripts/install-dist.sh`) — 7 steps
1. Step 1/7: Detect system (OS, arch).
2. Step 2/7: Check dependencies (node, npm). Offers to install Node if missing/outdated.
3. Step 3/7: Pipeline support prompt (Conda + Nextflow).
   - Prints a preflight summary after pipeline selection.
4. Step 4/7: Download SeqDesk (release tarball).
5. Step 5/7: Extract package.
6. Step 6/7: Configure environment (wizard or prompts, `.env` + `seqdesk.config.json`).
   - Database init (`npx prisma db push`) occurs inside this step (no separate step header).
7. Step 7/7: Pipeline environment setup (skipped if disabled).

## Prompts and Defaults
- App port: default `3000`
- `NEXTAUTH_URL`: auto-derived as `http://localhost:<port>` unless explicitly set
- Data base path: not prompted in installer (configure later in Admin > Data Storage, or set `SEQDESK_DATA_PATH`)
- Pipeline run directory: not prompted in installer (configure later in Admin > Pipeline Runtime, or set `SEQDESK_RUN_DIR`)
- `DATABASE_URL`: optional via env override (`SEQDESK_DATABASE_URL`)

Prompts read from `/dev/tty` so `curl | bash` still works interactively.
If a TTY is present, the installer will invoke `scripts/install-wizard.mjs`
to provide a guided setup. If the wizard cannot run, it falls back to the
plain shell prompts.
After prompts, the installer prints a configuration summary and asks for
confirmation (skipped when `SEQDESK_YES=1`).

## Non-Interactive Mode
- CLI: `curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y`
- `SEQDESK_YES=1` (accept defaults, skip prompts)
- `SEQDESK_WITH_PIPELINES=1` (force pipeline setup)
- `SEQDESK_WITH_CONDA=1` (legacy alias for pipeline setup)
- `SEQDESK_SKIP_DEPS=1` (skip dependency install prompts)
- `--config <path-or-url>` (or `SEQDESK_CONFIG=...`) to load infrastructure JSON
- Overrides:
  - `SEQDESK_DATA_PATH`
  - `SEQDESK_RUN_DIR`
  - `SEQDESK_NEXTAUTH_URL`
  - `SEQDESK_DATABASE_URL`
  - `SEQDESK_EXEC_*` runtime settings (SLURM, conda, weblog)

## Error Reporting
- Uses `set -euo pipefail` and an `ERR` trap to print the failed command.
- No `npm install --silent`.
- Prisma output is not redirected to `/dev/null`.
- Optional install log via `SEQDESK_LOG=/path/install.log`.

## Checklist (scripts/install.sh + scripts/install-dist.sh)

### Interaction and Flow
- [x] Step headers with counters (Step X/Y).
- [x] Prompt: install pipeline dependencies (Conda + Nextflow)?
- [x] If yes: install Miniconda (if missing) then run:
      `./scripts/setup-conda-env.sh --yes --write-config --pipelines-enabled`
- [x] If no: skip pipeline setup and note in summary.

### Configuration Prompts
- [x] Prompt for app port (default: `3000`).
- [x] Auto-set `NEXTAUTH_URL` to `http://localhost:<port>` unless provided.
- [x] Data base path configured later in app (or via `SEQDESK_DATA_PATH`).
- [x] Pipeline run dir configured later in app (or via `SEQDESK_RUN_DIR`).
- [x] `DATABASE_URL` remains optional via env override (`SEQDESK_DATABASE_URL`).
- [x] Prompt for enabling pipelines when conda is already installed.

### Non-Interactive Mode
- [x] `SEQDESK_YES=1` to accept defaults without prompts.
- [x] `SEQDESK_WITH_PIPELINES=1` to force pipeline setup.
- [x] Env overrides:
      - `SEQDESK_DATA_PATH`
      - `SEQDESK_RUN_DIR`
      - `SEQDESK_NEXTAUTH_URL`
      - `SEQDESK_DATABASE_URL`

### Error Reporting
- [x] Remove `--silent` from `npm install`.
- [x] Stop redirecting Prisma output to `/dev/null`.
- [x] On any failure, print the command that failed and exit non-zero.
- [x] Optional: write a log file via `SEQDESK_LOG`.

### Summary Output
- [x] Print install directory.
- [x] Indicate whether pipelines were enabled/disabled.
- [x] Print data path / run directory (when provided).
- [x] Print config file paths (`.env`, `seqdesk.config.json`).
- [x] Print conda version when available (pipelines enabled).
- [ ] Indicate conda env name or creation status.
- [x] Print next steps (start server, admin login, configure compute settings).

## Acceptance Tests (Manual)
- [ ] Fresh Ubuntu 22.04 server, no Node installed:
      - Installer should install Node 20 and succeed (source install).
- [ ] Conda missing and user says "no" to pipelines:
      - Installer should skip conda setup and complete.
- [ ] Conda missing and user says "yes":
      - Installer should install Miniconda and run setup script.
- [ ] `SEQDESK_YES=1`:
      - No prompts, use defaults and complete.
- [ ] Invalid `DATABASE_URL`:
      - Prisma error is visible and installer exits non-zero.

## Final Summary Templates (Examples)

### Source install (`scripts/install.sh`)

```
Install complete.
App directory: /opt/seqdesk
Node: v20.x
Conda: v24.x (if pipelines enabled)
Pipelines: enabled
Data path: /data/sequencing
Run directory: /data/pipeline_runs

Next steps:
1) cd /opt/seqdesk
2) npm run dev
3) Open http://localhost:3000
4) Admin Settings -> Compute -> set weblog URL
```

### Distribution install (`scripts/install-dist.sh`)

```
Install complete.
App directory: /opt/seqdesk
Node: v20.x
Pipelines: enabled

Next steps:
1) cd /opt/seqdesk
2) ./start.sh
3) Open http://localhost:3000
4) Admin Settings -> Compute -> set weblog URL
```
