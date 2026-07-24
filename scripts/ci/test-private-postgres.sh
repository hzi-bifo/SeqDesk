#!/usr/bin/env bash
#
# Tests for the SeqDesk-managed ("private") PostgreSQL instance.
#
# Sources scripts/install-dist.sh in library-only mode (SEQDESK_INSTALL_LIB_ONLY=1)
# and exercises the real provisioning path against a throwaway data directory.
# Nothing outside the temp directory is touched: SEQDESK_PG_HOME is redirected,
# the cluster listens on a Unix socket only, and the server is stopped on exit.
#
# The provisioning cases need PostgreSQL server programs (initdb, pg_ctl). When
# they are absent the suite reports the cases as skipped rather than failing, so
# it stays useful on a client-tools-only runner.
#
# Exits non-zero on the first failed assertion.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

TEST_TMP_DIR="$(mktemp -d)"
# Short by construction: a Unix socket path has ~104 usable bytes on macOS, and
# mktemp -d under $TMPDIR can already be long.
SHORT_PG_HOME="/tmp/seqdesk-pgtest-$$"
export SEQDESK_PG_HOME="$SHORT_PG_HOME"

cleanup() {
    local pg_ctl_bin
    pg_ctl_bin="$(command -v pg_ctl 2>/dev/null || true)"
    if [ -n "$pg_ctl_bin" ] && [ -s "$SHORT_PG_HOME/data/PG_VERSION" ]; then
        LC_ALL=C "$pg_ctl_bin" -D "$SHORT_PG_HOME/data" -m immediate -w stop >/dev/null 2>&1 || true
    fi
    rm -rf "$TEST_TMP_DIR" "$SHORT_PG_HOME"
}
trap cleanup EXIT

# shellcheck disable=SC1091
SEQDESK_INSTALL_LIB_ONLY=1 source "$REPO_ROOT/scripts/install-dist.sh"

# Sourcing the installer enables `set -e`; the assertions below deliberately run
# commands that return non-zero.
set +e

OS="macos"
DISTRO="macos"

