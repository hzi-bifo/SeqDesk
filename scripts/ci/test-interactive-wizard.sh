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

# Never let a test touch the real ~/.seqdesk: the preflight can provision a
# private PostgreSQL cluster, and a unit test must not create one in $HOME.
# Individual cases stub provision_private_postgres, but this is the backstop.
export SEQDESK_PG_HOME="$TEST_TMP_DIR/pg"

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
# A generated password shown during the wizard scrolls away behind the rest of
# the install — or behind a failure that means the account was never created.
assert_not_contains "generated password is not printed mid-wizard" \
    "$SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD" "$OUT"
assert_eq "generated researcher password is flagged for the final summary" \
    "true" "$SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED"
assert_eq "an operator-supplied password is not flagged as generated" \
    "false" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED"

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
echo "== Case 3b: generated macOS socket URLs remain usable by installer helpers =="
socket_url_result="$(
    (
        OS="macos"
        MACOS_POSTGRES_SOCKET_DIR="/tmp"
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        configure_postgres_urls >/dev/null
        load_postgres_url_parts
        printf 'url=%s\n' "$SEQDESK_DATABASE_URL"
        printf 'direct=%s\n' "$SEQDESK_DATABASE_DIRECT_URL"
        printf 'host=%s\n' "$PG_HOST"
        printf 'port=%s\n' "$PG_PORT"
        printf 'target=%s\n' "$(postgres_url_host_port "$SEQDESK_DATABASE_URL")"
    )
)"
assert_contains "generated URL selects the encoded /tmp socket" \
    "host=%2Ftmp" <(printf '%s\n' "$socket_url_result")
socket_database_url="$(printf '%s\n' "$socket_url_result" | sed -n 's/^url=//p')"
socket_direct_url="$(printf '%s\n' "$socket_url_result" | sed -n 's/^direct=//p')"
assert_eq "generated socket URL is also used for DIRECT_URL" \
    "$socket_database_url" "$socket_direct_url"
assert_contains "URL parser exposes the socket directory to psql helpers" \
    "host=/tmp" <(printf '%s\n' "$socket_url_result")
assert_contains "target parser classifies the Unix socket" \
    $'target=/tmp\t5432' <(printf '%s\n' "$socket_url_result")

echo ""
echo "== Case 3c: local database bootstrap uses the configured socket explicitly =="
socket_bootstrap_result="$(
    (
        SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@localhost:5432/seqdesk?schema=public&host=%2Ftmp"
        TEST_CONNECTION_CALLS=0
        postgres_connection_ready() {
            TEST_CONNECTION_CALLS=$((TEST_CONNECTION_CALLS + 1))
            [ "$TEST_CONNECTION_CALLS" -ge 2 ]
        }
        sudo_postgres_ready() { return 0; }
        find_postgres_binary() { printf '/mock/bin/psql'; }
        run_with_spinner() {
            printf 'command='
            printf ' %s' "$@"
            printf '\n'
            return 0
        }
        ensure_local_postgres_database
    )
)"
assert_contains "bootstrap passes the socket directory to psql" \
    "-h /tmp -p 5432" <(printf '%s\n' "$socket_bootstrap_result")

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
echo "== Case 5: explicit TCP URLs remain explicit when only the socket works =="
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
    "answers on its Unix socket, but not over TCP" "$OUT"
assert_contains "explicit URLs are not silently rewritten" \
    "left unchanged" "$OUT"
assert_contains "socket URL recovery is shown" \
    "host=%2Ftmp" "$OUT"
assert_contains "socket-only health points to endpoint filtering" \
    "endpoint-security tool" "$OUT"
assert_contains "socket-only health links to exact troubleshooting instructions" \
    "https://seqdesk.org/docs/installation/macos#postgresql-unix-socket-works-but-tcp-does-not" "$OUT"

alternate_socket_diagnosis="$(
    (
        PG_HOST="/var/run/postgresql"
        PG_PORT="5432"
        SEQDESK_DATABASE_URL="postgresql:///seqdesk?schema=public&host=%2Fvar%2Frun%2Fpostgresql"
        print_macos_postgres_protocol_diagnosis
    )
)"
assert_contains "an unavailable explicit socket is labeled as a socket" \
    "configured PostgreSQL Unix socket is unavailable" \
    <(printf '%s\n' "$alternate_socket_diagnosis")
