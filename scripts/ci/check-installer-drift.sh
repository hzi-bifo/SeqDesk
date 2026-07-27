#!/usr/bin/env bash
#
# Installer drift guard.
#
# scripts/install.sh (source/dev installer) and scripts/install-dist.sh
# (distribution installer shipped as https://seqdesk.org/install.sh) share a
# large body of helper functions. Fixes have repeatedly landed in only one of
# them -- the secrets-hygiene hardening of 2026-07-22..25 is the most recent
# example -- and nothing checked that the shared helpers stayed in sync.
#
# This script compares every function that exists in BOTH installers and fails
# when one has diverged, unless the function name is on the allowlist below.
# The allowlist is the list of functions that are *deliberately* different
# because the two installers do genuinely different things (clone a git
# checkout vs. unpack a release tarball, private PostgreSQL provisioning,
# spinner-aware output, hosted install profiles, ...).
#
# Comparison method: each installer is sourced in library-only mode in its own
# subshell and every function is dumped with `declare -f`. That compares the
# parsed body rather than raw text, so it is immune to the `}` at column zero
# that appears inside the embedded node heredocs, and it ignores pure
# indentation noise while still catching every semantic change.
#
# Usage:
#   bash scripts/ci/check-installer-drift.sh
#   SEQDESK_DRIFT_PRINT=1 bash scripts/ci/check-installer-drift.sh   # print the
#       current divergent set, for regenerating ALLOWED_DIVERGENT after an
#       intentional change.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_INSTALLER="$REPO_ROOT/scripts/install.sh"
DIST_INSTALLER="$REPO_ROOT/scripts/install-dist.sh"
DRIFT_PRINT="${SEQDESK_DRIFT_PRINT:-}"

# Functions that are allowed to differ between the two installers.
#
# Group 1 -- structurally different installs: the source installer clones a git
# repository and runs from the working tree; the distribution installer
# downloads and verifies a release tarball, manages release symlinks, provisions
# a private PostgreSQL cluster and drives an interactive wizard.
#
# Group 2 -- output layer: the distribution installer has a spinner, an always-on
# install log and NO_COLOR handling, so its print_* helpers are necessarily
# different implementations of the same idea.
#
# An entry that has become identical is reported as a note, never as a failure:
# converging the two installers must not break the build of the change that
# converged them. Drop the name from this list in the same commit.
ALLOWED_DIVERGENT="
apply_infrastructure_settings
configure_postgres_urls
db_tcp_reachable
default_postgres_url
ensure_seed_dependency
gating_preflight
has_infrastructure_overrides
install_miniconda_with_diagnostics
install_private_metaxpath_if_configured
load_install_config
on_error
parse_args
postgres_url_host_port
print_error
print_header
print_info
print_node_install_instructions
print_postgres_setup_instructions
print_step
print_success
print_unusable_conda_prefix_error
print_usage
print_warning
run_wizard
write_config
"

# A guard that compares nothing passes silently. Both installers hide their
# function library behind SEQDESK_INSTALL_LIB_ONLY; if that hook is renamed, or
# a new top-level statement lands in front of it, `declare -F` returns a handful
# of early definitions instead of the whole library and every later divergence
# slips through unnoticed. The empty-directory check below only catches a total
# failure, so the shared count is held above a floor as well. Lower this
# deliberately (and say why) if functions are genuinely retired.
MIN_SHARED_FUNCTIONS=40

FAILURES=0
IDENTICAL=0
SHARED=0
EXPECTED_DIVERGENT=0
DIVERGENT_LIST=""

WORK_DIR=""
cleanup() {
    if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
        rm -rf "$WORK_DIR"
    fi
}
trap cleanup EXIT

is_allowlisted() {
    local name="$1"
    case "$ALLOWED_DIVERGENT" in
        *"
$name
"*) return 0 ;;
    esac
    return 1
}

