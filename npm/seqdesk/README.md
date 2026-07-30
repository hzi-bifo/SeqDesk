# seqdesk

CLI launcher for installing, configuring, and diagnosing SeqDesk.

Requires Node.js 22.13.0+ on the 22.x line or Node.js 24.x; Node.js 24 is recommended.

## Usage

```bash
npm i -g seqdesk@latest
seqdesk --interactive
```

Pass any installer flags directly:

```bash
seqdesk -y --dir "$HOME/seqdesk"
seqdesk -y --use-pm2 --config ./infrastructure-setup.json
seqdesk -y --reconfigure --config ./infrastructure-setup.json
seqdesk -y --dir "$HOME/seqdesk" --run-doctor
```

Check an installed directory:

```bash
seqdesk doctor --dir "$HOME/seqdesk"
seqdesk doctor --dir "$HOME/seqdesk" --url http://127.0.0.1:8000
seqdesk doctor --dir "$HOME/seqdesk" --json
```

Set a new password for one account, when the old one is lost:

```bash
seqdesk reset-password --dir "$HOME/seqdesk" --email admin@example.com
seqdesk reset-password --dir "$HOME/seqdesk" --email admin@example.com --password 'chosen-value'
seqdesk reset-password --dir "$HOME/seqdesk" --email admin@example.com --yes --json
```

`--email` (`-e`) is required and names the one account to reset; there is no
bulk or all-accounts mode. `--dir` (`-d`) is the installed directory and
defaults to the current one, as with `doctor`. `--password` sets a value you
choose instead of a generated one — write `--password=<value>` if it starts with
`-`. `--yes` (`-y`) skips the confirmation prompt and is required together with
`--json`, which prints one machine-readable object instead of the human summary.

By default the command first prints what it is about to do — `Account`,
`Directory`, `Database` — and asks `Reset this account's password? (y/N)`;
anything but `y`/`yes` cancels and changes nothing. On success it prints the
account (email, name, role), the directory and database it used, and a
**New password** block holding the new password. That is the only time the
password is shown: SeqDesk stores only its bcrypt hash, the command writes the
password to no file and no log, and it cannot be displayed again — copy it
before closing the terminal. Nothing else is touched; only the row of the
account named by `--email` changes. Sessions are JWTs, so a browser already
signed in as that account stays signed in until its session expires — the new
password takes effect at the next sign-in.

Exit codes are `0` on success, `1` on a failed or cancelled reset, and `2` for a
usage error (the usage text is reprinted). Failures name the account, the
database, and what to do next — a missing address, an unreachable database, or a
`settings.json` without a usable `runtime.databaseUrl` each get their own
message rather than a stack trace. In `--json` mode a failure prints
`{"ok": false, ...}` with `error` and usually `remediation`.

The work happens inside the installed release, so the install directory must
hold SeqDesk **1.1.125 or newer** — the release that first ships
`current/scripts/reset-password.mjs`. Against an older install the command
changes nothing and says which version is needed and how to update.

This is a local operator command, not a self-service or remote reset — SeqDesk
has no forgot-password email flow, and nothing in the web UI performs this. It
needs shell access to the install directory: it reads `runtime.databaseUrl` (and
`runtime.directUrl`) from `<dir>/settings.json` — or `seqdesk.config.json`, for
an install that has one instead — and works on that database directly, including
the private cluster's `?host=/path` Unix-socket form, so the app does not have to
be running and no restart is needed afterwards. It
therefore grants no privilege that was not already held — anyone who can read
`settings.json` has the database credentials and could rewrite that row by hand.
Treat access to `<dir>` accordingly. One practical caveat: a password passed
with `--password` appears in this process's command line, so on a shared host
prefer the generated form, which never travels through an argument you typed.

Apply hosted profile assets to an existing install:

```bash
seqdesk assets apply --dir "$HOME/seqdesk" \
  --profile dev \
  --profile-code "$DEV_SETUP_CODE"
```

This reuses the installed app and applies profile-declared pipeline database
assets and seed fixtures without reinstalling SeqDesk.

Configure and verify the sequencing-data directory from the server shell:

```bash
seqdesk storage configure "$HOME/seqdesk/data"
seqdesk storage status
```

Pass an existing absolute directory. Add `--create` only when the chosen
directory is intentionally new; SeqDesk will not silently create a missing
network mount or mistyped path. The command synchronizes the active
`settings.json` value with `SiteSettings.dataBasePath`. Use `--yes --json` for
automation; `storage status` exits non-zero until the directory is ready. A
service-level `SEQDESK_DATA_PATH` override must be changed in the service
environment instead.

Discover, install, and finish setting up pipelines from the server shell:

```bash
seqdesk pipelines list
seqdesk pipelines list --catalog order
seqdesk pipelines list --catalog study
seqdesk pipelines install simulate-reads --runtime
seqdesk pipelines status simulate-reads
```

The plural `seqdesk pipelines` form is the primary management interface. It
shows whether a package is available, bundled, or installed; whether setup is
ready; whether it is active; and the next required action. Installation is
idempotent. A ready pipeline is enabled automatically, while a pipeline with
missing runtime tools, configuration, database assets, or storage paths remains
disabled with concrete setup guidance. Database assets are never downloaded
without an operator choosing or linking them in the Admin interface.

The installer writes a user-level wrapper to `~/.local/bin/seqdesk` and records
the default installation, so `--dir` is normally optional. It prints a `PATH`
command when `~/.local/bin` is not already available in the current shell.

Run an installed pipeline and inspect its runs:

```bash
seqdesk pipeline run metaxpath --dir "$HOME/seqdesk" --study <study-id> --watch
seqdesk pipeline run fastq-checksum --dir "$HOME/seqdesk" --order <order-id> --samples id1,id2 --json
seqdesk pipeline status <run-id> --dir "$HOME/seqdesk" --watch
seqdesk pipeline logs <run-id> --dir "$HOME/seqdesk" --type error --tail 200
seqdesk pipeline outputs <run-id> --dir "$HOME/seqdesk" --json
seqdesk pipeline debug <run-id> --dir "$HOME/seqdesk" --format text --out debug.txt
seqdesk pipeline cancel <run-id> --dir "$HOME/seqdesk"
```

Pipeline commands run locally against the installed app database and use the
same SeqDesk run records and launcher services as the web UI. They do not
require browser login; shell access to `--dir` is treated as operator access.
By default the first `FACILITY_ADMIN` user is used for attribution, or pass
`--user-email admin@example.org` when starting a run.

