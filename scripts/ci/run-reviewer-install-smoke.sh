#!/usr/bin/env bash

set -Eeuo pipefail

WORKSPACE="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CANDIDATE_DIR="${CANDIDATE_DIR:?CANDIDATE_DIR is required}"
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
    node "$WORKSPACE/scripts/ci/write-reviewer-compatibility-report.mjs" || true

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
    --database-direct-url "$DATABASE_URL"

test -x "$INSTALL_DIR/start.sh"
test -f "$INSTALL_DIR/current/package.json"
INSTALLED_VERSION="$(node -p "require(process.argv[1]).version" "$INSTALL_DIR/current/package.json")"
if [ "$INSTALLED_VERSION" != "$CANDIDATE_VERSION" ]; then
  echo "Installed application reports $INSTALLED_VERSION, expected $CANDIDATE_VERSION" >&2
  exit 1
fi

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
