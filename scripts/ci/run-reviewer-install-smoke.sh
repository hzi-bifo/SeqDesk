#!/usr/bin/env bash

set -Eeuo pipefail

WORKSPACE="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CANDIDATE_DIR="${CANDIDATE_DIR:-${RUNNER_TEMP:-/tmp}/reviewer-candidate}"
OUTPUT_DIR="${COMPATIBILITY_DIR:-${RUNNER_TEMP:-/tmp}/reviewer-compatibility}"
INSTALL_DIR="${REVIEWER_INSTALL_DIR:-${RUNNER_TEMP:-/tmp}/seqdesk-reviewer-install}"
NPM_PREFIX="${REVIEWER_NPM_PREFIX:-${RUNNER_TEMP:-/tmp}/seqdesk-reviewer-npm-prefix}"
NPM_CACHE="${REVIEWER_NPM_CACHE:-${RUNNER_TEMP:-/tmp}/seqdesk-reviewer-npm-cache}"
MOCK_ROOT="${REVIEWER_MOCK_ROOT:-${RUNNER_TEMP:-/tmp}/seqdesk-reviewer-release-server}"
APP_PORT="${REVIEWER_APP_PORT:-18893}"
MOCK_PORT="${REVIEWER_MOCK_PORT:-18894}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-seqdesk}"
DB_PASSWORD="${DB_PASSWORD:-seqdesk}"
DB_NAME="${DB_NAME:-seqdesk_reviewer}"
PIPELINE_SMOKE="${REVIEWER_PIPELINE_SMOKE:-false}"
PIPELINE_CONDA_ENV="${REVIEWER_PIPELINE_CONDA_ENV:-seqdesk-pipelines}"

APP_PID=""
MOCK_PID=""
CURRENT_STAGE="initialize"
CANDIDATE_VERSION="unknown"

mkdir -p "$OUTPUT_DIR"

finalize() {
  local exit_code=$?
  trap - EXIT INT TERM
  set +e

  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" >/dev/null 2>&1 || true
    wait "$MOCK_PID" >/dev/null 2>&1 || true
  fi

  local result="failed"
  local report_exit=0
  if [ "$exit_code" -eq 0 ]; then
    result="passed"
    CURRENT_STAGE="complete"
  fi

  REVIEWER_OUTPUT_DIR="$OUTPUT_DIR" \
  REVIEWER_RESULT="$result" \
  REVIEWER_STAGE="$CURRENT_STAGE" \
  REVIEWER_CANDIDATE_VERSION="$CANDIDATE_VERSION" \
  REVIEWER_PIPELINE_SMOKE="$PIPELINE_SMOKE" \
  REVIEWER_PIPELINE_CONDA_ENV="$PIPELINE_CONDA_ENV" \
  DB_HOST="$DB_HOST" \
  DB_PORT="$DB_PORT" \
  DB_USER="$DB_USER" \
  DB_PASSWORD="$DB_PASSWORD" \
  DB_NAME="$DB_NAME" \
    node "$WORKSPACE/scripts/ci/write-reviewer-compatibility-report.mjs" || report_exit=$?

  if [ "$exit_code" -eq 0 ] && [ "$report_exit" -ne 0 ]; then
    exit_code="$report_exit"
  fi
  exit "$exit_code"
}
trap finalize EXIT INT TERM

CURRENT_STAGE="validate-candidate"
METADATA="$CANDIDATE_DIR/candidate.json"
test -f "$METADATA"

CANDIDATE_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$METADATA")"
RELEASE_NAME="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).releaseTarball" "$METADATA")"
LAUNCHER_NAME="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).launcherTarball" "$METADATA")"
RELEASE_TARBALL="$CANDIDATE_DIR/$RELEASE_NAME"
LAUNCHER_TARBALL="$CANDIDATE_DIR/$LAUNCHER_NAME"
INSTALLER="$CANDIDATE_DIR/install.sh"
CHECKSUMS_FILE="$CANDIDATE_DIR/SHA256SUMS"

test -f "$RELEASE_TARBALL"
test -f "$LAUNCHER_TARBALL"
test -f "$INSTALLER"
test -f "$CHECKSUMS_FILE"
test ! -e "$INSTALL_DIR"

