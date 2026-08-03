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
| PostgreSQL | **14 or newer**; PostgreSQL 14 through 18 are represented in the current CI matrix. SQLite is not supported. You normally do not supply a database: when no reusable local server or socket is found, the installer creates and owns a private, socket-only cluster under `$SEQDESK_PG_HOME` (default `~/.seqdesk/postgres`). Because of the macOS Unix-socket length limit the cluster's socket directory `$SEQDESK_PG_HOME/socket` is capped at 85 characters, so `$SEQDESK_PG_HOME` itself must be **78 characters or shorter**. |
| Installer tools | npm, Bash, `curl`, `tar`, and `sha256sum` or `shasum`. |
| Install target | A new, writable directory with at least the larger of 2 GB or three times the release-archive size free. A SeqDesk-owned PostgreSQL cluster is created separately under `$SEQDESK_PG_HOME` and does not consume this directory. |
| Optional pipelines | The installer reuses a working existing Conda base or provisions Miniconda with Python 3.11, Java 17, Nextflow, nf-core, and supporting tools; Slurm is optional for cluster execution. Pipeline evidence is Linux-only. |

## CI installation coverage

The three required rows run for every pull request, `main` push, merge-queue
candidate, and release. Extended rows run weekly and on manual workflow runs. A
combination counts as demonstrated only when its corresponding job is green.

| CI tier | Operating system | CPU | Node.js | PostgreSQL | Scope |
| --- | --- | --- | --- | --- | --- |
| Required minimum | Ubuntu 22.04 | x64 | 22.13.0 | 14 | Clean application install |
| Required recommended | Ubuntu 24.04 | x64 | 24 | 16 | Clean application install |
| Required macOS | macOS 15 | ARM64 | 24 | 16 | Clean application install |
| Extended | Ubuntu 24.04 | ARM64 | 24 | 17 | Clean application install |
| Extended | macOS 15 | ARM64 and Intel x64 | 24 | 16 | Application install only; the ARM64 leg repeats the required macOS job |
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
  <td>Study-level pipelines (Study Demo Report and nf-core/mag) run end to end on small synthetic reads prepared by the order-level Simulate Reads utility; nf-core/mag runs a reduced configuration (megahit assembly only — bin QC, GTDB-Tk taxonomy, and annotation are skipped), verifying the wiring rather than producing a real assembly</td>
</tr>
<tr>
  <td><a href="https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-e2e-ubuntu.yml"><img alt="Install (Ubuntu)" src="https://github.com/hzi-bifo/SeqDesk/actions/workflows/install-e2e-ubuntu.yml/badge.svg?branch=main"></a></td>
  <td>Install (tarball, npm, source, PM2) → boot → admin &amp; researcher login, on Ubuntu</td>
</tr>
<tr>
  <td><a href="https://github.com/hzi-bifo/SeqDesk/actions/workflows/reviewer-install-matrix.yml"><img alt="Reviewer install matrix" src="https://github.com/hzi-bifo/SeqDesk/actions/workflows/reviewer-install-matrix.yml/badge.svg?branch=main"></a></td>
  <td>Required Ubuntu and macOS ARM64 boundary installs on every change, plus scheduled/manual ARM64 Linux, macOS Intel, Debian, Rocky Linux, Windows-contract, and pipeline-toolchain coverage</td>
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

Recommended — download the public installer first so the guided prompts stay
connected to your terminal. Installed application releases are updated later
from **Admin → Settings → Software Updates**:

```bash
curl -fsSLo /tmp/seqdesk-install.sh https://seqdesk.org/install.sh &&
bash /tmp/seqdesk-install.sh --interactive --dir "$HOME/seqdesk"
```

### Configure Data Storage after installation

Choose the existing absolute directory that SeqDesk should scan for sequencing
files. The installer creates a writable starting directory under the install:

```bash
seqdesk storage configure "$HOME/seqdesk/data"
seqdesk storage status
```

