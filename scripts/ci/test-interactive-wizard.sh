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
assert_not_contains() {
    if grep -qF -- "$2" "$3"; then
        echo "FAIL: $1: output unexpectedly contained [$2]" >&2
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
    SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED=""
}

OUT="$(mktemp)"
TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -f "$OUT"; rm -rf "$TEST_TMP_DIR"' EXIT

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
assert_eq "researcher disabled" "0" "$SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED"

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
echo "== Case 4: macOS PostgreSQL recovery never recommends sudo Homebrew startup =="
OS="macos"
DISTRO="macos"
SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk"
SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
SEQDESK_DIR="/tmp/seqdesk-test-install"
load_postgres_url_parts() { return 0; }
print_postgres_setup_instructions >"$OUT" 2>&1
assert_contains "macOS recovery names normal login user" "normal macOS login user" "$OUT"
assert_contains "macOS recovery explicitly rejects sudo" "do not use sudo" "$OUT"
assert_not_contains "macOS recovery does not invoke launcher with sudo" "sudo env SEQDESK_DATABASE_URL" "$OUT"

echo ""
echo "== Case 5: an open port does not override a failed PostgreSQL protocol check =="
FAKE_PG_ISREADY="$TEST_TMP_DIR/pg_isready"
cat > "$FAKE_PG_ISREADY" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "-h" ] && [ "${2:-}" = "/tmp" ]; then
    exit 0
fi
exit 2
EOF
chmod +x "$FAKE_PG_ISREADY"
find_postgres_binary() { printf '%s' "$FAKE_PG_ISREADY"; }
TEST_DB_REACHABLE=1
if postgres_server_ready; then
    ready_status=0
else
    ready_status=$?
fi
assert_eq "failed pg_isready remains a preflight failure" "2" "$ready_status"
print_macos_postgres_protocol_diagnosis >"$OUT" 2>&1
assert_contains "socket-only health is classified explicitly" \
    "the Unix socket works, but TCP does not" "$OUT"
assert_contains "socket-only health explains why SeqDesk stops" \
    "SeqDesk uses a TCP PostgreSQL URL" "$OUT"
assert_contains "socket-only health points to endpoint filtering" \
    "endpoint-security tool" "$OUT"
assert_contains "socket-only health links to exact troubleshooting instructions" \
    "https://seqdesk.org/docs/installation/macos#postgresql-unix-socket-works-but-tcp-does-not" "$OUT"

echo ""
echo "== Case 6: stale root service points to the healthy PostgreSQL 14 service =="
brew() {
    if [ "${1:-}" = "--prefix" ]; then
        printf '%s' "$TEST_TMP_DIR/brew"
        return 0
    fi
    if [ "${1:-}" = "services" ] && [ "${2:-}" = "list" ]; then
        printf 'Name Status User File\npostgresql@14 started tester test.plist\npostgresql@16 error 78 root.plist\n'
        return 0
    fi
    if [ "${1:-}" = "list" ] && [ "${2:-}" = "--versions" ]; then
        [ "${3:-}" = "postgresql@16" ] || [ "${3:-}" = "postgresql@14" ]
        return $?
    fi
    if [ "${1:-}" = "services" ] && [ "${2:-}" = "start" ] && [ "${3:-}" = "postgresql@14" ]; then
        return 0
    fi
    return 1
}
macos_brew_service_runs_as_root() { [ "$1" = "postgresql@16" ]; }
MACOS_ROOT_POSTGRES_WARNING_SHOWN=""
warn_macos_root_postgres_services >"$OUT" 2>&1
assert_contains "root service cause is explicit" "registered to run as root" "$OUT"
assert_contains "healthy supported service is reused" "'postgresql@14' is already running" "$OUT"
assert_not_contains "conflicting PostgreSQL 16 start is not recommended" "brew services start postgresql@16" "$OUT"

MACOS_ROOT_POSTGRES_WARNING_SHOWN=1
sudo_postgres_ready() { return 0; }
postgres_server_ready() { return 0; }
start_postgres_if_possible >"$OUT" 2>&1
assert_contains "root service is skipped" "Skipping misconfigured root service postgresql@16" "$OUT"
assert_contains "healthy service is selected" "Starting PostgreSQL with Homebrew (postgresql@14)" "$OUT"
assert_not_contains "root service is not started" "Starting PostgreSQL with Homebrew (postgresql@16)" "$OUT"

echo ""
echo "== Case 7: historical PostgreSQL errors are not presented as current =="
mkdir -p "$TEST_TMP_DIR/brew/var/log"
printf '2000-01-01 FATAL: lock file "postmaster.pid" already exists\n' \
    > "$TEST_TMP_DIR/brew/var/log/postgresql@14.log"
touch -t 200001010000 "$TEST_TMP_DIR/brew/var/log/postgresql@14.log"
print_macos_brew_postgres_failure postgresql@14 >"$OUT" 2>&1
assert_contains "historical log errors are identified and omitted" \
    "historical errors omitted" "$OUT"
assert_not_contains "historical lock error is not presented as current" \
    "lock file \"postmaster.pid\" already exists" "$OUT"

