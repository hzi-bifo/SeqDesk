# SeqDesk

**Sequencing facility management — from order submission to data publishing.** SeqDesk handles
sequencing orders, samples, studies, sequencing files, and bioinformatics pipeline execution, and
runs self-hosted on your own infrastructure.

> 📖 **Full documentation: [seqdesk.org/docs](https://seqdesk.org/docs)** — installation,
> configuration, orders & studies, sequencing files, pipelines, ENA submission, administration, and
> updates. This README covers installing and developing **the repository itself**.

## Supported installation baseline

| Component | Supported requirement |
| --- | --- |
| Host | Linux or a local macOS application install on `x64` or `arm64`. Native Windows is unsupported; WSL is guidance only and is not currently CI-tested. |
| Node.js | **`>=22.13.0 <23` or `>=24 <25`** (Node 24 recommended). Node 23, 25, and future majors are rejected until explicitly supported. |
| PostgreSQL | **14 or newer**; PostgreSQL 14 through 18 are represented in the current CI matrix. SQLite is not supported. |
| Installer tools | npm, Bash, `curl`, `tar`, and `sha256sum` or `shasum`. |
| Install target | A new, writable directory with at least the larger of 2 GB or three times the release-archive size free. |
| Optional pipelines | The installer can provision Miniconda, Java 17, and Nextflow; Slurm is optional for cluster execution. Pipeline evidence is Linux-only. |

## CI installation coverage

The two required rows run for every pull request, `main` push, merge-queue
candidate, and release. Extended rows run weekly and on manual workflow runs. A
combination counts as demonstrated only when its corresponding job is green.

| CI tier | Operating system | CPU | Node.js | PostgreSQL | Scope |
| --- | --- | --- | --- | --- | --- |
| Required minimum | Ubuntu 22.04 | x64 | 22.13.0 | 14 | Clean application install |
| Required recommended | Ubuntu 24.04 | x64 | 24 | 16 | Clean application install |
| Extended | Ubuntu 24.04 | ARM64 | 24 | 17 | Clean application install |
| Extended | macOS 15 | ARM64 and Intel x64 | 24 | 16 | Application install only |
| Extended | Debian 12 container | x64 | Current 22.x | 18 | Application install on Debian userland |
| Extended | Rocky Linux 9 container | x64 | 24 | 15 | Application install on Rocky userland |
| Extended pipeline | Ubuntu 24.04 | x64 | 24 | 16 | Install plus packaged `fastq-checksum` workflow |

See [Installation compatibility](./INSTALLATION_COMPATIBILITY.md) for what each
job proves, its limitations, and how to download reviewer-facing evidence.

## Continuous verification

<table>
<tr><th width="160" align="left">Status</th><th align="left">What it verifies</th></tr>
<tr>
  <td><a href="https://github.com/hzi-bifo/SeqDesk/actions/workflows/test.yml"><img alt="CI" src="https://github.com/hzi-bifo/SeqDesk/actions/workflows/test.yml/badge.svg?branch=main"></a></td>
  <td>Unit &amp; integration test suite, run on every push</td>
</tr>
<tr>
  <td><a href="https://codecov.io/gh/hzi-bifo/SeqDesk"><img alt="codecov" src="https://codecov.io/gh/hzi-bifo/SeqDesk/branch/main/graph/badge.svg?token=SMQXMDYACH"></a></td>
  <td>Source-code coverage of <code>src/**</code>, reported to Codecov</td>
</tr>
<tr>
  <td><a href="https://github.com/hzi-bifo/SeqDesk/actions/workflows/playwright.yml"><img alt="Playwright E2E" src="https://github.com/hzi-bifo/SeqDesk/actions/workflows/playwright.yml/badge.svg?branch=main"></a></td>
  <td>Browser (UI) end-to-end tests against a live instance (see <a href="./PLAYWRIGHT_TESTS.md">PLAYWRIGHT_TESTS.md</a>)</td>
</tr>
<tr>
  <td><a href="https://github.com/hzi-bifo/SeqDesk/actions/workflows/order-pipeline-e2e.yml"><img alt="Order Pipeline" src="https://github.com/hzi-bifo/SeqDesk/actions/workflows/order-pipeline-e2e.yml/badge.svg?branch=main"></a></td>
  <td>Order-level pipelines (simulate-reads, FASTQ checksum, FastQC) run end to end on small synthetic reads, plus read-cleaning promotion writeback</td>
</tr>
<tr>
  <td><a href="https://github.com/hzi-bifo/SeqDesk/actions/workflows/study-pipeline-e2e.yml"><img alt="Study Pipeline" src="https://github.com/hzi-bifo/SeqDesk/actions/workflows/study-pipeline-e2e.yml/badge.svg?branch=main"></a></td>
  <td>Study-level pipelines (simulate-reads, study demo report, nf-core/mag) run end to end on small synthetic reads; nf-core/mag runs a reduced configuration (megahit assembly only — bin QC, GTDB-Tk taxonomy, and annotation are skipped), verifying the wiring rather than producing a real assembly</td>
</tr>
<tr>
  <td><a href="https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-e2e-ubuntu.yml"><img alt="Install (Ubuntu)" src="https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-e2e-ubuntu.yml/badge.svg?branch=main"></a></td>
  <td>Install (tarball, npm, source, PM2) → boot → admin &amp; researcher login, on Ubuntu</td>
</tr>
<tr>
  <td><a href="https://github.com/hzi-bifo/SeqDesk/actions/workflows/reviewer-install-matrix.yml"><img alt="Reviewer install matrix" src="https://github.com/hzi-bifo/SeqDesk/actions/workflows/reviewer-install-matrix.yml/badge.svg?branch=main"></a></td>
  <td>Required Ubuntu boundary installs on every change, plus scheduled/manual ARM64, macOS, Debian, Rocky Linux, Windows-contract, and pipeline-toolchain coverage</td>
</tr>
<tr>
  <td><em>private CI</em></td>
  <td>SLURM pipeline execution as a real Slurm job (<code>sbatch</code>/<code>squeue</code>/<code>sacct</code>), on small synthetic reads</td>
</tr>
<tr>
  <td><em>private CI</em></td>
  <td>AlmaLinux install, then boot</td>
</tr>
<tr>
  <td><em>release gate</em></td>
  <td>In-app update to a new release + one-click rollback, applied on a real PM2 install and verified to preserve data (run before each release)</td>
</tr>
</table>

_The SLURM and AlmaLinux rows run on a private self-hosted mirror (a real SLURM cluster and a production-like AlmaLinux box); the update/rollback release gate runs before each release through the in-app updater. These are exercised on demand rather than on every push, so they are not badged here._

## Features

- **Orders & samples** — submit and track sequencing orders; collect per-sample data with configurable forms.
- **Studies & metadata** — group samples across orders into studies with standardized MIxS metadata.
- **Sequencing files** — discover, assign, and track raw/cleaned read files with checksums and barcode-based matching.
- **Pipelines** — run bioinformatics workflows (FASTQ QC, read cleaning, assembly/MAG, …) locally or on SLURM, with live monitoring and result write-back.
- **ENA submission** — register studies and samples and submit reads, assemblies, and bins to ENA.
- **Self-hosted** — runs on your own infrastructure; your data stays with you.

## Deployment Environment

SeqDesk is designed to run inside a closed, trusted network, for example behind a VPN or restricted
to an internal/institutional intranet. It should not be exposed directly to the public internet.
Access should be limited to authorized users on the protected network. Convenience-oriented
defaults, including open self-registration and bootstrap accounts, assume this trusted-network
context; deploying SeqDesk on a publicly reachable host is not a supported or secure configuration.

The public demo at [demo.seqdesk.org](https://demo.seqdesk.org) is the intentional exception. It is
a sandbox for exploring the UI. Open `https://demo.seqdesk.org/demo` for the researcher view or
`https://demo.seqdesk.org/demo/admin` for the facility-admin view; each visitor gets their own
disposable, isolated demo workspace (tracked by a browser cookie and cleaned up automatically after a
few hours of inactivity). You
can optionally append `?workspace=<key>` to open or resume a specific named workspace — handy for
sharing a populated sandbox or returning to one later — but anyone using the same key shares that
workspace and its data, so leave it off to get a fresh private one. These entry points bootstrap a
temporary demo session; the plain `/admin` route is the normal protected dashboard, not a demo entry
point. This does not change the deployment guidance for real SeqDesk instances.

## Install

Recommended — the npm launcher handles installation and diagnostics. Installed
application releases are updated later from **Admin → Settings → Software
Updates**:

```bash
npm i -g seqdesk@latest
seqdesk --interactive
```

### Linux quick start

For a small local evaluation on Ubuntu, Debian, RHEL, AlmaLinux, or Rocky
Linux, install a supported Node.js release first. The examples below install
the supported Node.js 22 line; Node.js 24 is recommended when it is available
from your normal package source:

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# RHEL / AlmaLinux / Rocky Linux
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
```

Then run the guided installer into a new directory owned by your login user:

```bash
npm i -g seqdesk@latest

# Run this first only when the installer should provision local PostgreSQL.
sudo -v

SEQDESK_BIND_HOST=127.0.0.1 seqdesk --interactive \
  --dir "$HOME/seqdesk" \
  --without-pipelines
```

The local PostgreSQL option can install and start PostgreSQL when the
distribution uses `apt`, `dnf`, or `yum`. That path needs root or a current
passwordless/cached `sudo` authorization; use an existing PostgreSQL 14+
server or a managed database if system-package installation is unavailable.

`--without-pipelines` keeps an evaluation install small. Omit it on a Linux
host that should also run Conda/Nextflow workflows. When installation
finishes, verify the instance and open <http://127.0.0.1:8000>:

```bash
seqdesk doctor --dir "$HOME/seqdesk" --url http://127.0.0.1:8000
```

For a service install under `/opt`, create a parent owned by the non-root
service account, then install into a new child directory; do not run the
application as root:

```bash
sudo install -d -o "$USER" -g "$(id -gn)" /opt/seqdesk
seqdesk --interactive --dir /opt/seqdesk/app
```

SeqDesk assumes a trusted network. Before using a network-reachable bind,
configure the host firewall or reverse proxy and replace all bootstrap
credentials. See the full
[Linux installation guide](https://seqdesk.org/docs/installation/linux) for
distribution-specific PostgreSQL setup, migration, PM2 startup, and
troubleshooting.

### macOS quick start

For a small local evaluation, install Node.js, then let the guided installer
provision (or reuse) PostgreSQL and install SeqDesk into a **new** directory:

```bash
brew install node@24
export PATH="$(brew --prefix node@24)/bin:$PATH"

npm i -g seqdesk@latest
SEQDESK_BIND_HOST=127.0.0.1 seqdesk --interactive \
  --dir "$HOME/seqdesk" \
  --without-pipelines
```

For the local-database choice, the installer installs PostgreSQL 16 when needed,
starts it as your macOS login user, and reuses an already-running PostgreSQL 14+
server. Do not use `sudo brew services start`: PostgreSQL refuses to run as root,
and the installer will report stale root services, ownership problems, port
conflicts, and the relevant Homebrew log path with repair commands.

`--without-pipelines` keeps the first install small; omit it when this Mac should
also run Conda/Nextflow workflows. If `~/seqdesk` already exists, use a different
directory or follow the reconfiguration guide—do not overwrite it casually.

When installation finishes, verify the instance and open
<http://127.0.0.1:8000>:

```bash
seqdesk doctor --dir "$HOME/seqdesk" --url http://127.0.0.1:8000
```

The installer records this local-only bind in the installation's root start
wrapper, so later manual or PM2 starts retain it. An explicitly supplied
`SEQDESK_BIND_HOST` can still override the stored value. SeqDesk's bootstrap
login must not be exposed to an untrusted network. See the full
[macOS installation guide](https://seqdesk.org/docs/installation/macos) for
PostgreSQL service conflicts, pipelines, PM2 startup, and troubleshooting.

Installer flags pass straight through the launcher, for example:

```bash
seqdesk -y --config ./infrastructure-setup.json
```

Fallback when the global npm launcher cannot be installed (a supported
Node.js release and npm are still required):

```bash
curl -fsSL https://seqdesk.org/install.sh | \
  bash -s -- -y --dir "$HOME/seqdesk"
```

The command shown is unattended because it passes `-y`. For the supported
guided fallback, download the script first and run it from a terminal:

```bash
curl -fsSL https://seqdesk.org/install.sh -o /tmp/seqdesk-install.sh
bash /tmp/seqdesk-install.sh --interactive --dir "$HOME/seqdesk"
```

Full installation, configuration, and unattended options are documented at
**[seqdesk.org/docs/installation](https://seqdesk.org/docs/installation)**.

> The npm package is the supported public entry point; it downloads and runs the public installer
> served from `seqdesk.org/install.sh`. Editing `scripts/install-dist.sh` in this repository does
> **not** change the live installer until the matching `public/install.sh` in the SeqDesk.com
> repository has been updated and deployed.

### Ways to install SeqDesk

Every path boots the same app — pick by your scenario. CI coverage exercises
installation, migration, boot, and HTTP reachability. Required jobs run on every
change; extended and private jobs count as evidence only when their own run is
green.

| Method | Command | Best for | CI coverage |
| --- | --- | --- | --- |
| npm launcher (recommended) | `npm i -g seqdesk@latest` then `seqdesk --interactive` | Almost everyone — supported install path with built-in updates afterward | Required Ubuntu; extended macOS; private AlmaLinux |
| One-line installer | `curl -fsSL https://seqdesk.org/install.sh \| bash -s -- -y --dir "$HOME/seqdesk"` | Non-interactive fallback when the global npm launcher cannot be installed; Node.js and npm are still required | Required Ubuntu |
| Linux | `npm i -g seqdesk@latest` then `SEQDESK_BIND_HOST=127.0.0.1 seqdesk --interactive --dir "$HOME/seqdesk" --without-pipelines` | Local Linux workstation / evaluation install; prepare an owned service directory separately for production | Required Ubuntu; extended Debian, Rocky Linux, and ARM64; private AlmaLinux |
| macOS (Homebrew) | `npm i -g seqdesk@latest` then `SEQDESK_BIND_HOST=127.0.0.1 seqdesk --interactive --dir "$HOME/seqdesk" --without-pipelines` | Local Mac workstation / evaluation installs | Extended weekly/manual |
| Unattended | `seqdesk -y --config ./infrastructure-setup.json` | Fleet or scripted deployments; reapply configuration with `--reconfigure` | Required Ubuntu |
| From source | `bash scripts/install.sh` | Developers / CI building a specific branch | Ubuntu; private AlmaLinux |

The npm-launcher and source installs are also exercised under PM2. When the
extended/private npm, AlmaLinux, and macOS jobs are green, they also verify that
an administrator can log in to the running app.

For the exact required and scheduled combinations, assertions, limitations, and
downloadable evidence, see **[Installation compatibility](./INSTALLATION_COMPATIBILITY.md)**.

## FAQ

A few common installation and setup questions. See the full
**[FAQ](https://seqdesk.org/docs/faq)** for more.

**What do I need to run SeqDesk?** Node.js `>=22.13.0 <23` or `>=24 <25`, a
PostgreSQL 14+ database, and Linux or a local macOS application environment.
Pipelines are optional and add Conda, Java, and Nextflow (plus Slurm for cluster
execution). See the baseline table above for storage and installer tools.

**Does it work with SQLite?** No — SeqDesk is PostgreSQL-only. An existing SQLite
instance must stay on its last SQLite-compatible release until it is migrated to
PostgreSQL.

**How do I log in the first time?** Browse to the instance URL — the setup wizard
checks the database and applies the schema automatically. Seeded bootstrap
accounts are `admin@example.com` / `admin` and `user@example.com` / `user`;
**change or remove them immediately** on any shared instance.

**The installer aborts because the directory already exists.** With `-y` it
refuses to overwrite. Pass `--overwrite-existing` to back the old directory up to
`<dir>.backup.<timestamp>` and replace it.

**Migrations hang or time out on a pooled database (e.g. Neon).** Point
`DIRECT_URL` at the *unpooled* endpoint — `migrate deploy` needs a session-level
advisory lock a transaction pooler can't hold. SeqDesk also derives the unpooled
URL automatically as a safety net.

**Can I expose SeqDesk to the public internet?** No — it assumes a trusted,
closed network (VPN or intranet). The public demo at `demo.seqdesk.org` is the
only intentional exception.

**How do I check an install is healthy, or update and roll back?** `seqdesk
doctor` (read-only) verifies layout, database reachability, and HTTP. Updates go
through **Admin → Settings → Software Updates**; upgrading the npm launcher
updates the CLI only. The built-in updater retains the previous release for
rollback.

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

Default seeded users are intended for local development/bootstrap only:

- Admin — `admin@example.com` / `admin`
- Researcher — `user@example.com` / `user`

For any shared or network-reachable instance, prefer configuring real bootstrap accounts before
the first seed/install. If you use the defaults, change or remove those accounts immediately after
first login. Later config edits do not rotate passwords for accounts that already exist.

Generate one bcrypt password hash per account after `npm ci`:

```bash
node -e 'const { hashSync } = require("bcryptjs"); console.log(hashSync(process.argv[1], 12));' 'replace-with-strong-password'
```

Then add the accounts to `seqdesk.config.json` before running `npm run db:seed`:

```json
{
  "bootstrap": {
    "users": {
      "admin": {
        "email": "seqdesk-admin@your-org.example",
        "passwordHash": "$2b$12$...",
        "firstName": "SeqDesk",
        "lastName": "Admin",
        "facilityName": "Your Facility"
      },
      "researcher": {
        "email": "first-user@your-org.example",
        "passwordHash": "$2b$12$...",
        "firstName": "First",
        "lastName": "User",
        "institution": "Your Institution",
        "researcherRole": "POSTDOC"
      }
    }
  }
}
```

For configuration details, testing, the live test dashboard, background workers, and the pipeline
e2e harnesses, see **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

## Documentation

- User & operator guide: [seqdesk.org/docs](https://seqdesk.org/docs)
- Beginner AWS deployment: [Install SeqDesk on AWS EC2](./AWS_EC2_INSTALLATION.md)
- Tested environments and CI evidence: [Installation compatibility](./INSTALLATION_COMPATIBILITY.md)
- Releases and update info: [seqdesk.org](https://seqdesk.org)

## License

Licensed under the Apache License 2.0 — see [LICENSE](./LICENSE).
