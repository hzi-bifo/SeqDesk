# Manual Install Checklist

Use this checklist when testing a SeqDesk install on a fresh Linux machine.
Prefer a disposable VM or host first.

## 1. Prepare The Machine

Required:

- Node.js 22.13.0+ on the 22.x line or Node.js 24.x (recommended)
- npm
- curl, tar, and `sha256sum` (or `shasum`) — all three are checked before
  anything is downloaded and are fatal if absent
- PostgreSQL 14+ *(optional)* — SeqDesk only needs an existing server if you
  want it to use one. When no reusable local server is found, the installer
  creates and starts its **own private, socket-only PostgreSQL cluster** under
  `$HOME/.seqdesk/postgres` (override with `SEQDESK_PG_HOME`). The installer
  appends `/socket` to that directory and caps the resulting socket directory
  at 85 characters, so `SEQDESK_PG_HOME` itself must be **78 characters or
  shorter**. This requires running the installer as a normal
  non-root user — it refuses to create a cluster owned by root. On Linux, root
  or passwordless sudo is needed only to install the `postgresql` server
  package when `initdb`/`pg_ctl` are missing.

Recommended:

- A non-root user for running SeqDesk
- A new, writable install path, for example `$HOME/seqdesk-manual`
- A fixed app port; installed releases default to `8000`

For the commands below, choose an explicit directory owned by the account that
will run SeqDesk:

```bash
export SEQDESK_INSTALL_DIR="$HOME/seqdesk-manual"
```

For a production service under `/opt`, create a parent for its non-root service
account, then use a new child as the install target. For example, when the
current account is the intended service account:

```bash
sudo install -d -o "$USER" -g "$(id -gn)" /opt/seqdesk
export SEQDESK_INSTALL_DIR="/opt/seqdesk/app"
```

The database is **optional**. If you skip the rest of this section entirely (do
not set `SEQDESK_DATABASE_URL`, do not pass `--database-url`), the installer
picks a database itself, in this order: reuse a healthy local server on
`127.0.0.1:5432`; reuse a local Unix socket you own as a PostgreSQL 14+
superuser; adopt a non-root Homebrew service (macOS); otherwise create its own
socket-only cluster under `$HOME/.seqdesk/postgres` (`SEQDESK_PG_HOME`) with a
generated password. Skip to step 2 in that case, and drop the
`--database-url`/`--database-direct-url` flags from the commands below.

Only if you want SeqDesk to use a server *you* manage, create the role and
database yourself:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE seqdesk LOGIN PASSWORD 'replace-with-password';
CREATE DATABASE seqdesk OWNER seqdesk;
SQL
```

Note that when SeqDesk adopts a pre-existing *system* PostgreSQL it administers
it via `sudo -n -u postgres psql`, so passwordless sudo is required on that
path. The installer also will not adopt a socket owned by another OS user (for
example `/var/run/postgresql` owned by `postgres`). That is **not** a failure:
it prints a warning naming the socket's real owner, skips that candidate, and
continues down the list — normally ending at its own private cluster. Pass an
explicit `--database-url` only when you want that other server to be used.

Whichever path is used, the installer reuses a database it finds rather than
creating a new one: a database named `seqdesk` on the reused server (or the one
named by `--database-url`) is attached to as-is, including data and user
accounts from an earlier install. Bootstrap accounts are then created only where
they are missing — an account that already exists keeps its current password,
and no password the run generates applies to it. For a clean test, name a
database that does not exist yet in `--database-url`; on a local host or socket
the installer creates the role and database, on a remote or managed server
create it yourself first.

Set database URLs (only for the self-managed path):

```bash
export SEQDESK_DATABASE_URL="postgresql://seqdesk:replace-with-password@127.0.0.1:5432/seqdesk?schema=public"
export SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
```

If `SEQDESK_DATABASE_DIRECT_URL` is omitted altogether, the installer sets the
direct URL equal to `SEQDESK_DATABASE_URL`.

## 2. Install Without Hosted Profile

```bash
curl -fsSLo /tmp/seqdesk-install.sh https://seqdesk.org/install.sh
bash /tmp/seqdesk-install.sh -y \
    --dir "$SEQDESK_INSTALL_DIR" \
    --port 8000 \
    --database-url "$SEQDESK_DATABASE_URL" \
    --database-direct-url "$SEQDESK_DATABASE_DIRECT_URL" \
    --without-pipelines \
    --no-pm2
