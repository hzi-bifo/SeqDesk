# Manual Install Checklist

Use this checklist when testing a SeqDesk install on a fresh Linux machine.
Prefer a disposable VM or host first.

## 1. Prepare The Machine

Required:

- Node.js 20+
- npm
- PostgreSQL 14+
- curl

Recommended:

- A non-root user for running SeqDesk
- A fixed install path, for example `/opt/seqdesk`
- A fixed app port, for example `3000` or `8000`

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
curl -fsSL https://www.seqdesk.com/install.sh | \
  bash -s -- -y \
    --dir /opt/seqdesk \
    --port 8000 \
    --database-url "$SEQDESK_DATABASE_URL" \
    --database-direct-url "$SEQDESK_DIRECT_URL"
```

Equivalent npm launcher path:

```bash
npm i -g seqdesk
seqdesk -y \
  --dir /opt/seqdesk \
  --port 8000 \
  --database-url "$SEQDESK_DATABASE_URL" \
  --database-direct-url "$SEQDESK_DIRECT_URL"
```

## 3. Install With The Hosted CI Runner Profile

Use this only with the dummy `ci-runner` profile. The profile must contain no
real facility secrets.

```bash
export SEQDESK_CI_PROFILE_CODE="paste-profile-access-code-here"

curl -fsSL https://www.seqdesk.com/install.sh | \
  bash -s -- -y \
    --profile ci-runner \
    --profile-code "$SEQDESK_CI_PROFILE_CODE" \
    --dir /opt/seqdesk-ci-runner \
    --port 8001 \
    --database-url "$SEQDESK_DATABASE_URL" \
    --database-direct-url "$SEQDESK_DIRECT_URL"
```

Use a separate database name when testing both installs on the same machine.

## 4. Start The App

```bash
cd /opt/seqdesk
./start.sh 8000
```

In another shell, verify the app responds:

```bash
curl -fsS http://127.0.0.1:8000/api/auth/providers
curl -fsS http://127.0.0.1:8000/api/setup/status
```

Default seeded users:

- `admin@example.com` / `admin`
- `user@example.com` / `user`

## 5. Run Doctor

Install or update the npm launcher:

```bash
npm i -g seqdesk
```

Run file, config, PostgreSQL, and HTTP checks:

```bash
seqdesk doctor --dir /opt/seqdesk --url http://127.0.0.1:8000
```

For JSON output:

```bash
seqdesk doctor --dir /opt/seqdesk --url http://127.0.0.1:8000 --json
```

Expected result:

- `package.json`, `seqdesk.config.json`, `start.sh`, `node_modules`, and
  `.next/static` are present.
- `runtime.databaseUrl` and `runtime.directUrl` are PostgreSQL URLs.
- PostgreSQL TCP is reachable.
- `/api/auth/providers` includes credentials auth.
- `/api/setup/status` reports the database as configured.

Warnings are acceptable when the app is intentionally stopped and no `--url`
is passed. Failures should be fixed before using the install for real data.

## 6. Hosted Profile Checks

For a `ci-runner` install, inspect `/opt/seqdesk-ci-runner/seqdesk.config.json`
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
  https://www.seqdesk.com/api/install-profiles/dev/resolve \
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

## 8. Cleanup

Stop the app process, then remove the install directory and test database:

```bash
sudo rm -rf /opt/seqdesk /opt/seqdesk-ci-runner
sudo -u postgres dropdb seqdesk
sudo -u postgres dropuser seqdesk
```

Use a unique database name per test run if the same PostgreSQL server is shared.
