#!/bin/bash
# Run from the Compute repository root. Requires local PostgreSQL and sibling labdesk-sync.
set -euo pipefail
fixture_db="writer_flow_test_$(date +%s)_$$"
fixture_log=$(mktemp /private/tmp/writer-retention-migrations.XXXXXX)
export PGCONNECT_TIMEOUT=5
fixture_port="${PGPORT:-5432}"
fixture_user="${PGUSER:-$(id -un)}"
createdb -w -h 127.0.0.1 -p "$fixture_port" -U "$fixture_user" "$fixture_db"
cleanup() {
  dropdb -w -h 127.0.0.1 -p "$fixture_port" -U "$fixture_user" "$fixture_db"
}
trap cleanup EXIT
fixture_encoded_user=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$fixture_user")
export DATABASE_URL="postgresql://$fixture_encoded_user@127.0.0.1:$fixture_port/$fixture_db?schema=public"
export DIRECT_URL="$DATABASE_URL"
export SEQDESK_FLOW_DATABASE_URL="$DATABASE_URL"
export SEQDESK_TEST_TIER=live
node scripts/run-prisma.mjs migrate deploy > "$fixture_log" 2>&1 || { tail -40 "$fixture_log"; exit 1; }
./node_modules/.bin/vitest run src/lib/integration/writer-retention.live.test.ts