```

Equivalent npm launcher path:

```bash
npm i -g seqdesk@latest
seqdesk -y \
  --dir "$SEQDESK_INSTALL_DIR" \
  --port 8000 \
  --database-url "$SEQDESK_DATABASE_URL" \
  --database-direct-url "$SEQDESK_DATABASE_DIRECT_URL" \
  --without-pipelines \
  --no-pm2
```

This checklist starts the app manually in step 4, so it opts out of PM2
explicitly. The optional pipeline toolchain is already disabled by default;
replace `--without-pipelines` with `--with-pipelines` when testing it.

## 3. Install With The Hosted CI Runner Profile

Use this only with the dummy `ci-runner` profile. The profile must contain no
real facility secrets.

```bash
export SEQDESK_CI_PROFILE_CODE="paste-profile-access-code-here"
export SEQDESK_CI_INSTALL_DIR="$HOME/seqdesk-ci-runner"

curl -fsSL https://seqdesk.org/install.sh | \
  bash -s -- -y \
    --profile ci-runner \
    --profile-code "$SEQDESK_CI_PROFILE_CODE" \
    --dir "$SEQDESK_CI_INSTALL_DIR" \
    --port 8001 \
    --database-url "$SEQDESK_DATABASE_URL" \
    --database-direct-url "$SEQDESK_DATABASE_DIRECT_URL"
```

Use a separate database name when testing both installs on the same machine.

## 4. Start The App

```bash
cd "$SEQDESK_INSTALL_DIR"
./start.sh 8000
```

`$SEQDESK_INSTALL_DIR/start.sh` is the wrapper the installer writes. If the
install provisioned its own private PostgreSQL cluster, the wrapper checks
`pg_ctl -D <SEQDESK_PG_HOME>/data status` and starts the cluster before
launching the app: the private cluster is deliberately **not** registered with
systemd or launchd, so it comes up with the app (and is resurrected by PM2
after a reboot when PM2 is used). That cluster listens on a Unix socket only
(`<SEQDESK_PG_HOME>/socket`, mode 0700) — no TCP port is ever opened, and its
`DATABASE_URL` carries a `host=<percent-encoded socket dir>` parameter.
Installs that reuse an existing server get no such snippet.

In another shell, verify the app responds:

```bash
curl -fsS http://127.0.0.1:8000/api/auth/providers
curl -fsS http://127.0.0.1:8000/api/setup/status
```

Because these commands are unattended and do not provide bootstrap users, they
seed the fallback development accounts into an empty database:

- `admin@example.com` / `admin`
- `user@example.com` / `user`

If the database was not empty and already carried those accounts, they are left
exactly as they are — their existing passwords apply, not the ones listed here.
If nobody has those passwords, set a new one for a single account with
`seqdesk reset-password` (step 8). Change or remove both immediately. SeqDesk
binds `0.0.0.0` (every interface) by
default, so the instance — and these default credentials — are reachable from
the network as soon as it starts. To keep a test install local-only, set
`SEQDESK_BIND_HOST=127.0.0.1` at install time (it is persisted in
`$SEQDESK_INSTALL_DIR/.seqdesk-bind-host`) or export it before `./start.sh`.

## 5. Run Doctor

Install or update the npm launcher:

```bash
npm i -g seqdesk@latest
```

Run file, config, PostgreSQL, and HTTP checks:

```bash
seqdesk doctor --dir "$SEQDESK_INSTALL_DIR" --url http://127.0.0.1:8000
```

For JSON output:

```bash
seqdesk doctor --dir "$SEQDESK_INSTALL_DIR" --url http://127.0.0.1:8000 --json
```

Expected result:

- `package.json`, `settings.json`, `start.sh`, `node_modules`, and
  `.next/static` are present.
- `runtime.databaseUrl` and `runtime.directUrl` are PostgreSQL URLs.
- The configured PostgreSQL TCP endpoint or Unix socket is reachable.
- `/api/auth/providers` includes credentials auth.
- `/api/setup/status` reports the database as configured.

Reading the Unix-socket form of `runtime.databaseUrl` — the
`…?schema=public&host=<socket dir>` URL a private cluster gets — requires a
launcher **newer than 1.1.122**. Version 1.1.122 ignores the `host=` parameter,
falls back to a TCP probe of `localhost:5432`, and reports
`PostgreSQL TCP … unreachable` on an install that is in fact healthy. On that
version, confirm the database by hand instead:

```bash
psql -h "${SEQDESK_PG_HOME:-$HOME/.seqdesk/postgres}/socket" \
  -d seqdesk -c 'select 1'