CURRENT_STAGE="verify-candidate-checksums"
node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const path = require("node:path");
  const [sumsFile, ...artifacts] = process.argv.slice(1);
  const expected = new Map(
    fs.readFileSync(sumsFile, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64}) [ *](.+)$/i);
        if (!match) throw new Error(`Invalid checksum line: ${line}`);
        return [match[2], match[1].toLowerCase()];
      })
  );
  for (const artifact of artifacts) {
    const name = path.basename(artifact);
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(artifact))
      .digest("hex");
    if (expected.get(name) !== digest) {
      throw new Error(`Build checksum mismatch for ${name}`);
    }
    expected.delete(name);
  }
  if (expected.size !== 0) {
    throw new Error(`Unexpected checksum entries: ${[...expected.keys()].join(", ")}`);
  }
' "$CHECKSUMS_FILE" "$RELEASE_TARBALL" "$LAUNCHER_TARBALL"
touch "$OUTPUT_DIR/candidate-checksums.ok"

ACTUAL_ARCH="$(node -p 'process.arch')"
if [ -n "${REVIEWER_EXPECTED_ARCH:-}" ] && [ "$ACTUAL_ARCH" != "$REVIEWER_EXPECTED_ARCH" ]; then
  echo "Expected architecture $REVIEWER_EXPECTED_ARCH, got $ACTUAL_ARCH" >&2
  exit 1
fi
ACTUAL_NODE_VERSION="$(node -p 'process.versions.node')"
if [ -n "${REVIEWER_NODE_VERSION:-}" ]; then
  if [[ "$REVIEWER_NODE_VERSION" == *.* ]]; then
    NODE_VERSION_MATCH="$ACTUAL_NODE_VERSION"
  else
    NODE_VERSION_MATCH="${ACTUAL_NODE_VERSION%%.*}"
  fi
  if [ "$NODE_VERSION_MATCH" != "$REVIEWER_NODE_VERSION" ]; then
    echo "Expected Node $REVIEWER_NODE_VERSION, got v$ACTUAL_NODE_VERSION" >&2
    exit 1
  fi
fi

CURRENT_STAGE="validate-postgresql-boundary"
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to verify the PostgreSQL server boundary" >&2
  exit 1
fi
POSTGRES_SERVER_VERSION="$(PGCONNECT_TIMEOUT=10 PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Atqc 'SHOW server_version')"
POSTGRES_SERVER_MAJOR="${POSTGRES_SERVER_VERSION%%.*}"
if [ -n "${REVIEWER_POSTGRES_VERSION:-}" ] && [ "$POSTGRES_SERVER_MAJOR" != "$REVIEWER_POSTGRES_VERSION" ]; then
  echo "Expected PostgreSQL $REVIEWER_POSTGRES_VERSION, got $POSTGRES_SERVER_VERSION" >&2
  exit 1
fi