`simulate-reads` is an order-scoped test utility, not scientific data. Its
default configuration replaces existing linked reads, so use it only with a
dedicated demo order. See the
[pipeline installation guide](https://seqdesk.org/docs/pipelines/installing-pipelines)
for the safe walkthrough and all management options.

For a full manual test flow, see [MANUAL_INSTALL.md](./MANUAL_INSTALL.md).

## Notes

- The npm launcher remains a supported alternative to downloading
  `https://seqdesk.org/install.sh` directly.
- Fresh installs provision the core application only. Pass `--with-pipelines`
  to add the optional Conda/Nextflow runtime.
- You normally do not need to set up PostgreSQL yourself. The installer reuses a
  healthy local server or a Unix socket it can administer when it finds one;
  otherwise it creates its own private, socket-only cluster under
  `$HOME/.seqdesk/postgres` (override with `SEQDESK_PG_HOME`, which must be 78
  characters or shorter: `/socket` is appended and the resulting socket
  directory is capped at 85 characters). That cluster opens no TCP port and is
  not registered with systemd or launchd, so the install directory's `start.sh`
  starts it before the app. Run the installer as your normal non-root user: it
  refuses to create a cluster owned by root. Pass `--database-url` only for a
  database you manage yourself; an explicit URL is never silently retargeted.
  A local socket owned by a different OS user (for example
  `/var/run/postgresql`) is skipped with a warning rather than treated as an
  error — the installer simply moves on and provisions its own cluster.
- A reused server also means a reused database. When a database named `seqdesk`
  already exists there — typically from an earlier install — the new install
  attaches to it, data and user accounts included, and only creates the
  bootstrap accounts that are missing. An administrator or researcher account
  that already exists keeps its current password; the run does not rewrite it,
  and a password that run generates does not apply to it, so log in with the
  credentials from the earlier install — or, if nobody still has them, set a new
  password for that one account with `seqdesk reset-password --dir <dir> --email
  <address>`. To
  install against an empty database, pass `--database-url` naming a database
  that does not exist yet (on a local host or socket the installer creates the
  role and database; on a remote or managed server create it first). Replacing
  the install directory is unrelated: the `Back up and replace the install
  directory? (y/N)` prompt and `--overwrite-existing` move `<dir>` to
  `<dir>.backup.<timestamp>` and never touch the database. When the run finds
  one of its bootstrap accounts already in the database it says so during the
  database step — `The selected database already contains SeqDesk accounts.`,
  then one `Existing <role> account` line per account, each ending in
  `(password left unchanged)` — and prints `existing password (unchanged)` for
  it in the closing **Login** block instead of a password.
- Editing `runtime.*` in `<dir>/settings.json` applies at the next process
  start. The app only fills environment variables that are not already set, and
  PM2 reuses the environment it captured when the process was first started, so
  restart with
  `DATABASE_URL= DIRECT_URL= SEQDESK_DATA_PATH= pm2 restart seqdesk --update-env`,
  which is what the installer prints. The empty values matter: `--update-env`
  merges the current environment into the copy PM2 stored and cannot delete
  anything from it, so a `DATABASE_URL` captured at first start survives a plain
  `--update-env` restart; an empty value overwrites it and `start.sh` then reads
  `settings.json`. Check with `pm2 env <id>`, or sidestep it entirely with `pm2
  delete seqdesk`, `pm2 start "<dir>/start.sh" --name seqdesk`, `pm2 save`.
- `$HOME/seqdesk` is used above as a writable evaluation path. For a production
  system location, have an administrator prepare a parent owned by the
  non-root SeqDesk service account, then install into a new child directory.
- The launcher downloads `https://seqdesk.org/install.sh` over HTTPS and
  executes it with `bash` internally. Users normally do not need to call the
  shell installer directly.
- Publishing this npm package does not update the public curl installer. Changes
  to the shell installer become visible at `https://seqdesk.org/install.sh`
  only after the SeqDesk.com `public/install.sh` file is updated and deployed.
- By default it sets `SEQDESK_VERSION` to this package version (unless already set).
- The installer creates its own log: a file only you can read, with an
  unpredictable name under `$TMPDIR` (or `/tmp` when `TMPDIR` is unset). Do not
  guess the path — the installer prints it as `Log:` in the banner before the
  first step, in the closing summary, and again if the run fails. Set
  `SEQDESK_LOG=/path/install.log` beforehand to choose the path yourself.
- Other environment variables worth knowing, all read by the installer this
  launcher runs:
  - `SEQDESK_REQUIRE_CHECKSUM=1` refuses to install a release whose metadata
    publishes no checksum. Unset, a missing checksum is a loud warning and the
    closing summary reports `Package integrity: NOT VERIFIED`; a *mismatching*
    checksum always aborts.
  - `SEQDESK_CURL_CONNECT_TIMEOUT` (default `10`), `SEQDESK_CURL_MAX_TIME`
    (`120`, for release metadata, install profiles, and a `--config` URL),
    `SEQDESK_CURL_DOWNLOAD_MAX_TIME` (`1800`, for the release tarball), and
    `SEQDESK_CURL_RETRIES` (`2`) — all in seconds per attempt. Raise them on a
    slow or proxied link. The Miniconda installer is fetched with no time
    ceiling, so no `MAX_TIME` applies to it.
  - `SEQDESK_MINICONDA_BASE_URL` (default
    `https://repo.anaconda.com/miniconda`) and `SEQDESK_MINICONDA_INSTALLER`
    (unset, meaning the rolling `-latest-` build for the detected OS and CPU)
    point Miniconda at an internal mirror or pin one exact installer file name.
- Interactive installs show a compact spinner for long-running work; command
  output stays in the install log. Pass `--verbose` (or set `SEQDESK_VERBOSE=1`)
  to mirror the diagnostic detail to the terminal.
- `seqdesk doctor` runs locally and does not download the installer. It checks
  install files, PostgreSQL reachability, runtime config, auth providers, and
  setup status when the app URL is known. Reachability over a Unix socket — the
  `host=<socket dir>` form a private cluster's `DATABASE_URL` uses — is
  understood only in versions **newer than 1.1.122**; 1.1.122 falls back to a
  TCP probe of the URL's host name and reports a false
  `PostgreSQL TCP … unreachable` for such an install.
- `seqdesk reset-password` also runs locally and downloads nothing. It reads the
  database URL from `<dir>/settings.json` — including the private cluster's
  `host=<socket dir>` Unix-socket form, passed through untouched — and dispatches
  to the installed release's `current/scripts/reset-password.mjs` with
  `DATABASE_URL`/`DIRECT_URL` in its environment, so the new hash is produced by
  the same Prisma client and bcrypt cost the application's own login path
  verifies against. The launcher itself has no dependencies and never opens the
  database. It is a one-account, one-shot command: no bulk mode, no flag that
  resets every bootstrap account, and it prompts for confirmation unless `--yes`
  is passed.
- `seqdesk assets apply` runs locally against an existing install. It resolves
  hosted install profiles into a temporary file, calls the installed
  `scripts/apply-install-profile-assets.mjs` script, and removes the temporary
  profile file after the command exits.
- `seqdesk pipeline ...` dispatches to the installed
  `scripts/pipeline-cli.js` script so CLI-started runs follow the same local
  server configuration, pipeline packages, execution policy, and compatibility
  guards as UI-started runs.
- Successful installs print a matching `seqdesk doctor` command. Pass
  `--run-doctor` to run it automatically when the CLI is available.

## Publishing

The package version is auto-synced from the root `package.json` during publish
(`prepublishOnly`), so you only bump the app version once.

```bash
cd npm/seqdesk
npm publish --access public
```