```

Warnings are acceptable when the app is intentionally stopped and no `--url`
is passed. Failures should be fixed before using the install for real data —
except that one known socket false positive on launcher 1.1.122.

## 6. Demo Data Check

With writable data storage configured, verify the example dataset lifecycle:

```bash
seqdesk demo-data status --dir "$SEQDESK_CI_INSTALL_DIR"
seqdesk demo-data install --dir "$SEQDESK_CI_INSTALL_DIR" --yes
seqdesk demo-data status --dir "$SEQDESK_CI_INSTALL_DIR"
```

The install should report two studies, four orders, linked samples/read rows,
and deterministic synthetic gzipped FASTQ files under the configured storage
path. These files are runnable fixtures for demos and smoke tests, not
scientific data. A second `demo-data install` is idempotent and reports the
existing fixture instead of adding duplicates.

On a database with multiple facility administrators, add
`--user-email admin@example.org`. To finish the lifecycle check, remove only
that owner's fixture:

```bash
seqdesk demo-data remove --dir "$SEQDESK_CI_INSTALL_DIR" \
  --user-email admin@example.org --yes
```

Delete linked pipeline runs through **Pipeline Runs** before this cleanup
check. SeqDesk remembers the fixture's original storage path; that path must be
available and writable before removal. If it is unavailable before cleanup
starts, database rows stay intact. If folder deletion fails after row cleanup,
SeqDesk retains the original path as pending cleanup and retries it on the next
`remove`, so the generated folder does not become undiscoverable. Support
tickets are preserved, but fixture links on those tickets are cleared and
reported.

`seqdesk install dummy_data` remains an install alias.

## 7. Hosted Profile Checks

For a `ci-runner` install, inspect
`$SEQDESK_CI_INSTALL_DIR/settings.json`
and the admin UI after startup.

Expected:

- Telemetry is enabled for the dummy profile.
- ENA settings are dummy values only.
- Dummy private pipeline settings exist only for the CI package endpoint.
- The SeqDesk.com admin profile telemetry should show a recent heartbeat after
  the installed app runs long enough to send one.

The current dummy profile telemetry interval is one hour. For a faster manual
test, temporarily use the CI forced-heartbeat script from a repo checkout or
wait for the interval.

## 8. Apply Hosted Profile Assets To An Existing Install

Use this when SeqDesk is already installed and you only need to apply hosted
profile assets such as pipeline reference databases or example datasets.

```bash
export DEV_SETUP_CODE="paste-profile-access-code-here"

seqdesk assets apply --dir /net/broker/devphil/seqdesk \
  --profile dev \
  --profile-code "$DEV_SETUP_CODE"
```

For machine-readable output:

```bash
seqdesk assets apply --dir /net/broker/devphil/seqdesk \
  --profile dev \
  --profile-code "$DEV_SETUP_CODE" \
  --json
```

Manual fallback using the installed app script:

```bash
curl -fsSL -H "Authorization: Bearer $DEV_SETUP_CODE" \
  https://seqdesk.org/api/install-profiles/dev/resolve \
  -o /tmp/seqdesk-dev-profile.json

cd /net/broker/devphil/seqdesk
node scripts/apply-install-profile-assets.mjs \
  --profile-config /tmp/seqdesk-dev-profile.json
```

For the development profile, the MetaxPath database bundle is large. Check disk
space before running the asset command.

```bash
df -h /net/broker/devphil /net/broker/devphil/pipeline /net/broker/devphil/seqdesk_data
```

## 9. Existing Installs, Migration, And Troubleshooting

Update an installed SeqDesk application through **Admin → Settings → Software
Updates**. Updating the global npm package updates only the launcher.

Use `--reconfigure` only for a directory that already contains a valid SeqDesk
installation:

```bash
seqdesk -y --reconfigure \
  --dir "$SEQDESK_INSTALL_DIR" \
  --config ./infrastructure-setup.json