assert_not_contains "an explicit socket is not mislabeled as TCP" \
    "configured PostgreSQL TCP" <(printf '%s\n' "$alternate_socket_diagnosis")

echo ""
echo "== Case 5b: fresh macOS installs automatically reuse a healthy socket =="
socket_fallback_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        MACOS_POSTGRES_SOCKET_DIR=""
        postgres_server_ready() { return 1; }
        # Only /tmp is healthy here, so the candidate search has to reach it
        # rather than stopping at the first directory it probes.
        postgres_socket_server_ready() { [ "${1:-}" = "/tmp" ]; }
        postgres_socket_owned_by_current_user() { return 0; }
        postgres_socket_admin_ready() { return 0; }
        install_postgres_packages_if_possible() {
            echo "UNEXPECTED package install"
            return 1
        }
        try_adopt_registered_brew_postgres() {
            echo "UNEXPECTED service start"
            return 1
        }
        provision_private_postgres() {
            echo "UNEXPECTED private provisioning"
            return 1
        }

        preflight_local_postgres
        configure_postgres_urls >/dev/null
        printf 'selected=%s\n' "$MACOS_POSTGRES_SOCKET_DIR"
        printf 'url=%s\n' "$SEQDESK_DATABASE_URL"
        printf 'direct=%s\n' "$SEQDESK_DATABASE_DIRECT_URL"
    )
)"
assert_contains "fresh install reports safe socket reuse" \
    "Reusing PostgreSQL via Unix socket /tmp:5432" <(printf '%s\n' "$socket_fallback_result")
assert_contains "fresh install records the selected socket" \
    "selected=/tmp" <(printf '%s\n' "$socket_fallback_result")
assert_contains "fresh install persists the socket in DATABASE_URL" \
    "host=%2Ftmp" <(printf '%s\n' "$socket_fallback_result")
assert_not_contains "healthy socket avoids another Homebrew install" \
    "UNEXPECTED package install" <(printf '%s\n' "$socket_fallback_result")
assert_not_contains "healthy socket avoids starting another PostgreSQL version" \
    "UNEXPECTED service start" <(printf '%s\n' "$socket_fallback_result")
assert_not_contains "healthy socket avoids provisioning a private instance" \
    "UNEXPECTED private provisioning" <(printf '%s\n' "$socket_fallback_result")

echo ""
echo "== Case 5c: an untrusted /tmp socket is never sent generated credentials =="
untrusted_socket_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        postgres_server_ready() { return 1; }
        postgres_socket_server_ready() { return 0; }
        postgres_socket_owned_by_current_user() { return 1; }
        postgres_socket_admin_ready() {
            echo "UNEXPECTED credentialed query"
            return 0
        }
        start_postgres_if_possible() {
            echo "UNEXPECTED service start"
            return 1
        }
        try_adopt_registered_brew_postgres() { return 1; }
        # An unusable socket must not end the install: the ladder continues to a
        # server SeqDesk does own. Stopping here broke every Linux host whose
        # system PostgreSQL listens only on /var/run/postgresql, a socket owned
        # by the postgres account rather than the installing user.
        provision_private_postgres() {
            echo "fell through to a private instance"
            return 0
        }
        if preflight_local_postgres; then
            echo "status=0"
        else
            echo "status=$?"
        fi
    )
)"
assert_contains "an unusable socket does not abort the install" \
    "status=0" <(printf '%s\n' "$untrusted_socket_result")
assert_contains "the ladder continues to a private instance" \
    "fell through to a private instance" <(printf '%s\n' "$untrusted_socket_result")
assert_contains "untrusted socket ownership is explained" \
    "SeqDesk will not send generated database credentials" <(printf '%s\n' "$untrusted_socket_result")
assert_not_contains "untrusted socket receives no credentialed query" \
    "UNEXPECTED credentialed query" <(printf '%s\n' "$untrusted_socket_result")
assert_not_contains "untrusted socket does not trigger another service" \
    "UNEXPECTED service start" <(printf '%s\n' "$untrusted_socket_result")

