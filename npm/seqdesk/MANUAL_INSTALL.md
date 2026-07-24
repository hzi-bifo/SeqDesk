# Manual Install Checklist

Use this checklist when testing a SeqDesk install on a fresh Linux machine.
Prefer a disposable VM or host first.

## 1. Prepare The Machine

Required:

- Node.js 22.13.0+ on the 22.x line or Node.js 24.x (recommended)
- npm
- PostgreSQL 14+
- curl

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

Create a PostgreSQL role and database:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE seqdesk LOGIN PASSWORD 'replace-with-password';
CREATE DATABASE seqdesk OWNER seqdesk;
SQL
```

Set database URLs:

```bash
export SEQDESK_DATABASE_URL="postgresql://seqdesk:replace-with-password@127.0.0.1:5432/seqdesk?schema=public"
export SEQDESK_DIRECT_URL="$SEQDESK_DATABASE_URL"
```

## 2. Install Without Hosted Profile

```bash
curl -fsSLo /tmp/seqdesk-install.sh https://seqdesk.org/install.sh
bash /tmp/seqdesk-install.sh -y \
    --dir "$SEQDESK_INSTALL_DIR" \
    --port 8000 \
    --database-url "$SEQDESK_DATABASE_URL" \
    --database-direct-url "$SEQDESK_DIRECT_URL" \
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
  --database-direct-url "$SEQDESK_DIRECT_URL" \
  --without-pipelines \
  --no-pm2
```

This checklist starts the app manually in step 4, so it opts out of PM2 and the
optional pipeline toolchain explicitly. Omit those flags when testing those
features.

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
    --database-direct-url "$SEQDESK_DIRECT_URL"
```

Use a separate database name when testing both installs on the same machine.

## 4. Start The App

```bash
cd "$SEQDESK_INSTALL_DIR"
./start.sh 8000
```

In another shell, verify the app responds:

```bash
curl -fsS http://127.0.0.1:8000/api/auth/providers
curl -fsS http://127.0.0.1:8000/api/setup/status
```

Because these commands are unattended and do not provide bootstrap users, they
seed the fallback development accounts:

- `admin@example.com` / `admin`
- `user@example.com` / `user`

Change or remove both before making the instance reachable by other users.

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
- PostgreSQL TCP is reachable.
- `/api/auth/providers` includes credentials auth.
- `/api/setup/status` reports the database as configured.

Warnings are acceptable when the app is intentionally stopped and no `--url`
is passed. Failures should be fixed before using the install for real data.

## 6. Hosted Profile Checks

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

## 7. Apply Hosted Profile Assets To An Existing Install

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

## 8. Existing Installs, Migration, And Troubleshooting

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

If the guided installer reports that PostgreSQL provisioning cannot use sudo,
run `sudo -v` immediately before `seqdesk --interactive`, preinstall
PostgreSQL, or select an existing/managed database. If npm global installation
fails with `EACCES`, use:

```bash
npx -y seqdesk@latest --interactive \
  --dir "$HOME/seqdesk" \
  --without-pipelines
```

Installer diagnostics are saved under `/tmp/seqdesk-install-*.log`. Check the
app and PostgreSQL with:

```bash
seqdesk doctor --dir "$SEQDESK_INSTALL_DIR" \
  --url http://127.0.0.1:8000
systemctl status postgresql
journalctl -u postgresql --no-pager -n 100
```

See the maintained
[Linux installation guide](https://seqdesk.org/docs/installation/linux) for
distribution-specific setup, migration, PM2 startup, and common failures.

## 9. Cleanup

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

# Run these only if "seqdesk" was a dedicated disposable test database.
sudo -u postgres dropdb seqdesk
sudo -u postgres dropuser seqdesk
```

Use a unique database name per test run if the same PostgreSQL server is shared.