```

Reconfigure mode skips migrations and seed data by default. Take a database
backup before deliberately adding `--reseed-db`. For a fresh install, rerun the
normal install command instead of using `--reconfigure`.

A repeat install on a machine that already ran SeqDesk normally lands on the
earlier database. Replacing the install directory (the `Back up and replace the
install directory? (y/N)` prompt, or `--overwrite-existing` with `-y`) moves
`<dir>` to `<dir>.backup.<timestamp>` and leaves the database alone, so the
second install starts with the first install's data and accounts. Expect the
existing accounts to keep their existing passwords, and expect the installer to
say so between the migrations and the seed:

```text
  warning The selected database already contains SeqDesk accounts.
  Database             postgresql://seqdesk:********@127.0.0.1:5432/seqdesk?schema=public
  Existing admin account admin@example.com (password left unchanged)
```

The generated password for such an account is then discarded — including the
hash already written to `settings.json` — the database step ends with `Existing
SeqDesk database adopted: schema updated, existing accounts and data kept`, and
the closing **Login** block shows `existing password (unchanged)` in place of a
password. The check covers only the bootstrap addresses this run would create,
so its silence does not certify an empty database. To retest from zero, either
point `--database-url` at a database name that is not in use, or drop the old
one deliberately (see step 9) before reinstalling.

When the checklist reaches that state and the earlier password is no longer
known — the `existing password (unchanged)` case — set a new one for that single
account instead of reinstalling:

```bash
seqdesk reset-password --dir "$SEQDESK_INSTALL_DIR" --email admin@example.com
```

Expected: a plan block (`Account`, `Directory`, `Database`), the prompt `Reset
this account's password? (y/N)`, and after confirming, one summary block naming
the account (email, name, role) and the new password, printed once. Answering
anything else cancels and changes nothing. Add `--password 'chosen-value'` to
set a value yourself, `--yes` to skip the prompt, or `--yes --json` for
machine-readable output when scripting this step (`--json` alone is rejected,
because the prompt cannot be answered in that mode). A missing address, an
unreachable database, or an installed release older than 1.1.125 — which has no
`current/scripts/reset-password.mjs` to run — exits non-zero with an explanation
rather than a password.

Verify the reset by signing in with the printed password. Then confirm what the
command deliberately does not do: it writes the password to no file and no log,
and cannot reprint it, so the terminal is the only copy. It also changes nothing
but the account named by `--email` — list the users and check that only that row
has a fresh `updatedAt`:

```bash
SEQDESK_DB_URL="$(node -e 'const u = new URL(require(process.argv[1]).runtime.databaseUrl); u.searchParams.delete("schema"); console.log(u.toString());' "$SEQDESK_INSTALL_DIR/settings.json")"
psql "$SEQDESK_DB_URL" -c 'SELECT email, role, "updatedAt" FROM "User" ORDER BY "updatedAt"'
```

The command reads `runtime.databaseUrl` from `<dir>/settings.json` and updates
the database directly, so the app need be neither running nor stopped for it,
and no restart is required afterwards. Sessions are JWT-based, so a browser that
is already signed in as that account stays signed in until its session expires;
the new password governs the next sign-in. It is an operator command that
assumes local access to the install directory; it is not a self-service or
remote reset and adds no privilege, because that same `settings.json` already
carries the database credentials.

After editing `runtime.*` in `<SEQDESK_INSTALL_DIR>/settings.json` — a different
`databaseUrl`, for example — the change applies at the next process start. The
app fills these variables from `settings.json` only when they are not already
set in its environment, and PM2 reuses the environment captured when the process
was first started:

```bash
# The empty values are what the installer prints, and what does the work:
# --update-env merges the current environment into the copy PM2 stored and
# cannot drop a variable that copy already has, so a DATABASE_URL captured at
# first start survives a plain --update-env restart. An empty value overwrites
# it, and start.sh treats empty as unset and falls back to settings.json.
DATABASE_URL= DIRECT_URL= pm2 restart seqdesk --update-env
pm2 save

# check the result with: pm2 env <id>   (id from pm2 status)
# or recreate the process, which stores no such value at all
pm2 delete seqdesk
pm2 start "$SEQDESK_INSTALL_DIR/start.sh" --name seqdesk
pm2 save
```