FAILURES=0
SKIPPED=0
assert_eq() {
    if [ "$2" != "$3" ]; then
        echo "FAIL: $1: expected [$2], got [$3]" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_contains() {
    if ! printf '%s' "$2" | grep -qF -- "$3"; then
        echo "FAIL: $1: [$2] did not contain [$3]" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_ok() {
    if [ "$2" -ne 0 ]; then
        echo "FAIL: $1: expected success, got exit $2" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}

echo "== Case 1: path helpers honour SEQDESK_PG_HOME =="
assert_eq "root follows SEQDESK_PG_HOME" "$SHORT_PG_HOME" "$(private_postgres_root)"
assert_eq "data directory is under the root" "$SHORT_PG_HOME/data" "$(private_postgres_data_dir)"
assert_eq "socket directory is under the root" "$SHORT_PG_HOME/socket" "$(private_postgres_socket_dir)"

echo ""
echo "== Case 2: over-long socket paths are refused, not truncated =="
# A Unix socket path that exceeds the platform limit fails deep inside
# PostgreSQL with an opaque error, so the installer has to catch it up front.
long_dir="/tmp/$(printf 'x%.0s' $(seq 1 120))"
private_postgres_socket_dir_usable "$long_dir"
assert_eq "an over-long socket directory is rejected" "1" "$?"
private_postgres_socket_dir_usable "$SHORT_PG_HOME/socket"
assert_eq "a short socket directory is accepted" "0" "$?"

long_home_output="$(SEQDESK_PG_HOME="$long_dir" provision_private_postgres 2>&1)"
assert_contains "the over-long path is named in the error" "$long_home_output" "too long"
assert_contains "the error suggests SEQDESK_PG_HOME" "$long_home_output" "SEQDESK_PG_HOME"

echo ""
echo "== Case 3: an uninitialised directory is not mistaken for a cluster =="
mkdir -p "$TEST_TMP_DIR/empty"
private_postgres_initialized "$TEST_TMP_DIR/empty"
assert_eq "an empty directory is not a cluster" "1" "$?"
printf '' > "$TEST_TMP_DIR/empty/PG_VERSION"
private_postgres_initialized "$TEST_TMP_DIR/empty"
assert_eq "a zero-byte PG_VERSION is not a cluster" "1" "$?"
printf '16\n' > "$TEST_TMP_DIR/empty/PG_VERSION"
private_postgres_initialized "$TEST_TMP_DIR/empty"
assert_eq "a stamped directory is a cluster" "0" "$?"

if [ -z "$(find_postgres_binary initdb 2>/dev/null || true)" ] || \
    [ -z "$(find_postgres_binary pg_ctl 2>/dev/null || true)" ]; then
    echo ""
    echo "SKIP: PostgreSQL server programs (initdb/pg_ctl) are unavailable;"
    echo "      skipping the provisioning cases."
    SKIPPED=1
else
    echo ""
    echo "== Case 4: provisioning works with no locale in the environment =="
    # `curl … | bash` routinely runs with no LANG at all, and a bare initdb
    # aborts with "invalid locale settings" in exactly that situation.
    provision_output="$(env -u LANG -u LC_ALL -u LC_CTYPE -u LC_COLLATE \
        bash -c "SEQDESK_INSTALL_LIB_ONLY=1 source '$REPO_ROOT/scripts/install-dist.sh'
            set +e
            OS=macos
            SEQDESK_PG_HOME='$SHORT_PG_HOME'
            provision_private_postgres 2>&1
            echo \"rc=\$?\"" 2>&1)"
    assert_contains "provisioning succeeds without LANG or LC_*" "$provision_output" "rc=0"
    assert_eq "the cluster was created" "0" "$(private_postgres_initialized && echo 0 || echo 1)"

    echo ""
    echo "== Case 5: the instance is reachable and socket-only =="
    private_postgres_running
    assert_ok "the instance is running" "$?"

    pg_isready_bin="$(find_postgres_binary pg_isready)"
    "$pg_isready_bin" -h "$(private_postgres_socket_dir)" -p 5432 >/dev/null 2>&1
    assert_ok "the private socket accepts connections" "$?"

    postgres_pid="$(head -1 "$(private_postgres_data_dir)/postmaster.pid" 2>/dev/null || true)"
    tcp_sockets="$(lsof -nP -p "$postgres_pid" -a -iTCP 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
    assert_eq "the instance opens no TCP sockets" "0" "$tcp_sockets"

    # Strip the trailing ACL/xattr marker macOS appends (@ or +) — it varies by
    # filesystem and says nothing about the permission bits under test.
    socket_perms="$(ls -ld "$(private_postgres_socket_dir)" | awk '{print $1}' | sed 's/[@+]$//')"
    assert_eq "the socket directory is private to its owner" "drwx------" "$socket_perms"

    hba="$(cat "$(private_postgres_data_dir)/pg_hba.conf")"
    assert_contains "host connections are rejected" "$hba" "host    all   all      all             reject"
    assert_contains "the owning user authenticates by peer" "$hba" "$(id -un)   peer"

    echo ""
    echo "== Case 6: the generated URL round-trips through the installer =="
    select_private_postgres "$(private_postgres_socket_dir)"
    generated_url="$(default_postgres_url "testpass123")"
    assert_contains "the URL carries the real socket directory" \
        "$generated_url" "host=%2Ftmp%2Fseqdesk-pgtest-$$%2Fsocket"

    SEQDESK_DATABASE_URL="$generated_url"
    load_postgres_url_parts
    assert_ok "the generated URL parses" "$?"
    assert_eq "the parsed host is the socket directory" "$(private_postgres_socket_dir)" "$PG_HOST"

    echo ""
    echo "== Case 7: the existing bootstrap works against the private cluster =="
    sudo_postgres_ready
    assert_ok "peer authentication grants administrative access" "$?"
    ensure_local_postgres_database >/dev/null 2>&1
    assert_ok "the role and database are created" "$?"
    postgres_connection_ready
    assert_ok "the application credentials connect" "$?"

    echo ""
    echo "== Case 8: re-provisioning adopts the cluster instead of rebuilding it =="
    # Reinstalling SeqDesk must never destroy an existing database.
    marker="$(LC_ALL=C "$(find_postgres_binary psql)" -X -w \
        -h "$(private_postgres_socket_dir)" -p 5432 -d postgres -qAt \
        -c "select oid from pg_database where datname = 'seqdesk'" 2>/dev/null)"
    reprovision_output="$(provision_private_postgres 2>&1)"
    assert_contains "an existing instance is reused" "$reprovision_output" "existing SeqDesk PostgreSQL instance"
    marker_after="$(LC_ALL=C "$(find_postgres_binary psql)" -X -w \
        -h "$(private_postgres_socket_dir)" -p 5432 -d postgres -qAt \
        -c "select oid from pg_database where datname = 'seqdesk'" 2>/dev/null)"
    assert_eq "the existing database survives re-provisioning" "$marker" "$marker_after"

    echo ""
    echo "== Case 9: the start wrapper restarts a stopped instance =="
    SEQDESK_DIR="$TEST_TMP_DIR/install"
    mkdir -p "$SEQDESK_DIR"
    bind_host() { printf '127.0.0.1'; }
    write_root_start_wrapper
    wrapper="$(cat "$SEQDESK_DIR/start.sh")"
    assert_contains "the wrapper starts the managed instance" "$wrapper" "SeqDesk manages this PostgreSQL instance"

    LC_ALL=C "$(find_postgres_binary pg_ctl)" -D "$(private_postgres_data_dir)" \
        -m fast -w stop >/dev/null 2>&1
    private_postgres_running
    assert_eq "the instance is stopped for the test" "1" "$?"

    # Run the wrapper up to the point where it hands off to the release.
    sed '/^ROOT_DIR=/,$d' "$SEQDESK_DIR/start.sh" > "$TEST_TMP_DIR/db-only.sh"
    bash "$TEST_TMP_DIR/db-only.sh" >/dev/null 2>&1
    private_postgres_running
    assert_ok "the wrapper brought the instance back up" "$?"
    bash "$TEST_TMP_DIR/db-only.sh" >/dev/null 2>&1
    assert_ok "the wrapper is idempotent when already running" "$?"
fi

echo ""
echo "== Case 10: Linux uses the same private instance instead of sudo =="
(
    OS="linux"
    DISTRO="debian"

    # Distributions keep the server programs off PATH; without this search they
    # look absent on a machine that has them, and SeqDesk falls back to
    # demanding root. Exercised against a fixture tree via SEQDESK_PG_SEARCH_ROOT
    # so the real lookup runs, not a stub.
    export SEQDESK_PG_SEARCH_ROOT="$TEST_TMP_DIR/linuxroot"
    linux_bin_dir="$SEQDESK_PG_SEARCH_ROOT/usr/lib/postgresql/16/bin"
    mkdir -p "$linux_bin_dir"
    printf '#!/bin/sh\nexit 0\n' > "$linux_bin_dir/initdb"
    chmod +x "$linux_bin_dir/initdb"

    # PATH must not be what finds it: that is the whole point of the search.
    found_initdb="$(PATH=/nonexistent find_postgres_binary initdb 2>/dev/null || true)"
    if [ "$found_initdb" = "$linux_bin_dir/initdb" ]; then
        echo "ok: an off-PATH distribution initdb is discoverable"
    else
        echo "FAIL: an off-PATH distribution initdb is discoverable: got [$found_initdb]" >&2
        exit 1
    fi

    # A RHEL-style prefix works too.
    rm -rf "$SEQDESK_PG_SEARCH_ROOT"
    rhel_bin_dir="$SEQDESK_PG_SEARCH_ROOT/usr/pgsql-16/bin"
    mkdir -p "$rhel_bin_dir"
    printf '#!/bin/sh\nexit 0\n' > "$rhel_bin_dir/pg_ctl"
    chmod +x "$rhel_bin_dir/pg_ctl"
    found_pg_ctl="$(PATH=/nonexistent find_postgres_binary pg_ctl 2>/dev/null || true)"
    if [ "$found_pg_ctl" = "$rhel_bin_dir/pg_ctl" ]; then
        echo "ok: a RHEL-style PostgreSQL prefix is discoverable"
    else
        echo "FAIL: a RHEL-style PostgreSQL prefix is discoverable: got [$found_pg_ctl]" >&2
        exit 1
    fi
    unset SEQDESK_PG_SEARCH_ROOT

    # A SeqDesk-owned cluster is administered by its creator, never by the
    # system postgres account.
    SEQDESK_PRIVATE_POSTGRES="true"
    sudo() { echo "UNEXPECTED sudo"; return 1; }
    runuser() { echo "UNEXPECTED runuser"; return 1; }
    as_postgres_output="$(run_as_postgres echo "ran directly" 2>&1)"
    case "$as_postgres_output" in
        *"ran directly"*) echo "ok: a private cluster is administered without sudo" ;;
        *) echo "FAIL: a private cluster is administered without sudo: [$as_postgres_output]" >&2; exit 1 ;;
    esac

    SEQDESK_PRIVATE_POSTGRES="false"
    shared_output="$(run_as_postgres echo "should escalate" 2>&1)"
    case "$shared_output" in
        *UNEXPECTED*) echo "ok: a shared cluster still escalates to the postgres account" ;;
        *) echo "FAIL: a shared cluster still escalates to the postgres account: [$shared_output]" >&2; exit 1 ;;
    esac

    # PostgreSQL refuses to start as root, so a root-owned cluster is unusable.
    is_root_user() { return 0; }
    root_output="$(provision_private_postgres 2>&1)"
    case "$root_output" in
        *"owned by root"*) echo "ok: provisioning as root is refused with the reason" ;;
        *) echo "FAIL: provisioning as root is refused with the reason: [$root_output]" >&2; exit 1 ;;
    esac

    # Linux failures must not talk about Homebrew.
    is_root_user() { return 1; }
    postgres_server_ready() { return 1; }
    diagnosis="$(print_local_postgres_diagnosis 2>&1)"
    case "$diagnosis" in
        *Homebrew*|*brew*) echo "FAIL: the Linux diagnosis mentions Homebrew" >&2; exit 1 ;;
        *apt-get*) echo "ok: the Linux diagnosis names distribution packages" ;;
        *) echo "FAIL: the Linux diagnosis names distribution packages: [$diagnosis]" >&2; exit 1 ;;
    esac

    # An explicit but currently-unreachable URL must stay recoverable by the
    # existing sudo-based setup rather than failing the install here.
    SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk"
    SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
    load_postgres_url_parts() { PG_HOST="127.0.0.1"; PG_PORT="5432"; return 0; }
    postgres_socket_server_ready() { return 1; }
    provision_private_postgres() { echo "UNEXPECTED private provisioning"; return 0; }
    deferred_output="$(preflight_local_postgres 2>&1)"
    deferred_status=$?
    if [ "$deferred_status" -ne 0 ]; then
        echo "FAIL: an unreachable explicit URL defers instead of failing on Linux" >&2
        exit 1
    fi
    echo "ok: an unreachable explicit URL defers instead of failing on Linux"
    case "$deferred_output" in
        *UNEXPECTED*) echo "FAIL: an explicit URL never triggers private provisioning on Linux" >&2; exit 1 ;;
        *) echo "ok: an explicit URL never triggers private provisioning on Linux" ;;
    esac
) || FAILURES=$((FAILURES + 1))

echo ""
if [ "$FAILURES" -ne 0 ]; then
    echo "private-postgres test: $FAILURES assertion(s) failed" >&2
    exit 1
fi
if [ "$SKIPPED" -ne 0 ]; then
    echo "private-postgres test: all assertions passed (provisioning cases skipped)"
    exit 0
fi
echo "private-postgres test: all assertions passed"