CHECKSUM="sha256:$(node -e "const c=require('node:crypto'),f=require('node:fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$RELEASE_TARBALL")"

CURRENT_STAGE="prepare-mock-release"
mkdir -p "$MOCK_ROOT/api" "$MOCK_ROOT/downloads"
cp "$INSTALLER" "$MOCK_ROOT/install.sh"
cp "$RELEASE_TARBALL" "$MOCK_ROOT/downloads/$RELEASE_NAME"
node "$WORKSPACE/scripts/ci/write-mock-manifest.mjs" \
  --version "$CANDIDATE_VERSION" \
  --download-url "http://127.0.0.1:${MOCK_PORT}/downloads/${RELEASE_NAME}" \
  --checksum "$CHECKSUM" \
  --out "$MOCK_ROOT/api/version" \
  --update-available false \
  --min-node 22.13.0 \
  --notes "Reviewer clean-install candidate"

node "$WORKSPACE/scripts/ci/serve-reviewer-candidate.mjs" \
  --root "$MOCK_ROOT" \
  --host 127.0.0.1 \
  --port "$MOCK_PORT" >"$OUTPUT_DIR/mock-server.log" 2>&1 &
MOCK_PID=$!

MOCK_READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${MOCK_PORT}/api/version" >/dev/null && \
     curl -fsS "http://127.0.0.1:${MOCK_PORT}/install.sh" >/dev/null; then
    MOCK_READY=1
    break
  fi
  sleep 1
done
if [ "$MOCK_READY" -ne 1 ]; then
  echo "Reviewer mock release server did not become ready" >&2
  tail -n 100 "$OUTPUT_DIR/mock-server.log" || true
  exit 1
fi
curl -fsS "http://127.0.0.1:${MOCK_PORT}/api/version" >"$OUTPUT_DIR/release-manifest.json"

CURRENT_STAGE="install-local-npm-launcher"
mkdir -p "$NPM_PREFIX" "$NPM_CACHE"
npm install --global "$LAUNCHER_TARBALL" \
  --prefix "$NPM_PREFIX" \
  --cache "$NPM_CACHE" \
  --no-audit \
  --no-fund
export PATH="$NPM_PREFIX/bin:$PATH"

LAUNCHER_VERSION="$(seqdesk --version)"
if [ "$LAUNCHER_VERSION" != "$CANDIDATE_VERSION" ]; then
  echo "Candidate launcher reports $LAUNCHER_VERSION, expected $CANDIDATE_VERSION" >&2
  exit 1
fi

CURRENT_STAGE="clean-install-and-migrate"
PIPELINE_SWITCH="--without-pipelines"
if [ "$PIPELINE_SMOKE" = "true" ]; then
  PIPELINE_SWITCH="--with-pipelines"
fi

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"
SEQDESK_API="http://127.0.0.1:${MOCK_PORT}/api" \
SEQDESK_INSTALL_URL="http://127.0.0.1:${MOCK_PORT}/install.sh" \
SEQDESK_LOG="$OUTPUT_DIR/install.log" \
SEQDESK_CONDA_ENV="$PIPELINE_CONDA_ENV" \
SEQDESK_EXEC_CONDA_ENV="$PIPELINE_CONDA_ENV" \
  seqdesk \
    -y \
    "$PIPELINE_SWITCH" \
    --no-pm2 \
    --dir "$INSTALL_DIR" \
    --port "$APP_PORT" \
    --nextauth-url "http://127.0.0.1:${APP_PORT}" \
    --database-url "$DATABASE_URL" \
    --database-direct-url "$DATABASE_URL" 2>&1 | tee "$OUTPUT_DIR/install-stdout.log"

# What the installer *prints* is part of the product: it is the only place a
# generated credential is ever shown, and the only instruction telling an
# operator how to start the app. A released installer once printed the
# credential labels with no values, and every existing check still passed
# because none of them read this output.
CURRENT_STAGE="verify-install-summary"
SUMMARY="$OUTPUT_DIR/install-stdout.log"

if ! grep -q "SUCCESS" "$SUMMARY"; then
  echo "Install summary is missing its SUCCESS marker" >&2
  exit 1
fi

# Absolute, not './start.sh' — the relative form does nothing from any other
# directory, and the summary is frequently read after the shell has moved on.
if ! grep -qF "$INSTALL_DIR/start.sh" "$SUMMARY"; then
  echo "Install summary does not name the absolute start.sh path" >&2
  exit 1
fi

# A '<label> password' line with nothing after it means the operator was handed
# an account they cannot sign in to.
if grep -qE '^[[:space:]]+[A-Za-z]+ password[[:space:]]*$' "$SUMMARY"; then
  echo "Install summary printed a credential label with no value:" >&2
  grep -nE '^[[:space:]]+[A-Za-z]+ password[[:space:]]*$' "$SUMMARY" >&2
  exit 1
fi

# Credentials must never reach the install log, which outlives the session.
if [ -f "$OUTPUT_DIR/install.log" ] && grep -qiE '^[[:space:]]+[A-Za-z]+ password[[:space:]]{2,}[^[:space:]]' "$OUTPUT_DIR/install.log"; then
  echo "A credential value was written to the install log" >&2
  exit 1
fi

test -x "$INSTALL_DIR/start.sh"
test -f "$INSTALL_DIR/current/package.json"
INSTALLED_VERSION="$(node -p "require(process.argv[1]).version" "$INSTALL_DIR/current/package.json")"
if [ "$INSTALLED_VERSION" != "$CANDIDATE_VERSION" ]; then
  echo "Installed application reports $INSTALLED_VERSION, expected $CANDIDATE_VERSION" >&2
  exit 1
fi

CURRENT_STAGE="configure-data-storage-cli"
STORAGE_DIR="$INSTALL_DIR/reviewer-sequencing-data"
test ! -e "$STORAGE_DIR"

# Exercise the launcher against the packaged worker and the real review
# database before the application starts. The second configure call proves
# that rerunning the documented command is safe, while status verifies that
# the root config and database agree on the effective path.
SEQDESK_DATA_PATH="" seqdesk storage configure "$STORAGE_DIR" \
  --dir "$INSTALL_DIR" \
  --create \
  --yes \
  --json >"$OUTPUT_DIR/storage-configure.json"
SEQDESK_DATA_PATH="" seqdesk storage configure "$STORAGE_DIR" \
  --dir "$INSTALL_DIR" \
  --yes \
  --json >"$OUTPUT_DIR/storage-configure-idempotent.json"
SEQDESK_DATA_PATH="" seqdesk storage status \
  --dir "$INSTALL_DIR" \
  --json >"$OUTPUT_DIR/storage-status.json"

node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const [firstFile, secondFile, statusFile, expectedStorage, expectedInstall] =
    process.argv.slice(1);
  const readResult = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const first = readResult(firstFile);
  const second = readResult(secondFile);
  const status = readResult(statusFile);
  const expectedPath = path.normalize(expectedStorage);
  const expectedInstallDir = path.normalize(expectedInstall);

  function assertConfigure(result, expectedCreated, label) {
    if (
      result?.ok !== true ||
      result?.action !== "configure" ||
      result?.command !== "configure" ||
      result?.path !== expectedPath ||
      result?.installDir !== expectedInstallDir ||
      result?.databaseUpdated !== true ||
      result?.readable !== true ||
      result?.searchable !== true ||
      result?.writable !== true ||
      result?.created !== expectedCreated
    ) {
      throw new Error(
        `${label} returned an unexpected result: ${JSON.stringify(result)}`
      );
    }
  }

  assertConfigure(first, true, "Initial storage configure");
  assertConfigure(second, false, "Repeated storage configure");

  if (
    status?.ok !== true ||
    status?.action !== "status" ||
    status?.command !== "status" ||
    status?.source !== "file" ||
    status?.path !== expectedPath ||
    status?.installDir !== expectedInstallDir ||
    status?.ready !== true ||
    status?.sources?.env !== null ||
    status?.sources?.file !== expectedPath ||
    status?.sources?.database !== expectedPath ||
    status?.inspection?.requestedPath !== expectedPath ||
    status?.inspection?.ready !== true ||
    status?.inspection?.readable !== true ||
    status?.inspection?.searchable !== true ||
    status?.inspection?.writable !== true
  ) {
    throw new Error(
      `Storage status did not confirm synchronized, ready storage: ${JSON.stringify(status)}`
    );
  }
' \
  "$OUTPUT_DIR/storage-configure.json" \
  "$OUTPUT_DIR/storage-configure-idempotent.json" \
  "$OUTPUT_DIR/storage-status.json" \
  "$STORAGE_DIR" \
  "$INSTALL_DIR"
touch "$OUTPUT_DIR/storage-cli.ok"

CURRENT_STAGE="demo-data-cli-lifecycle"

# Exercise the exact launcher + bundled worker + generated Prisma client from
# the clean-installed candidate. Keep the synthetic files tiny here; this gate
# verifies the product boundary, not pipeline throughput.
seqdesk demo-data status \
  --dir "$INSTALL_DIR" \
  --json >"$OUTPUT_DIR/demo-data-status-empty.json"
SEQDESK_SEED_READ_COUNT=3 SEQDESK_SEED_READ_LENGTH=25 \
  seqdesk demo-data install \
    --dir "$INSTALL_DIR" \
    --yes \
    --json >"$OUTPUT_DIR/demo-data-install.json"
seqdesk demo-data status \
  --dir "$INSTALL_DIR" \
  --json >"$OUTPUT_DIR/demo-data-status-installed.json"
seqdesk demo-data install \
  --dir "$INSTALL_DIR" \
  --yes \
  --json >"$OUTPUT_DIR/demo-data-install-idempotent.json"

node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const zlib = require("node:zlib");
  const [emptyFile, installFile, statusFile, repeatedFile, storageRoot] =
    process.argv.slice(1);
  const readResult = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const empty = readResult(emptyFile);
  const installed = readResult(installFile);
  const status = readResult(statusFile);
  const repeated = readResult(repeatedFile);

  if (
    empty?.ok !== true ||
    empty?.action !== "status" ||
    empty?.seeded !== false ||
    empty?.ordersCount !== 0 ||
    empty?.studiesCount !== 0
  ) {
    throw new Error(`Unexpected empty demo-data status: ${JSON.stringify(empty)}`);
  }
  if (
    installed?.ok !== true ||
    installed?.action !== "install" ||
    installed?.ordersCreated !== 4 ||
    installed?.samplesCreated !== 10 ||
    installed?.readsCreated !== 12 ||
    installed?.ordersCount !== 4 ||
    installed?.studiesCount !== 2 ||
    installed?.filesCreated <= 0 ||
    installed?.filesPresent !== true ||
    installed?.cleanupPending !== false
  ) {
    throw new Error(`Unexpected demo-data install result: ${JSON.stringify(installed)}`);
  }
  if (
    status?.ok !== true ||
    status?.action !== "status" ||
    status?.seeded !== true ||
    status?.ordersCount !== 4 ||
    status?.studiesCount !== 2 ||
    status?.filesPresent !== true ||
    status?.cleanupPending !== false
  ) {
    throw new Error(`Unexpected installed demo-data status: ${JSON.stringify(status)}`);
  }
  if (
    repeated?.ok !== true ||
    repeated?.action !== "install" ||
    repeated?.alreadyInstalled !== true ||
    repeated?.ordersCount !== 4 ||
    repeated?.studiesCount !== 2
  ) {
    throw new Error(`Repeated demo-data install was not idempotent: ${JSON.stringify(repeated)}`);
  }

  const fixtureDir = path.join(storageRoot, "seed-dummy", installed.owner.id);
  const files = fs.readdirSync(fixtureDir).sort();
  if (files.length !== installed.filesCreated) {
    throw new Error(
      `Demo-data worker reported ${installed.filesCreated} files, but ${files.length} exist`
    );
  }
  for (const file of files) {
    if (!file.endsWith(".fastq.gz")) {
      throw new Error(`Unexpected demo-data file: ${file}`);
    }
    const contents = zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, file)))
      .toString("utf8")
      .trimEnd()
      .split("\n");
    if (contents.length !== 12) {
      throw new Error(`${file} does not contain the expected three FASTQ records`);
    }
    for (let index = 0; index < contents.length; index += 4) {
      if (
        !contents[index].startsWith("@SIM:") ||
        contents[index + 2] !== "+" ||
        contents[index + 1].length !== 25 ||
        contents[index + 3].length !== 25
      ) {
        throw new Error(`${file} contains an invalid deterministic FASTQ record`);
      }
    }
  }
