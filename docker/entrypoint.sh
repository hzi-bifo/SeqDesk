#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${NEXTAUTH_SECRET:?NEXTAUTH_SECRET is required}"
: "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD:?Bootstrap password is required}"
# Never reset the database. Existing accounts retain their passwords.
node scripts/run-prisma.mjs migrate deploy
node prisma/seed.mjs
exec "$@"