echo ""
echo "== Case 5d: a socket discovered after a start attempt keeps the ownership error =="
post_start_untrusted_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        TEST_SOCKET_READY_CALLS=0
        postgres_server_ready() { return 1; }
        postgres_socket_server_ready() {
            TEST_SOCKET_READY_CALLS=$((TEST_SOCKET_READY_CALLS + 1))
            [ "$TEST_SOCKET_READY_CALLS" -ge 2 ]
        }
        postgres_socket_owned_by_current_user() { return 1; }
        install_postgres_packages_if_possible() { return 0; }
        start_postgres_if_possible() { return 1; }
        if preflight_local_postgres; then
            echo "status=0"
        else
            echo "status=$?"
        fi
    )
)"
assert_contains "post-start untrusted socket stops the preflight" \
    "status=1" <(printf '%s\n' "$post_start_untrusted_result")
assert_contains "post-start untrusted socket prints the ownership diagnosis" \
    "SeqDesk will not send generated database credentials" <(printf '%s\n' "$post_start_untrusted_result")

echo ""
echo "== Case 5e: the socket admin probe is isolated and bounded =="
ADMIN_PROBE_CAPTURE="$TEST_TMP_DIR/admin-probe"
if (
    find_postgres_binary() { printf '/mock/bin/psql'; }
    run_as_postgres() {
        printf 'timeout=%s\n' "${PGCONNECT_TIMEOUT:-}" > "$ADMIN_PROBE_CAPTURE"
        printf 'arg=%s\n' "$@" >> "$ADMIN_PROBE_CAPTURE"
        printf '160000\n'
    }
    postgres_socket_admin_ready /tmp 5432
); then
    admin_probe_status=0
else
    admin_probe_status=$?
fi
assert_eq "socket admin probe accepts a PostgreSQL 16 superuser result" \
    "0" "$admin_probe_status"
assert_contains "socket admin probe has a connection timeout" \
    "timeout=5" "$ADMIN_PROBE_CAPTURE"
assert_contains "socket admin probe ignores user psql startup files" \
    "arg=-X" "$ADMIN_PROBE_CAPTURE"

echo ""
echo "== Case 5f: DIRECT_URL alone is rejected before local provisioning =="
direct_only_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL="postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk"
        install_postgres_packages_if_possible() {
            echo "UNEXPECTED package install"
            return 1
        }
        if preflight_local_postgres; then
            echo "status=0"
        else
            echo "status=$?"
        fi
    )
)"
assert_contains "DIRECT_URL-only input stops the preflight" \
    "status=1" <(printf '%s\n' "$direct_only_result")
assert_contains "DIRECT_URL-only input names the missing pair" \
    "DIRECT_URL was supplied without DATABASE_URL" <(printf '%s\n' "$direct_only_result")
assert_not_contains "DIRECT_URL-only input cannot start provisioning" \
    "UNEXPECTED package install" <(printf '%s\n' "$direct_only_result")

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
assert_eq "installed formula discovery prefers the running PostgreSQL major" \
    "postgresql@14" "$(find_installed_brew_postgres_formula)"

MACOS_ROOT_POSTGRES_WARNING_SHOWN=1
sudo_postgres_ready() { return 0; }
postgres_server_ready() { return 0; }
start_postgres_if_possible >"$OUT" 2>&1
assert_contains "already-running supported service is selected first" \
    "Starting PostgreSQL with Homebrew (postgresql@14)" "$OUT"
assert_not_contains "conflicting PostgreSQL 16 service is not started" \
    "Starting PostgreSQL with Homebrew (postgresql@16)" "$OUT"

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
SEQDESK_DATABASE_DIRECT_URL=""
sudo_postgres_ready() { return 1; }
postgres_server_ready() { return 0; }
preflight_local_postgres >"$OUT" 2>&1
assert_contains "healthy server is reused" "PostgreSQL is already available" "$OUT"

echo ""
echo "== Case 9: failed macOS preflight clearly stops before installation =="
SEQDESK_DATABASE_URL=""
SEQDESK_DATABASE_DIRECT_URL=""
sudo_postgres_ready() { return 1; }
postgres_server_ready() { return 1; }
postgres_socket_server_ready() { return 1; }
install_postgres_packages_if_possible() { return 0; }
# Every rung of the ladder is exhausted, so the failure diagnosis is reached.
try_adopt_registered_brew_postgres() { return 1; }
provision_private_postgres() { return 1; }
if preflight_local_postgres >"$OUT" 2>&1; then
    preflight_status=0
else
    preflight_status=$?
fi
assert_eq "failed preflight returns non-zero" "1" "$preflight_status"
assert_contains "preflight failure says the target was not replaced" \
    "install target was not replaced" "$OUT"