' \
  "$OUTPUT_DIR/demo-data-status-empty.json" \
  "$OUTPUT_DIR/demo-data-install.json" \
  "$OUTPUT_DIR/demo-data-status-installed.json" \
  "$OUTPUT_DIR/demo-data-install-idempotent.json" \
  "$STORAGE_DIR"

seqdesk demo-data remove \
  --dir "$INSTALL_DIR" \
  --yes \
  --json >"$OUTPUT_DIR/demo-data-remove.json"
seqdesk demo-data status \
  --dir "$INSTALL_DIR" \
  --json >"$OUTPUT_DIR/demo-data-status-removed.json"

node -e '
  const fs = require("node:fs");
  const [removeFile, statusFile] = process.argv.slice(1);
  const removed = JSON.parse(fs.readFileSync(removeFile, "utf8"));
  const status = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  if (
    removed?.ok !== true ||
    removed?.action !== "remove" ||
    removed?.ordersDeleted !== 4 ||
    removed?.filesRemoved !== true
  ) {
    throw new Error(`Unexpected demo-data removal result: ${JSON.stringify(removed)}`);
  }
  if (
    status?.ok !== true ||
    status?.action !== "status" ||
    status?.seeded !== false ||
    status?.ordersCount !== 0 ||
    status?.studiesCount !== 0 ||
    status?.filesPresent !== false ||
    status?.cleanupPending !== false
  ) {
    throw new Error(`Unexpected removed demo-data status: ${JSON.stringify(status)}`);
  }
