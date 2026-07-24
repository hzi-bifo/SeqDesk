#!/usr/bin/env bash
#
# Regression coverage for distribution-installer Conda discovery and safe
# Miniconda prefix handling. No network access or real Conda install is used.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER_VARIANT="${SEQDESK_CONDA_TEST_INSTALLER:-distribution}"
case "$INSTALLER_VARIANT" in
    distribution) INSTALLER_PATH="$REPO_ROOT/scripts/install-dist.sh" ;;
    source) INSTALLER_PATH="$REPO_ROOT/scripts/install.sh" ;;
    *)
        echo "Unknown installer variant: $INSTALLER_VARIANT" >&2
        exit 2
        ;;
esac

# shellcheck disable=SC1091
SEQDESK_INSTALL_LIB_ONLY=1 source "$INSTALLER_PATH"

FAILURES=0
assert_eq() {
    if [ "$2" != "$3" ]; then
        echo "FAIL: $1: expected [$2], got [$3]" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_contains() {
    case "$3" in
        *"$2"*) echo "ok: $1" ;;
        *)
            echo "FAIL: $1: output did not contain [$2]" >&2
            FAILURES=$((FAILURES + 1))
            ;;
    esac
}
assert_not_contains() {
    case "$3" in
        *"$2"*)
            echo "FAIL: $1: output unexpectedly contained [$2]" >&2
            FAILURES=$((FAILURES + 1))
            ;;
        *) echo "ok: $1" ;;
    esac
}
assert_file_exists() {
    if [ ! -e "$2" ]; then
        echo "FAIL: $1: expected file to exist: $2" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_file_missing() {
    if [ -e "$2" ]; then
        echo "FAIL: $1: expected file to be removed: $2" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}

write_fake_conda() {
    local base="$1"
    mkdir -p "$base/bin"
    {
        printf '%s\n' '#!/bin/sh'
        printf '%s\n' 'case "${1:-}" in'
        printf '%s\n' '  --version) printf "%s\n" "conda 25.1.0" ;;'
        printf '  info) printf "%%s\\n" "%s" ;;\n' "$base"
        printf '%s\n' '  *) exit 0 ;;'
        printf '%s\n' 'esac'
    } > "$base/bin/conda"
    chmod +x "$base/bin/conda"
}

TEST_ROOT="$(mktemp -d)"
OUT="$TEST_ROOT/output.txt"
trap 'rm -rf "$TEST_ROOT"' EXIT
ORIGINAL_PATH="$PATH"
CLEAN_PATH="/usr/bin:/bin"
PATH="$CLEAN_PATH"
unset CONDA_EXE

echo "Testing $INSTALLER_VARIANT installer: $INSTALLER_PATH"
echo ""
echo "== Case 1: valid default Miniconda outside PATH is reused =="
HOME="$TEST_ROOT/home-valid-default"
PATH="$CLEAN_PATH"
mkdir -p "$HOME"
write_fake_conda "$HOME/miniconda3"
SEQDESK_EXEC_CONDA_PATH=""
resolve_conda_runtime
assert_eq "default prefix resolves as found" "found" "$CONDA_RESOLUTION"
assert_eq "default prefix discovery source" "standard-prefix" "$CONDA_DISCOVERY_SOURCE"
assert_eq "default prefix is persisted" "$HOME/miniconda3" "$SEQDESK_EXEC_CONDA_PATH"
assert_eq "default prefix binary is selected" \
    "$HOME/miniconda3/bin/conda" "$CONDA_BIN_FROM_PATH"
if [ "$INSTALLER_VARIANT" = "distribution" ]; then
    assert_contains "preflight says the existing base is reused" \
        "will reuse" "$(conda_preflight_status)"
fi

echo ""
echo "== Case 2: invalid default prefix is preserved and a clean fallback is selected =="
HOME="$TEST_ROOT/home-invalid-default"
PATH="$CLEAN_PATH"
mkdir -p "$HOME/miniconda3"
printf '%s\n' "keep me" > "$HOME/miniconda3/user-marker"
SEQDESK_EXEC_CONDA_PATH=""
resolve_conda_runtime
assert_eq "invalid default selects fallback install" "install-fallback" "$CONDA_RESOLUTION"
assert_eq "fallback target is deterministic" \
    "$HOME/seqdesk-miniconda3" "$CONDA_INSTALL_BASE"
assert_eq "occupied default is recorded" "$HOME/miniconda3" "$CONDA_SKIPPED_PREFIX"
assert_file_exists "invalid default content is untouched" "$HOME/miniconda3/user-marker"
if [ "$INSTALLER_VARIANT" = "distribution" ]; then
    assert_contains "preflight names the untouched prefix" \
        "leaving $HOME/miniconda3 untouched" "$(conda_preflight_status)"
fi

echo ""
echo "== Case 3: a working Conda on PATH wins over standard user bases =="
HOME="$TEST_ROOT/home-path"
PATH="$CLEAN_PATH"
mkdir -p "$HOME"
write_fake_conda "$HOME/miniconda3"
write_fake_conda "$TEST_ROOT/path-conda"
PATH="$TEST_ROOT/path-conda/bin:$PATH"
SEQDESK_EXEC_CONDA_PATH=""
resolve_conda_runtime
assert_eq "PATH base wins" "$TEST_ROOT/path-conda" "$SEQDESK_EXEC_CONDA_PATH"
assert_eq "PATH discovery source" "PATH" "$CONDA_DISCOVERY_SOURCE"
assert_eq "PATH binary wins" \
    "$TEST_ROOT/path-conda/bin/conda" "$CONDA_BIN_FROM_PATH"

echo ""
echo "== Case 4: an explicit valid base wins and expands a leading tilde =="
HOME="$TEST_ROOT/home-explicit"
PATH="$CLEAN_PATH"
mkdir -p "$HOME"
write_fake_conda "$HOME/miniconda3"
write_fake_conda "$HOME/custom-conda"
SEQDESK_EXEC_CONDA_PATH="~/custom-conda"
resolve_conda_runtime
assert_eq "configured base wins" "$HOME/custom-conda" "$SEQDESK_EXEC_CONDA_PATH"
assert_eq "configured discovery source" "configured" "$CONDA_DISCOVERY_SOURCE"
assert_eq "configured binary wins" \
    "$HOME/custom-conda/bin/conda" "$CONDA_BIN_FROM_PATH"

echo ""
echo "== Case 5: an existing relative configured base becomes absolute =="
HOME="$TEST_ROOT/home-relative-existing"
PATH="$CLEAN_PATH"
mkdir -p "$HOME/work"
write_fake_conda "$HOME/work/relative-conda"
pushd "$HOME/work" >/dev/null
SEQDESK_EXEC_CONDA_PATH="./relative-conda/"
resolve_conda_runtime
relative_existing_resolution="$CONDA_RESOLUTION"
relative_existing_path="$SEQDESK_EXEC_CONDA_PATH"
popd >/dev/null
assert_eq "relative existing base resolves as found" \
    "found" "$relative_existing_resolution"
assert_eq "relative existing base is made absolute" \
    "$HOME/work/relative-conda" "$relative_existing_path"

echo ""
echo "== Case 6: a new relative configured target remains stable after cd =="
HOME="$TEST_ROOT/home-relative-new"
PATH="$CLEAN_PATH"
mkdir -p "$HOME/work"
pushd "$HOME/work" >/dev/null
SEQDESK_EXEC_CONDA_PATH="./new-conda/"
resolve_conda_runtime
relative_new_resolution="$CONDA_RESOLUTION"
relative_new_target="$CONDA_INSTALL_BASE"
popd >/dev/null
assert_eq "relative new base is selected for install" \
    "install-configured" "$relative_new_resolution"
assert_eq "relative new install target is made absolute" \
    "$HOME/work/new-conda" "$relative_new_target"

echo ""
echo "== Case 7: an invalid explicit base fails closed instead of redirecting =="
HOME="$TEST_ROOT/home-invalid-explicit"
PATH="$CLEAN_PATH"
mkdir -p "$HOME/broken-conda"
printf '%s\n' "keep me too" > "$HOME/broken-conda/user-marker"
SEQDESK_EXEC_CONDA_PATH="$HOME/broken-conda"
resolve_conda_runtime
assert_eq "invalid explicit base is actionable" "invalid-configured" "$CONDA_RESOLUTION"
assert_eq "invalid explicit base is retained" "$HOME/broken-conda" "$CONDA_CONFLICT_PATH"
assert_eq "invalid explicit base does not choose an install target" "" "$CONDA_INSTALL_BASE"
assert_file_exists "invalid explicit content is untouched" "$HOME/broken-conda/user-marker"

echo ""
echo "== Case 8: two invalid automatic targets stop with a fresh-path suggestion =="
HOME="$TEST_ROOT/home-invalid-defaults"
PATH="$CLEAN_PATH"
mkdir -p "$HOME/miniconda3" "$HOME/seqdesk-miniconda3"
printf '%s\n' "default marker" > "$HOME/miniconda3/user-marker"
printf '%s\n' "fallback marker" > "$HOME/seqdesk-miniconda3/user-marker"
SEQDESK_EXEC_CONDA_PATH=""
SEQDESK_DIR="$HOME/seqdesk"
resolve_conda_runtime
assert_eq "two invalid targets stop" "invalid-defaults" "$CONDA_RESOLUTION"
assert_eq "two invalid targets do not choose an install path" "" "$CONDA_INSTALL_BASE"
print_unusable_conda_prefix_error > "$OUT" 2>&1
conflict_output="$(cat "$OUT")"
assert_contains "conflict output names the untouched default" \
    "$HOME/miniconda3" "$conflict_output"
assert_contains "conflict output names the untouched fallback" \
    "$HOME/seqdesk-miniconda3" "$conflict_output"
assert_contains "conflict output suggests a new unused base" \
    "$HOME/seqdesk-miniconda3-new" "$conflict_output"
assert_contains "conflict output links to exact recovery guidance" \
    "common-problems#miniconda-says-the-prefix-already-exists" "$conflict_output"
assert_file_exists "default conflict content is untouched" "$HOME/miniconda3/user-marker"
assert_file_exists "fallback conflict content is untouched" \
    "$HOME/seqdesk-miniconda3/user-marker"

echo ""
echo "== Case 9: only the failing Miniconda command output is surfaced =="
HOME="$TEST_ROOT/home-failure"
mkdir -p "$HOME"
SEQDESK_DIR="$HOME/seqdesk"
SEQDESK_LOG="$TEST_ROOT/install.log"
SEQDESK_LOG_ENABLED="true"
printf '%s\n' "PRE_COMMAND_SENTINEL_MUST_NOT_BE_ECHOED" > "$SEQDESK_LOG"
MINICONDA_INSTALLER_FILE="$TEST_ROOT/failing-miniconda.sh"
MINICONDA_OUTPUT_FILE="$TEST_ROOT/miniconda-output.log"
{
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' 'echo "UNIQUE_MINICONDA_FAILURE: prefix already exists" >&2'
    printf '%s\n' 'exit 23'
} > "$MINICONDA_INSTALLER_FILE"
chmod +x "$MINICONDA_INSTALLER_FILE"
saved_installer_file="$MINICONDA_INSTALLER_FILE"
saved_output_file="$MINICONDA_OUTPUT_FILE"
if install_miniconda_with_diagnostics \
    "$MINICONDA_INSTALLER_FILE" "$HOME/miniconda3" > "$OUT" 2>&1; then
    install_status=0
else
    install_status=$?
fi
diagnostic_output="$(cat "$OUT")"
assert_eq "Miniconda exit status is preserved" "23" "$install_status"
assert_contains "underlying Miniconda error is visible" \
    "UNIQUE_MINICONDA_FAILURE: prefix already exists" "$diagnostic_output"
assert_not_contains "earlier installer log content is not echoed" \
    "PRE_COMMAND_SENTINEL_MUST_NOT_BE_ECHOED" "$diagnostic_output"
assert_file_missing "temporary Miniconda installer is removed" "$saved_installer_file"
assert_file_missing "temporary Miniconda output is removed" "$saved_output_file"
if [ "$INSTALLER_VARIANT" = "distribution" ]; then
    assert_contains "underlying error remains in the protected full log" \
        "UNIQUE_MINICONDA_FAILURE: prefix already exists" "$(cat "$SEQDESK_LOG")"
fi

if [ "$INSTALLER_VARIANT" = "distribution" ]; then
    echo ""
    echo "== Case 10: reconfigure restores the saved nonstandard Conda base =="
    HOME="$TEST_ROOT/home-reconfigure"
    PATH="$ORIGINAL_PATH"
    saved_conda_base="$HOME/shared-conda"
    existing_install="$HOME/existing-seqdesk"
    write_fake_conda "$saved_conda_base"
    mkdir -p "$existing_install"
    printf '{"pipelines":{"enabled":true,"execution":{"conda":{"path":"%s"}}}}\n' \
        "$saved_conda_base" > "$existing_install/settings.json"
    SEQDESK_EXEC_CONDA_PATH=""
    SEQDESK_WITH_PIPELINES=""
    load_existing_install_values "$existing_install" > "$OUT" 2>&1
    assert_eq "saved Conda base is loaded" \
        "$saved_conda_base" "$SEQDESK_EXEC_CONDA_PATH"
    resolve_conda_runtime
    assert_eq "saved Conda base is reused" "found" "$CONDA_RESOLUTION"
    assert_eq "saved Conda base stays selected" \
        "$saved_conda_base" "$SEQDESK_EXEC_CONDA_PATH"
fi

echo ""
if [ "$FAILURES" -ne 0 ]; then
    echo "conda-discovery test ($INSTALLER_VARIANT): $FAILURES assertion(s) failed" >&2
    exit 1
fi
echo "conda-discovery test ($INSTALLER_VARIANT): all assertions passed"

if [ "$INSTALLER_VARIANT" = "distribution" ]; then
    echo ""
    SEQDESK_CONDA_TEST_INSTALLER=source bash "$0"
fi