Use `--create` only when a deliberately chosen directory does not exist. SeqDesk
does not create missing storage paths silently because that could hide a typo or
an unavailable network mount. The command validates the path and keeps
`settings.json` and the stored site setting synchronized. For automation, add
`--yes --json`; `storage status` exits non-zero until the configured directory
is ready. If `SEQDESK_DATA_PATH` manages the running service, update that
environment variable instead.

See the [Data Storage guide](https://seqdesk.org/docs/administration/data-storage)
for path ownership, automation, service overrides, and discovery behavior.

### Load demo data

After storage is configured and writable by the SeqDesk service, a facility
administrator can create the example dataset from **Admin → Settings → Demo
data** or from the server shell:

```bash
seqdesk demo-data status
seqdesk demo-data install
```

The install creates two studies, four orders, their samples and read rows, and
deterministic synthetic gzipped FASTQ files below the configured storage path.
It is useful for demonstrations, screenshots, and automated tests, but it is
not scientific data. Re-running `install` is idempotent and does not create
duplicates. On an installation with more than one facility administrator, use
`--user-email admin@example.org` to select the owner.

Use `--yes` with `install` or `remove` to skip confirmation in automation.
Those mutations require `--yes` when combined with `--json`; `status --json`
can be used on its own:

```bash
seqdesk demo-data install --user-email admin@example.org --yes --json
seqdesk demo-data remove --user-email admin@example.org --yes --json
```

Removal is scoped to the selected administrator's seeded records and generated
files; it does not wipe unrelated SeqDesk data. Support tickets are preserved,
but links from those tickets to removed seeded orders/studies are cleared and
reported. Linked pipeline runs must be deleted through **Pipeline Runs** first
so their normal cancellation and output cleanup can complete. SeqDesk remembers
the fixture's original storage path even if the configured data path later
changes. That original path must be available and writable for removal. If it
is unavailable before cleanup starts, SeqDesk leaves the database rows intact.
If folder deletion fails after row cleanup, SeqDesk retains the original path
as pending cleanup so a later `remove` retries the same folder. Restore the path
and run `remove` again. `seqdesk install dummy_data` remains available as a
compatibility alias for `seqdesk demo-data install`.

### Add pipelines after installation

A normal installation starts with the core SeqDesk application. It does not
provision the optional Conda, Java, and Nextflow runtime up front. The installer
creates a user command at `~/.local/bin/seqdesk` and remembers the selected
installation, so `--dir` is normally unnecessary. If a new shell cannot find
the command, add `~/.local/bin` to `PATH` or run it by its full path.

List every supported pipeline, or filter by where it can run:

```bash
seqdesk pipelines list
seqdesk pipelines list --catalog order
seqdesk pipelines list --catalog study
seqdesk pipelines list --installed
```

The table separates the pipeline's target, package state, setup state,
activation state, and next required action. `available` means the package can be
installed, `bundled` means it already ships with the current SeqDesk release,
and `installed` means it was added or updated through the Pipeline Store.

For example, install the lightweight, order-level **Simulate Reads** demo and
provision the managed runtime if it is missing:

```bash
seqdesk pipelines install simulate-reads --runtime
seqdesk pipelines status simulate-reads
```

SeqDesk enables the pipeline automatically only when all readiness checks pass.
Otherwise the package remains installed but disabled, and the status lists the
missing runtime, configuration, reference database, storage path, or run path.
When storage is missing, the printed next action is the same
`seqdesk storage configure` command shown above.
Database assets are never downloaded silently: install or link them under
**Admin → Pipelines → _pipeline_ → Databases**, then check the status again.

`simulate-reads` creates demo FASTQ files—either synthetically or from
configured facility templates—and links them to samples in one sequencing
order. Use it only with a dedicated test order. For a safe demo, explicitly
select the synthetic source and disable replacement of existing linked reads.

See [Installing and setting up pipelines](https://seqdesk.org/docs/pipelines/installing-pipelines)
for the guided setup flow, automation options, private sources, and a complete
safe demo.

SeqDesk binds to `0.0.0.0` (every interface) unless `SEQDESK_BIND_HOST` is set
at install or start time. For a local-only evaluation, prefix the command with
`SEQDESK_BIND_HOST=127.0.0.1`, as the Linux and macOS quick starts below do.

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

Then download and run the guided installer into a new directory owned by your
login user:

```bash
curl -fsSLo /tmp/seqdesk-install.sh https://seqdesk.org/install.sh

# Only needed when the PostgreSQL server package is missing and the installer
# must install it (apt/dnf/yum), or when a system PostgreSQL is already running
# and its role and database must be created via `sudo -n -u postgres psql`.
sudo -v

SEQDESK_BIND_HOST=127.0.0.1 bash /tmp/seqdesk-install.sh --interactive \
  --dir "$HOME/seqdesk"
```

SeqDesk sets the database up itself in most cases. It first reuses a healthy
local server, then a local Unix socket you own; if neither exists it creates its
**own** PostgreSQL cluster under `$SEQDESK_PG_HOME` (default
`~/.seqdesk/postgres`), owned by your login user and reachable only through a
private Unix socket — no TCP port and no systemd unit. `sudo` is needed in only
two cases: to install the PostgreSQL server package when it is absent (`apt`,
`dnf`, or `yum`), and to create the role and database inside a pre-existing
*system* PostgreSQL, which the installer reaches with
`sudo -n -u postgres psql`. Do not run the installer itself under `sudo`: as
root it refuses to create a PostgreSQL instance and requires an explicit
`--database-url`. Supply `--database-url "postgresql://..."` for an existing
PostgreSQL 14+ or managed server. You do **not** need it when the only local
socket (for example a distribution server on `/var/run/postgresql`) belongs to
another user: SeqDesk will not send generated credentials to an endpoint it does
not own, so it warns, skips that socket, and provisions its own private cluster
instead. Pass `--database-url` in that case only if you want that server used.

Fresh installs now default to the smaller core application. Add
`--with-pipelines` only on a Linux host that should also provision
Conda, Java, and Nextflow during the initial install. You can leave it off and
provision the same managed runtime later with
`seqdesk pipelines install <name> --runtime`.

Near the end the installer asks `Start SeqDesk with PM2 for auto-restart?
(recommended)`. Accepting it starts the app, saves the PM2 process list, and
tries to enable PM2's boot startup — if that needs privileges it did not have,
the closing summary prints the `pm2 startup` / `pm2 save` commands to run.
Declining leaves you to run `<dir>/start.sh` yourself, and a manual start does
not come back after a reboot. When the installer provisioned its own PostgreSQL
cluster, that same wrapper (`<dir>/start.sh`) checks
`pg_ctl -D ~/.seqdesk/postgres/data status` and starts the database before
launching the app — the private cluster is deliberately not a systemd service,
so after a reboot PM2 resurrects the app and the app starts its own database.
Installs that reuse an existing PostgreSQL server get no such snippet.

If you left an account password blank, the installer generated a strong one and
prints it exactly once, in the **Login** block near the end of the run. It is
deliberately kept out of the install log, so copy it before closing the
terminal. A generated password applies to an account the install actually
creates; on a database that already holds that account, the account's existing
password stays in force — see
[Reinstalling on a host that already ran SeqDesk](#reinstalling-on-a-host-that-already-ran-seqdesk).

When installation finishes, verify the instance and open
<http://127.0.0.1:8000>:

```bash
npx -y seqdesk@latest doctor --dir "$HOME/seqdesk" --url http://127.0.0.1:8000
```

`doctor` understands the private cluster's Unix-socket `DATABASE_URL` only in
launcher versions **newer than 1.1.122**. On 1.1.122 it probes `localhost:5432`
over TCP instead and reports `PostgreSQL TCP … unreachable` for an install that
is healthy; check that database directly with
`psql -h ~/.seqdesk/postgres/socket -d seqdesk -c 'select 1'`.

For a service install under `/opt`, create a parent owned by the non-root
service account, then install into a new child directory; do not run the
application as root:

```bash
sudo install -d -o "$USER" -g "$(id -gn)" /opt/seqdesk
bash /tmp/seqdesk-install.sh --interactive --dir /opt/seqdesk/app
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

curl -fsSLo /tmp/seqdesk-install.sh https://seqdesk.org/install.sh
SEQDESK_BIND_HOST=127.0.0.1 bash /tmp/seqdesk-install.sh --interactive \
  --dir "$HOME/seqdesk"
```

For the local-database choice, the installer reuses an already-running
PostgreSQL 14+ server, then a local Unix socket you own, then an
already-registered (non-root) Homebrew service — and only if nothing usable
exists does it `brew install postgresql@16` for the binaries and create its
**own** cluster under `$SEQDESK_PG_HOME` (default `~/.seqdesk/postgres`),
started with `pg_ctl` as your macOS login user and reachable only through a
private Unix socket (no TCP port, not registered with launchd). PostgreSQL setup
on macOS never uses `sudo`. Do not use `sudo brew services start`: PostgreSQL
refuses to run as root, and the installer will report stale root services,
ownership problems, port conflicts, and the relevant Homebrew log path with
repair commands.

Fresh installs default to the smaller core application. Add `--with-pipelines`
only when this Mac should also provision Conda/Nextflow workflows. If
`~/seqdesk` already exists, use a different directory or follow the
reconfiguration guide—do not overwrite it casually.

The PM2 prompt and the one-time display of any generated account password work
exactly as described in the Linux quick start above.

When installation finishes, verify the instance and open
<http://127.0.0.1:8000>:

```bash
npx -y seqdesk@latest doctor --dir "$HOME/seqdesk" --url http://127.0.0.1:8000
```

The same launcher caveat applies: only versions newer than 1.1.122 can check a
socket-only database, which is what a private cluster gets.

The installer records this local-only bind in the installation's root start
wrapper, so later manual or PM2 starts retain it. When the installer provisioned
its own PostgreSQL cluster, that same wrapper (`<dir>/start.sh`) also checks
`pg_ctl -D ~/.seqdesk/postgres/data status` and starts the database before
launching the app — the private cluster is deliberately not a launchd or systemd
service, so PM2 resurrects the app and the app starts its own database after a
reboot. Installs that reuse an existing PostgreSQL server get no such snippet.
An explicitly supplied `SEQDESK_BIND_HOST` can still override the stored value.
SeqDesk's bootstrap login must not be exposed to an untrusted network. See the
full [macOS installation guide](https://seqdesk.org/docs/installation/macos) for
PostgreSQL service conflicts, pipelines, PM2 startup, and troubleshooting.

### Reinstalling on a host that already ran SeqDesk

The installer picks a database before it creates one: it reuses a healthy local
PostgreSQL server, a local socket you own, or the private cluster a previous
install created under `~/.seqdesk/postgres` — and inside that server it reuses a
database named `seqdesk` when one already exists, with all of its data and user
accounts. The install
directory and the database are independent. The `Back up and replace the install
directory? (y/N)` prompt, and `--overwrite-existing` with `-y`, move the
**install directory** to `<dir>.backup.<timestamp>`; neither touches, copies, or
resets the database.

That has one consequence worth knowing before the first login attempt: bootstrap
accounts are created only when they do not exist yet. An administrator or
researcher account already present in the reused database keeps the password it
was created with. A new install does not mint or apply a new password for it, so
credentials generated by the new run do not open it — sign in with the
credentials from the earlier install instead.

The installer says so on screen. Right after the migrations, and before the
seed, it checks the target database for the very accounts it is about to create.
If it finds one, it prints

```text
  warning The selected database already contains SeqDesk accounts.
  Database             postgresql://seqdesk:********@127.0.0.1:5432/seqdesk?schema=public
  Existing admin account admin@example.com (password left unchanged)
```

then discards the password it had generated for that account (including the hash
it had already written into `<dir>/settings.json`), closes the database step with
`Existing SeqDesk database adopted: schema updated, existing accounts and data
kept`, and shows `admin@example.com / existing password (unchanged)` instead of a
password in the closing **Login** block. Absence of that warning is not a
guarantee of an empty database: the check asks only whether the bootstrap
addresses this run would create are taken, so a database whose accounts use
other addresses does not raise it — the account the run adds there really is
new, the data around it is not.

To install against a genuinely fresh database, name a database that does not
exist yet in `--database-url` (equivalently `SEQDESK_DATABASE_URL`, or
`runtime.databaseUrl` in a `--config` file, or the guided wizard's
**Existing/managed** database option). A connection string is the only way to
choose the database name; there is no separate flag for it:

```bash
bash /tmp/seqdesk-install.sh --interactive --dir "$HOME/seqdesk-fresh" \
  --database-url "postgresql://seqdesk:REPLACE_WITH_PASSWORD@127.0.0.1:5432/seqdesk_fresh?schema=public"
```

On a local server — a `127.0.0.1`/`localhost` host, or a Unix socket given as
`?host=/path/to/socket` — the installer creates the role and the named database
when it can administer that server (a socket you own, or a system PostgreSQL it
can reach with `sudo -n -u postgres psql`). On a remote or managed server, create
the empty database yourself first. The simplest safe recipe on a host that
already runs SeqDesk is to copy `runtime.databaseUrl` from the existing
`<dir>/settings.json` and change only the database name at the end of the URL.
No flag empties, drops, or recreates an existing database; removing one is a
deliberate manual step.

If the password of an existing account is lost — the case the `existing password
(unchanged)` line leaves you in — set a new one from the server shell:

```bash
cd "$HOME/seqdesk" && npx -y seqdesk@latest reset-password admin@example.com
```

It shows the account, directory, and database it is about to change and asks for
confirmation, then generates a strong password, replaces that one account's
stored hash, and prints the account (email, name, role) and the new password
once. Pass `--password 'chosen-value'` to supply your own instead, `--yes` to
skip the prompt, or `--yes --json` for machine-readable output. The password is
written to no file and no log and cannot be shown again, so copy it before
closing the terminal; nothing changes but the account named by `--email`. The
work runs inside the installed release, so the install directory needs SeqDesk
1.1.125 or newer; against an older one the command changes nothing and says so.

This is an operator command run on the host, not a self-service reset: SeqDesk
has no forgot-password email flow, and no page in the UI does this. It reads
`runtime.databaseUrl` from `<dir>/settings.json` and updates the database
directly, so the application need not be running — and it confers nothing new,
because anyone who can read `settings.json` already holds those database
credentials. To sign in without changing anything, use the credentials from the
earlier install.

### Applying a settings.json change

Editing `runtime.*` in `<dir>/settings.json` — the database URL, for example —
takes effect the next time the application process starts. The app fills those
variables from `settings.json` only when they are not already set in its
environment, and PM2 keeps the environment captured when the process was first
started, so a restart has to refresh it. This is the command the installer
prints in its closing summary:

```bash
DATABASE_URL= DIRECT_URL= SEQDESK_DATA_PATH= pm2 restart seqdesk --update-env
pm2 save
```

The empty values are the working part, not decoration. `--update-env` merges the
current environment into the copy PM2 stored; it cannot delete anything from
that copy, so a `DATABASE_URL` an earlier install froze into the process
survives a plain `pm2 restart seqdesk --update-env` even from a shell that
exports nothing. Assigning an empty value overwrites it, and `start.sh` treats
empty database and data-path variables as unset and reads `settings.json`. Confirm
with `pm2 env <id>`, using the id from `pm2 status`.

Recreating the process clears it just as well, and leaves nothing stored at all:

```bash
pm2 delete seqdesk
pm2 start "$HOME/seqdesk/start.sh" --name seqdesk
pm2 save
```

Installer flags pass straight to the downloaded script — for example
`--verbose` (or `SEQDESK_VERBOSE=1`), which prints the diagnostic detail that
otherwise goes only to the install log. The installer creates that log itself,
under an unpredictable name in `$TMPDIR` (or `/tmp` when `TMPDIR` is unset) and
readable only by you, so do not guess the path: it is printed as `Log:` in the
banner before the first step, again in the closing summary, and again if the
run fails. To choose the path yourself, set `SEQDESK_LOG=/path/install.log`
before starting:

```bash
bash /tmp/seqdesk-install.sh -y --verbose --config ./infrastructure-setup.json
```

The npm launcher remains an equivalent alternative when you prefer a global
command-line package:

```bash
npm i -g seqdesk@latest
seqdesk --interactive --dir "$HOME/seqdesk"
```

For automation, use `-y --config ./infrastructure-setup.json` and provide
explicit credentials, bind address, database URL, install directory, pipeline
choice, and process-manager choice. A piped script cannot ask interactive
questions.

Full installation, configuration, and unattended options are documented at
**[seqdesk.org/docs/installation](https://seqdesk.org/docs/installation)**.

> The downloaded script and npm launcher both use the public installer served
> from `seqdesk.org/install.sh`. Editing `scripts/install-dist.sh` in this
> repository does **not** change the live installer until the matching
> `public/install.sh` in the SeqDesk.com repository has been updated and
> deployed.

### Installer environment variables

Most install options can also be given as a `SEQDESK_*` environment variable.
The ones below govern logging, release integrity, and network behaviour — the
settings a reviewer, a throttled link, or an offline mirror usually needs. The
rest are documented at
[seqdesk.org/docs/installation](https://seqdesk.org/docs/installation):

| Variable | Default | Effect |
| --- | --- | --- |
| `SEQDESK_LOG` | a private (mode 0600) file created with `mktemp` under `$TMPDIR`, else `/tmp` | Write the install log to a path you choose instead. |
| `SEQDESK_REQUIRE_CHECKSUM` | unset — a missing checksum is a loud warning and the summary reports `Package integrity: NOT VERIFIED` | `=1` refuses to install a release whose metadata publishes no checksum. A *mismatching* checksum always aborts. |
| `SEQDESK_CURL_CONNECT_TIMEOUT` | `10` | Seconds each download attempt may spend connecting. |
| `SEQDESK_CURL_MAX_TIME` | `120` | Seconds per attempt for small fetches: release metadata, install profiles, a `--config` URL. |
| `SEQDESK_CURL_DOWNLOAD_MAX_TIME` | `1800` | Seconds per attempt for the release tarball. Raise it on a slow or throttled link. The Miniconda installer is fetched with no time ceiling, so this does not apply to it. |
| `SEQDESK_CURL_RETRIES` | `2` | Retries for a transient download failure. |
| `SEQDESK_MINICONDA_BASE_URL` | `https://repo.anaconda.com/miniconda` | Fetch Miniconda from an internal mirror instead. |
| `SEQDESK_MINICONDA_INSTALLER` | unset — the rolling `-latest-` build for the detected OS and CPU | Pin one exact installer file name, for a reproducible pipeline toolchain. |

The table describes the downloaded installer, which the npm launcher also runs.
The source installer (`scripts/install.sh`) honours `SEQDESK_LOG` — there it
turns logging on, which is otherwise off — and both `SEQDESK_MINICONDA_*`
overrides; its download timeouts are fixed and it downloads no release tarball
to checksum.

### Ways to install SeqDesk

Every path boots the same app — pick by your scenario. CI coverage exercises
installation, migration, boot, and HTTP reachability. Required jobs run on every
change; extended and private jobs count as evidence only when their own run is
green.

| Method | Command | Best for | CI coverage |
| --- | --- | --- | --- |
| Downloaded guided installer (recommended) | Download `install.sh`, then run `bash /tmp/seqdesk-install.sh --interactive --dir "$HOME/seqdesk"` | Almost everyone — no global npm package required; Node.js and npm are still prerequisites | Required Ubuntu |
| npm launcher | `npm i -g seqdesk@latest` then `seqdesk --interactive` | Equivalent launcher-based install | Required Ubuntu and macOS ARM64; private AlmaLinux |
| Linux | `SEQDESK_BIND_HOST=127.0.0.1 bash /tmp/seqdesk-install.sh --interactive --dir "$HOME/seqdesk"` | Local Linux workstation / evaluation install; prepare an owned service directory separately for production | Required Ubuntu; extended Debian, Rocky Linux, and ARM64; private AlmaLinux |
| macOS (Homebrew) | `SEQDESK_BIND_HOST=127.0.0.1 bash /tmp/seqdesk-install.sh --interactive --dir "$HOME/seqdesk"` | Local Mac workstation / evaluation installs | Required macOS ARM64; extended Intel x64 weekly/manual |
| Unattended | `seqdesk -y --config ./infrastructure-setup.json` | Fleet or scripted deployments; reapply configuration with `--reconfigure` | Required Ubuntu |
| From source | `bash scripts/install.sh` | Developers / CI building a specific branch | Ubuntu; private AlmaLinux |

The Ubuntu install workflow additionally runs the downloaded installer once
under PM2; its npm-launcher and source-install jobs start the app directly.
Every reviewer installation-matrix job that installs SeqDesk, required and
extended alike, also authenticates the seeded administrator and researcher
against the running app. The one exception is the extended native-Windows job:
it installs the launcher only, to confirm that it refuses to run and points at
WSL.

For the exact required and scheduled combinations, assertions, limitations, and
downloadable evidence, see **[Installation compatibility](./INSTALLATION_COMPATIBILITY.md)**.

## FAQ

A few common installation and setup questions. See the full
**[FAQ](https://seqdesk.org/docs/faq)** for more.

**What do I need to run SeqDesk?** Node.js `>=22.13.0 <23` or `>=24 <25`,
PostgreSQL 14+ — which you usually do **not** have to provide, because the
installer reuses a local server or creates and owns a private, socket-only
cluster under `~/.seqdesk/postgres` — and Linux or a local macOS application
environment. Pass `--database-url` only for an existing, remote, or managed
database (or when installing as root). Pipelines are optional and add a Conda
environment with Python 3.11, Java 17, Nextflow, nf-core, and supporting tools
(plus Slurm for cluster execution). See the baseline table above for storage and
installer tools.

**Does it work with SQLite?** No — SeqDesk is PostgreSQL-only. An existing SQLite
instance must stay on its last SQLite-compatible release until it is migrated to
PostgreSQL.

**How do I log in the first time?** Browse to the URL printed by the installer
and use the administrator account chosen or generated by the guided wizard. That
holds for a first install, which starts from an empty database. Unattended
installs that do not supply bootstrap users fall back to `admin@example.com` /
`admin` and `user@example.com` / `user`; **change or remove them immediately**
before allowing other users to connect.

**I installed again and the credentials from the new run are rejected.** The
install reused a database that already contained those accounts, so their
existing passwords still govern; see
[Reinstalling on a host that already ran SeqDesk](#reinstalling-on-a-host-that-already-ran-seqdesk)
for how to sign in and how to start from a genuinely fresh database.

**Nobody knows the password of the existing administrator account.** From a
shell on the server, run
`cd "$HOME/seqdesk" && npx -y seqdesk@latest reset-password admin@example.com`
(or pass `--dir` instead of changing directory).
It asks for confirmation, sets a new password for that one account, and prints
it once. There is no self-service or emailed reset: the command needs local
access to the install directory, and it grants nothing extra, because the
`settings.json` there already contains the database credentials. Details in
[Reinstalling on a host that already ran SeqDesk](#reinstalling-on-a-host-that-already-ran-seqdesk).

**The installer aborts because the directory already exists.** With `-y` it
refuses to overwrite. Use `--reconfigure` for a valid existing install. Use
`--overwrite-existing` only after verifying the exact target and available
space: it moves the entire target to `<dir>.backup.<timestamp>` and creates a
new install, so confirm that backup before removing it. Backing up and replacing
the directory leaves the database untouched — the new install reuses it, data
and accounts included.

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

This hash is for accounts the seed has not created yet. For an account that
already exists — in a development database or an installed instance — use
`seqdesk reset-password --dir <dir> --email <address>` instead of writing a hash
by hand; the seed leaves existing accounts alone.

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
