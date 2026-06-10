#!/usr/bin/env bash
#
# Unit test for the installer's --interactive guided wizard.
#
# Sources scripts/install-dist.sh in library-only mode (SEQDESK_INSTALL_LIB_ONLY=1)
# so the helper/wizard functions are loaded without running the installer, then
# drives run_interactive_wizard with scripted answers and asserts the captured
# configuration. read_input/read_secret are redefined to read from stdin so the
# test is deterministic regardless of whether a /dev/tty exists; db_tcp_reachable
# is stubbed so no real network is touched. Real URL parsing (postgres_url_host_port,
# via node), email/password validation, and password generation run unchanged.
#
# Exits non-zero on the first failed assertion.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck disable=SC1091
SEQDESK_INSTALL_LIB_ONLY=1 source "$REPO_ROOT/scripts/install-dist.sh"

# Deterministic, tty-independent input + controllable reachability.
read_input() { local r; IFS= read -r r || true; printf '%s' "$r"; }
read_secret() { local r; IFS= read -r r || true; printf '%s' "$r"; }
db_tcp_reachable() { [ "${TEST_DB_REACHABLE:-0}" = "1" ]; }

FAILURES=0
assert_eq() {
    # assert_eq <label> <expected> <actual>
    if [ "$2" != "$3" ]; then
        echo "FAIL: $1: expected [$2], got [$3]" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_nonempty() {
    if [ -z "$2" ]; then
        echo "FAIL: $1: expected a non-empty value" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_contains() {
    if ! grep -qF -- "$2" "$3"; then
        echo "FAIL: $1: output did not contain [$2]" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}

reset_state() {
    SEQDESK_INTERACTIVE=1
    SEQDESK_YES=""
    SEQDESK_CONFIG=""
    SEQDESK_PROFILE=""
    SEQDESK_DATABASE_URL=""
    SEQDESK_DATABASE_DIRECT_URL=""
    SEQDESK_BOOTSTRAP_ADMIN_EMAIL=""
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD=""
    SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL=""
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD=""
}

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

echo "== Case 1: managed DB (unreachable -> use anyway), validation re-prompts, accounts =="
reset_state
TEST_DB_REACHABLE=0
# Input order matches the wizard's reads:
#  db choice; bad url; valid url; "use anyway" y; direct (blank);
#  admin email; admin pw; admin pw confirm; create researcher? Y;
#  researcher email; researcher pw (blank -> generated)
run_interactive_wizard >"$OUT" 2>&1 <<'EOF'
2
not-a-url
postgresql://u:secret@db.example.com:5432/seqdesk
y

admin@lab.org
longpassword1
longpassword1
Y
r@lab.org

EOF

assert_eq "managed DATABASE_URL captured" \
    "postgresql://u:secret@db.example.com:5432/seqdesk" "$SEQDESK_DATABASE_URL"
assert_eq "admin email captured" "admin@lab.org" "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL"
assert_eq "admin password captured" "longpassword1" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD"
assert_eq "researcher email captured" "r@lab.org" "$SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL"
assert_nonempty "researcher password generated" "$SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD"
assert_contains "rejected non-postgres URL" "does not look like a postgresql" "$OUT"
assert_contains "warned on unreachable host" "Could not reach" "$OUT"

echo ""
echo "== Case 2: local DB choice, no researcher, reachable managed not used =="
reset_state
TEST_DB_REACHABLE=1
# db choice 1 (local); admin email (blank -> default); admin pw; confirm; researcher? n
run_interactive_wizard >"$OUT" 2>&1 <<'EOF'
1

password123
password123
n
EOF
assert_eq "local choice leaves DATABASE_URL empty (installer defaults later)" "" "$SEQDESK_DATABASE_URL"
assert_eq "admin email defaulted" "admin@example.com" "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL"
assert_eq "admin password captured" "password123" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD"
assert_eq "researcher skipped (no email)" "" "$SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL"

echo ""
echo "== Case 3: wizard is a no-op under -y (unattended must be untouched) =="
reset_state
SEQDESK_YES="1"
SEQDESK_BOOTSTRAP_ADMIN_EMAIL=""
run_interactive_wizard >"$OUT" 2>&1 <<'EOF'
2
postgresql://should:not@be.used:5432/db
EOF
assert_eq "no prompts consumed under -y (admin email stays empty)" "" "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL"
assert_eq "no DATABASE_URL set under -y" "" "$SEQDESK_DATABASE_URL"

echo ""
if [ "$FAILURES" -ne 0 ]; then
    echo "interactive-wizard test: $FAILURES assertion(s) failed" >&2
    exit 1
fi
echo "interactive-wizard test: all assertions passed"