A manually started install picks the file up simply by stopping `./start.sh`
and running it again.

If the guided installer reports that PostgreSQL provisioning cannot use sudo,
you usually do not need sudo at all: rerun as a normal **non-root** user and
SeqDesk creates its own private cluster under `$HOME/.seqdesk/postgres`
(`SEQDESK_PG_HOME`). Running the installer as root — including
`sudo bash install.sh` — disables that path, because SeqDesk refuses to create
a PostgreSQL instance owned by root. Sudo is genuinely required only to (a)
install the server package when `initdb`/`pg_ctl` are missing
(`sudo apt-get install postgresql` / `sudo dnf install postgresql-server`), or
(b) administer a pre-existing *system* PostgreSQL that SeqDesk adopted, which
uses `sudo -n -u postgres psql` — run `sudo -v` first, or pass
`--database-url "postgresql://..."` for a database you manage. If npm global
installation fails with `EACCES`, use:

```bash
npx -y seqdesk@latest --interactive \
  --dir "$HOME/seqdesk" \
  --without-pipelines
```

Installer diagnostics go to a log the installer creates for itself: a file only
you can read, with an unpredictable name under `$TMPDIR` (or `/tmp` when
`TMPDIR` is unset). Do not guess the name — the installer prints it as `Log:`
in the banner before the first step, in the closing summary, and again if the
run fails. For a fixed, known path (the practical choice when the log is an
attachment to a bug report), export `SEQDESK_LOG` before the run:

```bash
export SEQDESK_LOG="$HOME/seqdesk-install.log"
```

Add `--verbose` (or `SEQDESK_VERBOSE=1`) to promote that diagnostic narration to
the terminal instead of only the log. The installer honours several other
environment variables that matter on a locked-down or slow test host —
`SEQDESK_REQUIRE_CHECKSUM`, the `SEQDESK_CURL_*` timeouts and retries, and the
`SEQDESK_MINICONDA_*` mirror/pin overrides; see the notes in
[README.md](./README.md) for their defaults. Check the app and PostgreSQL with:

```bash
seqdesk doctor --dir "$SEQDESK_INSTALL_DIR" \
  --url http://127.0.0.1:8000

# Only when SeqDesk adopted a pre-existing system PostgreSQL:
systemctl status postgresql
journalctl -u postgresql --no-pager -n 100

# When SeqDesk provisioned its own private cluster (no systemd unit exists):
pg_ctl -D "${SEQDESK_PG_HOME:-$HOME/.seqdesk/postgres}/data" status
tail -n 100 "${SEQDESK_PG_HOME:-$HOME/.seqdesk/postgres}/server.log"
```

See the maintained
[Linux installation guide](https://seqdesk.org/docs/installation/linux) for
distribution-specific setup, migration, PM2 startup, and common failures.

## 10. Cleanup

Stop the app process first. Cleanup destroys the selected test install and
database, so print and verify the exact targets before removing either one:

```bash
printf 'Install target: %s\n' "$SEQDESK_INSTALL_DIR"
printf 'CI install target: %s\n' "$SEQDESK_CI_INSTALL_DIR"

# These guards remove only the disposable paths used by this checklist.
test "$SEQDESK_INSTALL_DIR" = "$HOME/seqdesk-manual" && \
  rm -rf -- "$SEQDESK_INSTALL_DIR"
test "$SEQDESK_CI_INSTALL_DIR" = "$HOME/seqdesk-ci-runner" && \
  rm -rf -- "$SEQDESK_CI_INSTALL_DIR"

# If SeqDesk provisioned its own private cluster, stop and remove it; it is not
# visible to the system "postgres" user and survives removing the install dir.
pg_ctl -D "${SEQDESK_PG_HOME:-$HOME/.seqdesk/postgres}/data" stop
rm -rf -- "${SEQDESK_PG_HOME:-$HOME/.seqdesk/postgres}"

# Run these only if "seqdesk" was a dedicated disposable test database on a
# pre-existing system server.
sudo -u postgres dropdb seqdesk
sudo -u postgres dropuser seqdesk
```

Use a unique database name per test run if the same PostgreSQL server is shared.
