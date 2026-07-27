#!/usr/bin/env bash
#
# Register every password an installer run printed as a masked value in the
# GitHub Actions log.
#
# The install summary is the one place a generated credential is shown, so a
# job that captures it holds plaintext passwords in a file it may well need to
# print when something fails. Masking them first means a failing step can dump
# the whole summary for diagnosis without the values ever appearing in the log.
#
# Usage: bash scripts/ci/mask-printed-credentials.sh <installer-summary-file>
#
# Outside GitHub Actions the ::add-mask:: lines are inert, so this is safe to
# run anywhere.

set -euo pipefail

SUMMARY="${1:-}"
if [ -z "$SUMMARY" ]; then
    echo "usage: mask-printed-credentials.sh <installer-summary-file>" >&2
    exit 2
fi
if [ ! -f "$SUMMARY" ]; then
    exit 0
fi

# print_kv pads the label to 20 columns, so "  Admin password" is followed by
# at least two spaces and then the value: "  Admin password       <value>".
sed -n 's/^[[:space:]]\{1,\}[A-Za-z]\{1,\} password[[:space:]]\{2,\}\(.*\)$/\1/p' "$SUMMARY" \
    | tr -d '\r' \
    | while IFS= read -r secret; do
        [ -n "$secret" ] || continue
        printf '::add-mask::%s\n' "$secret"
    done