' \
  "$OUTPUT_DIR/demo-data-remove.json" \
  "$OUTPUT_DIR/demo-data-status-removed.json"
touch "$OUTPUT_DIR/demo-data-cli.ok"

CURRENT_STAGE="boot-installed-application"
(
  cd "$INSTALL_DIR"
  exec ./start.sh "$APP_PORT"
) >"$OUTPUT_DIR/server.log" 2>&1 &
APP_PID=$!

READY=0
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/auth/providers" >"$OUTPUT_DIR/providers.json"; then
    READY=1
    break
  fi
  sleep 2
done
if [ "$READY" -ne 1 ]; then
  echo "Installed application did not become ready" >&2
  tail -n 200 "$OUTPUT_DIR/server.log" || true
  exit 1
fi

CURRENT_STAGE="verify-auth-and-setup-endpoints"
curl -fsS "http://127.0.0.1:${APP_PORT}/api/setup/status" >"$OUTPUT_DIR/setup.json"
node -e '
  const fs = require("node:fs");
  const providers = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!providers || typeof providers !== "object" || !providers.credentials) {
    throw new Error("credentials provider is missing");
  }
  const setup = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (!setup?.exists || !setup?.configured) {
    throw new Error(`database is not configured: ${JSON.stringify(setup)}`);
  }