# Source one installer in library-only mode and write one file per function,
# named after the function and containing `declare -f` output. Runs in its own
# `bash -c` so the two installers cannot overwrite each other's definitions and
# so this script's own helpers are never dumped.
dump_functions() {
    local installer_path="$1"
    local out_dir="$2"

    mkdir -p "$out_dir" || return 1
    SEQDESK_INSTALL_LIB_ONLY=1 SEQDESK_DRIFT_OUT_DIR="$out_dir" \
        bash -c '
set -uo pipefail
# shellcheck disable=SC1090
. "$1" || exit 1
for fn_name in $(declare -F | sed "s/^declare -[^ ]* //"); do
    case "$fn_name" in
        [A-Za-z_]*) ;;
        *) continue ;;
    esac
    declare -f "$fn_name" > "$SEQDESK_DRIFT_OUT_DIR/$fn_name" || exit 1
done
' bash "$installer_path" >/dev/null || return 1
}

for installer in "$SOURCE_INSTALLER" "$DIST_INSTALLER"; do
    if [ ! -f "$installer" ]; then
        echo "FAIL: installer not found: $installer" >&2
        exit 2
    fi
done

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/seqdesk-installer-drift.XXXXXX")" || exit 2
SOURCE_DIR="$WORK_DIR/source"
DIST_DIR="$WORK_DIR/dist"

if ! dump_functions "$SOURCE_INSTALLER" "$SOURCE_DIR"; then
    echo "FAIL: could not load functions from $SOURCE_INSTALLER" >&2
    exit 2
fi
if ! dump_functions "$DIST_INSTALLER" "$DIST_DIR"; then
    echo "FAIL: could not load functions from $DIST_INSTALLER" >&2
    exit 2
fi

if [ -z "$(ls -A "$SOURCE_DIR" 2>/dev/null)" ] || [ -z "$(ls -A "$DIST_DIR" 2>/dev/null)" ]; then
    echo "FAIL: no functions were extracted; the library-only test hook may have moved" >&2
    exit 2
fi

for fn_path in "$SOURCE_DIR"/*; do
    fn_name="$(basename "$fn_path")"
    if [ ! -f "$DIST_DIR/$fn_name" ]; then
        # Present in only one installer: nothing to compare, and not drift.
        continue
    fi
    SHARED=$((SHARED + 1))
    if cmp -s "$fn_path" "$DIST_DIR/$fn_name"; then
        IDENTICAL=$((IDENTICAL + 1))
        if is_allowlisted "$fn_name"; then
            echo "note: $fn_name is allowlisted as divergent but is now identical; drop it from ALLOWED_DIVERGENT"
        fi
        continue
    fi

    DIVERGENT_LIST="$DIVERGENT_LIST$fn_name
"
    if is_allowlisted "$fn_name"; then
        EXPECTED_DIVERGENT=$((EXPECTED_DIVERGENT + 1))
        continue
    fi

    echo "FAIL: $fn_name has drifted between the source and distribution installers" >&2
    echo "      diff <(declare -f $fn_name from install.sh) <(… from install-dist.sh):" >&2
    diff "$fn_path" "$DIST_DIR/$fn_name" | sed 's/^/      /' >&2
    FAILURES=$((FAILURES + 1))
done

if [ -n "$DRIFT_PRINT" ]; then
    echo ""
    echo "Current divergent functions (paste into ALLOWED_DIVERGENT if intentional):"
    printf '%s' "$DIVERGENT_LIST"
fi

echo ""
echo "installer drift check: $SHARED shared function(s) compared, $IDENTICAL identical, $EXPECTED_DIVERGENT allowlisted as divergent"
if [ "$SHARED" -lt "$MIN_SHARED_FUNCTIONS" ]; then
    echo "FAIL: only $SHARED shared function(s) were compared, expected at least $MIN_SHARED_FUNCTIONS" >&2
    echo "      One of the installers stopped exposing its library under SEQDESK_INSTALL_LIB_ONLY," >&2
    echo "      so this check was about to pass without comparing anything." >&2
    exit 2
fi
if [ "$FAILURES" -ne 0 ]; then
    echo "installer drift check: $FAILURES unexpected divergence(s)" >&2
    echo "Fix the function in both installers, or add it to ALLOWED_DIVERGENT with a reason." >&2
    exit 1
fi
echo "installer drift check: no unexpected drift"