assert_contains "preflight failure gives rerun guidance" "Rerun the same command" "$OUT"
assert_contains "preflight failure offers the managed-database escape hatch" \
    "--database-url" "$OUT"
assert_contains "preflight failure warns against deleting a live PID file" \
    "Do not remove postmaster.pid while a live postgres process owns it" "$OUT"

echo ""
echo "== Case 10: managed PostgreSQL skips local Homebrew provisioning =="
SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@db.example.org:5432/seqdesk"
preflight_local_postgres >"$OUT" 2>&1
assert_eq "managed database preflight is silent" "" "$(cat "$OUT")"

echo ""
echo "== Case 11: clean macOS preflight adopts an installed-but-idle Homebrew service =="
SEQDESK_DATABASE_URL=""
SEQDESK_DATABASE_DIRECT_URL=""
TEST_SERVER_READY_CALLS=0
postgres_server_ready() {
    TEST_SERVER_READY_CALLS=$((TEST_SERVER_READY_CALLS + 1))
    [ "$TEST_SERVER_READY_CALLS" -ge 2 ]
}
postgres_socket_server_ready() { return 1; }
install_postgres_packages_if_possible() {
    echo "mock install postgresql@16"
    return 0
}
try_adopt_registered_brew_postgres() {
    echo "mock adopt registered postgresql@16"
    return 0
}
provision_private_postgres() {
    echo "UNEXPECTED private provisioning"
    return 1
}
preflight_local_postgres >"$OUT" 2>&1
assert_contains "an existing Homebrew service is adopted" "mock adopt registered postgresql@16" "$OUT"
assert_contains "adopted service reaches ready state" "PostgreSQL is ready" "$OUT"
assert_not_contains "adoptable service is not replaced by a private instance" \
    "UNEXPECTED private provisioning" "$OUT"

echo ""
echo "== Case 11b: nothing usable falls back to a private instance =="
postgres_server_ready() { return 1; }
postgres_socket_server_ready() { return 1; }
try_adopt_registered_brew_postgres() { return 1; }
provision_private_postgres() {
    echo "mock provisioned private instance"
    return 0
}
if preflight_local_postgres >"$OUT" 2>&1; then
    preflight_status=0
else
    preflight_status=$?
fi
assert_eq "private fallback succeeds" "0" "$preflight_status"
assert_contains "private instance is provisioned when nothing else works" \
    "mock provisioned private instance" "$OUT"

echo ""
echo "== Case 11c: an explicit DATABASE_URL is never replaced by a private instance =="
SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk"
SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
load_postgres_url_parts() { PG_HOST="127.0.0.1"; PG_PORT="5432"; return 0; }
provision_private_postgres() {
    echo "UNEXPECTED private provisioning"
    return 0
}
if preflight_local_postgres >"$OUT" 2>&1; then
    preflight_status=0
else
    preflight_status=$?
fi
assert_eq "unreachable explicit URL fails instead of being replaced" "1" "$preflight_status"
assert_not_contains "explicit URL never triggers private provisioning" \
    "UNEXPECTED private provisioning" "$OUT"
SEQDESK_DATABASE_URL=""
SEQDESK_DATABASE_DIRECT_URL=""

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
echo "== Case 12b: generated credentials are shown but never written to the log =="
# The install log outlives the session and is easy to paste into an issue, so a
# generated password must reach the terminal (FD 3, duplicated before output is
# teed) without being recorded in the file.
secret_log="$TEST_TMP_DIR/secret-install.log"
: > "$secret_log"
secret_terminal="$(
    bash -c "SEQDESK_INSTALL_LIB_ONLY=1 source '$REPO_ROOT/scripts/install-dist.sh'
        # Set after sourcing: the installer assigns SEQDESK_LOG_ENABLED=false
        # unconditionally at load time.
        SEQDESK_LOG_ENABLED=true
        SEQDESK_LOG='$secret_log'
        exec 3>&1
        exec >>'$secret_log' 2>&1
        print_secret_kv 'Admin password' 'SENTINEL_GENERATED_PW'"
)"
assert_contains "the generated password reaches the terminal" \
    "SENTINEL_GENERATED_PW" <(printf '%s\n' "$secret_terminal")
assert_not_contains "the generated password is not written to the install log" \
    "SENTINEL_GENERATED_PW" "$secret_log"

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