' "$OUTPUT_DIR/providers.json" "$OUTPUT_DIR/setup.json"

CURRENT_STAGE="authenticate-seeded-users"
: >"$OUTPUT_DIR/auth-admin.log"
: >"$OUTPUT_DIR/auth-researcher.log"
node "$WORKSPACE/scripts/run-auth-e2e.mjs" \
  --base-url "http://127.0.0.1:${APP_PORT}" \
  --email "admin@example.com" \
  --password "admin" \
  --expected-role "FACILITY_ADMIN" \
  --check-path "/api/admin/users" 2>&1 | tee -a "$OUTPUT_DIR/auth-admin.log"
touch "$OUTPUT_DIR/auth-admin.ok"
node "$WORKSPACE/scripts/run-auth-e2e.mjs" \
  --base-url "http://127.0.0.1:${APP_PORT}" \
  --email "user@example.com" \
  --password "user" \
  --expected-role "RESEARCHER" 2>&1 | tee -a "$OUTPUT_DIR/auth-researcher.log"
touch "$OUTPUT_DIR/auth-researcher.ok"

if [ "$PIPELINE_SMOKE" = "true" ]; then
  CURRENT_STAGE="packaged-fastq-checksum-pipeline"
  mkdir -p "$OUTPUT_DIR/fastq-checksum-output" "${RUNNER_TEMP:-/tmp}/reviewer-nxf-home"
  (
    cd "$INSTALL_DIR/current"
    PIPELINE_CONDA_ENV="$PIPELINE_CONDA_ENV" \
    PIPELINE_E2E_TMPDIR="$OUTPUT_DIR/fastq-checksum-output" \
    NXF_HOME="${RUNNER_TEMP:-/tmp}/reviewer-nxf-home" \
      bash "$WORKSPACE/scripts/run-fastq-checksum-e2e.sh" --keep-temp
  ) 2>&1 | tee "$OUTPUT_DIR/fastq-checksum.log"
fi

CURRENT_STAGE="complete"
echo "Reviewer clean-install smoke passed for $CANDIDATE_VERSION on ${REVIEWER_LABEL:-this runner}."