echo ""
echo "== Case 8: macOS preflight reuses a healthy local server before download =="
SEQDESK_DATABASE_URL=""
sudo_postgres_ready() { return 1; }
postgres_server_ready() { return 0; }
preflight_macos_local_postgres >"$OUT" 2>&1
assert_contains "healthy server is reused" "PostgreSQL is already available" "$OUT"

echo ""
echo "== Case 9: failed macOS preflight clearly stops before installation =="
sudo_postgres_ready() { return 1; }
postgres_server_ready() { return 1; }
install_postgres_packages_if_possible() { return 0; }
start_postgres_if_possible() { return 1; }
if preflight_macos_local_postgres >"$OUT" 2>&1; then
    preflight_status=0
else
    preflight_status=$?
fi
assert_eq "failed preflight returns non-zero" "1" "$preflight_status"
assert_contains "preflight failure says the target was not replaced" \
    "install target was not replaced" "$OUT"
assert_contains "preflight failure gives rerun guidance" "rerun the same SeqDesk command" "$OUT"
assert_contains "preflight failure warns against deleting a live PID file" \
    "Do not remove postmaster.pid while a live postgres process owns it" "$OUT"
assert_contains "preflight requires PostgreSQL protocol health, not only a listener" \
    "An open TCP port alone is not enough" "$OUT"

echo ""
echo "== Case 10: managed PostgreSQL skips local Homebrew provisioning =="
SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@db.example.org:5432/seqdesk"
preflight_macos_local_postgres >"$OUT" 2>&1
assert_eq "managed database preflight is silent" "" "$(cat "$OUT")"

echo ""
echo "== Case 11: clean macOS preflight provisions PostgreSQL automatically =="
SEQDESK_DATABASE_URL=""
TEST_SERVER_READY_CALLS=0
postgres_server_ready() {
    TEST_SERVER_READY_CALLS=$((TEST_SERVER_READY_CALLS + 1))
    [ "$TEST_SERVER_READY_CALLS" -ge 2 ]
}
install_postgres_packages_if_possible() {
    echo "mock install postgresql@16"
    return 0
}
start_postgres_if_possible() {
    echo "mock start postgresql@16"
    return 0
}
preflight_macos_local_postgres >"$OUT" 2>&1
assert_contains "clean preflight installs PostgreSQL" "mock install postgresql@16" "$OUT"
assert_contains "clean preflight starts PostgreSQL" "mock start postgresql@16" "$OUT"
assert_contains "clean preflight reaches ready state" "PostgreSQL is ready" "$OUT"

echo ""
echo "== Case 12: local PostgreSQL recovery never prints database credentials =="
OS="linux"
DISTRO="debian"
SENTINEL_DB_PASSWORD="SEQDESK_SENTINEL_DB_PASSWORD_DO_NOT_PRINT"
SEQDESK_DATABASE_URL="postgresql://seqdesk:${SENTINEL_DB_PASSWORD}@127.0.0.1:5432/seqdesk"
SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
SEQDESK_DIR="$TEST_TMP_DIR/existing-install"
mkdir -p "$SEQDESK_DIR"
printf '{}\n' >"$SEQDESK_DIR/settings.json"
load_postgres_url_parts() { return 0; }
print_postgres_setup_instructions >"$OUT" 2>&1
assert_contains "existing install reuses protected config" \
    "sudo npx -y seqdesk@latest -y --prepare-postgres --dir" "$OUT"
assert_contains "existing install keeps reconfigure recovery" \
    "npx -y seqdesk@latest -y --reconfigure --reseed-db --dir" "$OUT"
assert_not_contains "existing install recovery hides database password" \
    "$SENTINEL_DB_PASSWORD" "$OUT"

SEQDESK_DIR="$TEST_TMP_DIR/fresh-install"
print_postgres_setup_instructions >"$OUT" 2>&1
assert_contains "fresh-host recovery explains missing installed settings" \
    "expected when --prepare-postgres is run before a fresh install" "$OUT"
assert_contains "fresh-host recovery preserves private-shell guidance" \
    "SEQDESK_DATABASE_URL set in your private shell" "$OUT"
assert_not_contains "fresh-host recovery hides database password" \
    "$SENTINEL_DB_PASSWORD" "$OUT"

echo ""
echo "== Case 13: installer failures expose stable troubleshooting URLs =="
print_troubleshooting_url >"$OUT" 2>&1
assert_contains "generic failures link to the common-problems index" \
    "https://seqdesk.org/docs/installation/common-problems" "$OUT"
print_troubleshooting_url \
    "https://seqdesk.org/docs/installation/prerequisites#what-the-installer-checks" \
    >"$OUT" 2>&1
assert_contains "classified failures can link to exact recovery guidance" \
    "https://seqdesk.org/docs/installation/prerequisites#what-the-installer-checks" "$OUT"

echo ""
if [ "$FAILURES" -ne 0 ]; then
    echo "interactive-wizard test: $FAILURES assertion(s) failed" >&2
    exit 1
fi
echo "interactive-wizard test: all assertions passed"
