#!/bin/bash
#
# SeqDesk Installation Script (Distribution)
# https://seqdesk.org
#
# Guided usage:
#   curl -fsSLo /tmp/seqdesk-install.sh https://seqdesk.org/install.sh
#   bash /tmp/seqdesk-install.sh --interactive --dir "$HOME/seqdesk"
# Non-interactive usage: curl -fsSL https://seqdesk.org/install.sh | bash -s -- -y [options]
#
# Options (environment variables):
#   SEQDESK_DIR=/path/to/install   - Installation directory (default: ./seqdesk)
#   SEQDESK_VERSION=x.x.x          - Specific version (default: latest)
#   SEQDESK_API=https://.../api    - Advanced: override release metadata endpoint
#   SEQDESK_WITH_PIPELINES=1       - Install pipeline dependencies (Conda + Nextflow)
#   SEQDESK_WITH_CONDA=1           - Legacy: install Miniconda + pipeline env
#   SEQDESK_SKIP_DEPS=1            - Deprecated (ignored in distribution installer)
#   SEQDESK_YES=1                  - Non-interactive; accept defaults
#   SEQDESK_INTERACTIVE=1          - Guided profile, infrastructure, and account setup
#   SEQDESK_DATA_PATH=/data        - Optional managed scientific-data root
#   SEQDESK_RUN_DIR=/data/runs     - Optional pipeline run directory override
#   SEQDESK_PIPELINE_DATABASE_DIR=/data/pipeline-dbs - Optional pipeline DB directory override
#   SEQDESK_PORT=8000              - App port (default: 8000)
#   SEQDESK_ACCESS_AUDIENCE=local  - local, team-server, or advanced
#   SEQDESK_BIND_HOST=127.0.0.1    - Standalone server bind host (loopback by default)
#   SEQDESK_NEXTAUTH_URL=https://  - Optional NextAuth URL override
#   SEQDESK_NEXTAUTH_SECRET=...    - Optional NextAuth secret override
#   SEQDESK_DATABASE_URL=postgresql://... - Optional database URL
#   SEQDESK_DATABASE_DIRECT_URL=postgresql://... - Optional direct database URL for migrations
#   SEQDESK_ANTHROPIC_API_KEY=...  - Optional Anthropic API key
#   SEQDESK_ADMIN_SECRET=...       - Optional admin secret
#   SEQDESK_BLOB_READ_WRITE_TOKEN=... - Optional Blob token
#   SEQDESK_ORDER_FORM_SETTINGS=/path/order.json - Optional exported order form preset
#   SEQDESK_STUDY_FORM_SETTINGS=/path/study.json - Optional exported study form preset
#   SEQDESK_LOG=/path/install.log  - Optional install log path (default: mktemp under $TMPDIR)
#   SEQDESK_USE_PM2=1             - Start with PM2 for auto-restart (recommended)
#   SEQDESK_RUN_DOCTOR=1          - Run seqdesk doctor after install when the CLI is available
#   SEQDESK_CONFIG=/path/or/url    - Optional infra JSON (flat or nested keys)
#   SEQDESK_DEPLOYMENT_PROFILE=sequencing-center - Installation operating model
#   SEQDESK_PROFILE=twincore       - Hosted install profile id
#   SEQDESK_PROFILE_CODE=...       - Access code for hosted install profile
#   SEQDESK_PROFILE_REGISTRY_URL=https://seqdesk.org/api/install-profiles
#   SEQDESK_ADDITIONAL_SETTINGS_FILE=/etc/seqdesk/install-overrides.json - Optional local JSON overrides
#   SEQDESK_RECONFIGURE=1          - Reconfigure existing install in place (repeatable)
#   SEQDESK_OVERWRITE_EXISTING=1   - With -y, back up an existing install dir and replace it
#   SEQDESK_RESEED_DB=1            - Force DB push + seed (default off for reconfigure)
#   SEQDESK_REQUIRE_CHECKSUM=1     - Refuse to install a release with no published checksum
#   SEQDESK_CURL_CONNECT_TIMEOUT=10 - Per-attempt connect timeout for downloads (seconds)
#   SEQDESK_CURL_MAX_TIME=120      - Per-attempt ceiling for metadata/config fetches (seconds)
#   SEQDESK_CURL_DOWNLOAD_MAX_TIME=1800 - Per-attempt ceiling for the release
#                                    tarball (seconds); the Miniconda installer
#                                    is fetched with no ceiling
#   SEQDESK_CURL_RETRIES=2         - Retries for transient download failures
#   SEQDESK_MINICONDA_BASE_URL=https://... - Miniconda download base (default: repo.anaconda.com)
#   SEQDESK_MINICONDA_INSTALLER=Miniconda3-py312_24.9.2-0-Linux-x86_64.sh - Pin an exact installer
#   SEQDESK_PREPARE_POSTGRES=1     - Prepare local PostgreSQL role/database, then exit
#   SEQDESK_PLAN_ONLY=1             - Resolve and validate without applying changes
#   SEQDESK_EXEC_USE_SLURM=true    - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_QUEUE=cpu   - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_CORES=4     - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_MEMORY=64GB - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_TIME_LIMIT=12 - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_OPTIONS=... - Optional pipeline execution override
#   SEQDESK_EXEC_CONDA_PATH=/opt/miniconda3 - Existing or new Conda base; overrides discovery
#   SEQDESK_EXEC_CONDA_ENV=seqdesk-pipelines - Optional pipeline execution override
#   SEQDESK_EXEC_NEXTFLOW_PROFILE=conda - Optional pipeline execution override
#   SEQDESK_EXEC_WEBLOG_URL=http://host/api/pipelines/weblog - Optional override
#   SEQDESK_EXEC_WEBLOG_SECRET=secret - Optional override
#   SEQDESK_METAXPATH_PACKAGE_URL=https://... - Optional private MetaxPath package URL
#   SEQDESK_METAXPATH_KEY=...       - Optional private MetaxPath access key/token
#   SEQDESK_METAXPATH_SHA256=...    - Optional private MetaxPath tarball checksum
#   METAXPATH_PACKAGE_URL=https://... - Alias for SEQDESK_METAXPATH_PACKAGE_URL
#   METAXPATH_PACKAGE_TOKEN=...     - Alias for SEQDESK_METAXPATH_KEY
#   METAXPATH_PACKAGE_SHA256=...    - Alias for SEQDESK_METAXPATH_SHA256
#

# -E (errtrace) is load bearing, not decoration: without it bash does not
# inherit the `trap on_error ERR` into shell functions, so a failure inside any
# function -- which is where nearly all of this installer lives -- exits with a
# bare non-zero status and no failure epilogue, no log path, and, on an upgrade,
# no restore of the backed-up previous install.
set -Eeuo pipefail

# Terminal style
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    CYAN=''
    BOLD=''
    NC=''
fi

# Config
SEQDESK_DIR="${SEQDESK_DIR:-}"
SEQDESK_VERSION="${SEQDESK_VERSION:-}"
SEQDESK_API="${SEQDESK_API:-https://seqdesk.org/api}"
SEQDESK_WITH_PIPELINES="${SEQDESK_WITH_PIPELINES:-}"
SEQDESK_WITH_CONDA="${SEQDESK_WITH_CONDA:-}"
SEQDESK_SKIP_DEPS="${SEQDESK_SKIP_DEPS:-}"
SEQDESK_YES="${SEQDESK_YES:-}"
SEQDESK_INTERACTIVE="${SEQDESK_INTERACTIVE:-}"
SEQDESK_DEPLOYMENT_PROFILE="${SEQDESK_DEPLOYMENT_PROFILE:-}"
SEQDESK_ONBOARDING_VERSION="${SEQDESK_ONBOARDING_VERSION:-}"
SEQDESK_USER_CLI_PATH=""
SEQDESK_USER_CLI_BIN_DIR=""
SEQDESK_USER_CLI_NEEDS_PATH="false"
SEQDESK_USER_CLI_PREVIOUS_PATH=""
# Promote diagnostic detail() narration from the install log to the terminal.
SEQDESK_VERBOSE="${SEQDESK_VERBOSE:-}"
# Whether the installer generated the bootstrap passwords (and therefore has to
# show them once at the end) rather than the operator supplying them.
INTERACTIVE_RESULT_GENERATED="false"
SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="false"
SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="false"
# Separate copies of passwords the installer generated, kept only so the final
# summary can show them once. clear_bootstrap_plaintext_passwords() wipes the
# bootstrap variables as soon as settings.json is written — long before the
# summary prints — so reading them there yields an empty string and the operator
# is left with an account they cannot sign in to. These are cleared immediately
# after they are displayed. A password the operator typed is never stored here.
SEQDESK_GENERATED_ADMIN_PASSWORD=""
SEQDESK_GENERATED_RESEARCHER_PASSWORD=""
# Set once the database has been inspected: whether the target database already
# held the bootstrap accounts this install was about to create. The seed leaves
# an existing account untouched, so a password generated here would never be
# applied to it -- these flags stop such a password from being stored or shown.
SEQDESK_DB_ADOPTED="false"
SEQDESK_BOOTSTRAP_ADMIN_EXISTED="false"
SEQDESK_BOOTSTRAP_RESEARCHER_EXISTED="false"
# A generated administrator password is disclosed only after a database probe
# confirms that the intended administrator row exists, is active, and has
# system access.
SEQDESK_BOOTSTRAP_ADMIN_VERIFIED="false"
# Number of User rows the target database held before this install seeded it.
# Empty means "not established" and must never be read as zero: only a measured
# 0 entitles the installer to call the database new and empty.
SEQDESK_DB_USER_COUNT=""
# True when the database could not be inspected at all. Generated credentials
# are withheld unless the later post-seed verification proves they are usable.
SEQDESK_DB_PROBE_FAILED="false"
INTERACTIVE_RESULT=""
SEQDESK_DATA_PATH="${SEQDESK_DATA_PATH:-}"
SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-}"
SEQDESK_PORT="${SEQDESK_PORT:-}"
SEQDESK_BIND_HOST="${SEQDESK_BIND_HOST:-}"
SEQDESK_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}"
# Human-facing access choice used by the guided installer and InstallPlan.
# It is derived for unattended installs and does not change runtime behavior by
# itself; bind host and NEXTAUTH_URL remain the canonical runtime values.
SEQDESK_ACCESS_AUDIENCE="${SEQDESK_ACCESS_AUDIENCE:-}"
SEQDESK_NEXTAUTH_SECRET="${SEQDESK_NEXTAUTH_SECRET:-}"
SEQDESK_DATABASE_URL="${SEQDESK_DATABASE_URL:-}"
SEQDESK_DATABASE_DIRECT_URL="${SEQDESK_DATABASE_DIRECT_URL:-}"
# Internal, non-secret state selected only when a fresh macOS install can reuse
# an already-working local PostgreSQL Unix socket. Explicit database URLs are
# never rewritten to use this value.
MACOS_POSTGRES_SOCKET_DIR=""
# Set when the installer created (or adopted) its own PostgreSQL cluster under
# SEQDESK_PG_HOME instead of reusing a server the machine already runs.
SEQDESK_PRIVATE_POSTGRES="false"
SEQDESK_ANTHROPIC_API_KEY="${SEQDESK_ANTHROPIC_API_KEY:-}"
SEQDESK_ADMIN_SECRET="${SEQDESK_ADMIN_SECRET:-}"
SEQDESK_BLOB_READ_WRITE_TOKEN="${SEQDESK_BLOB_READ_WRITE_TOKEN:-}"
SEQDESK_UPDATE_SERVER="${SEQDESK_UPDATE_SERVER:-}"
SEQDESK_ORDER_FORM_SETTINGS="${SEQDESK_ORDER_FORM_SETTINGS:-}"
SEQDESK_STUDY_FORM_SETTINGS="${SEQDESK_STUDY_FORM_SETTINGS:-}"
SEQDESK_TELEMETRY_ENABLED="${SEQDESK_TELEMETRY_ENABLED:-}"
SEQDESK_TELEMETRY_ENDPOINT="${SEQDESK_TELEMETRY_ENDPOINT:-}"
SEQDESK_TELEMETRY_INTERVAL_HOURS="${SEQDESK_TELEMETRY_INTERVAL_HOURS:-}"
SEQDESK_BOOTSTRAP_ADMIN_EMAIL="${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}"
SEQDESK_BOOTSTRAP_ADMIN_PASSWORD="${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD:-}"
SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH="${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH:-}"
SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME="${SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME:-}"
SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME="${SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME:-}"
SEQDESK_BOOTSTRAP_ADMIN_FACILITY_NAME="${SEQDESK_BOOTSTRAP_ADMIN_FACILITY_NAME:-}"
SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL="${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}"
SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD="${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD:-}"
SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH="${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH:-}"
SEQDESK_BOOTSTRAP_RESEARCHER_FIRST_NAME="${SEQDESK_BOOTSTRAP_RESEARCHER_FIRST_NAME:-}"
SEQDESK_BOOTSTRAP_RESEARCHER_LAST_NAME="${SEQDESK_BOOTSTRAP_RESEARCHER_LAST_NAME:-}"
SEQDESK_BOOTSTRAP_RESEARCHER_INSTITUTION="${SEQDESK_BOOTSTRAP_RESEARCHER_INSTITUTION:-}"
SEQDESK_BOOTSTRAP_RESEARCHER_ROLE="${SEQDESK_BOOTSTRAP_RESEARCHER_ROLE:-}"
SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED="${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}"
SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA="${SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA:-}"
SEQDESK_OPTIONAL_EXAMPLE_DATA_SOURCE=""
SEQDESK_OPTIONAL_TELEMETRY_SOURCE=""
SEQDESK_LOG="${SEQDESK_LOG:-}"
SEQDESK_USE_PM2="${SEQDESK_USE_PM2:-}"
SEQDESK_RUN_DOCTOR="${SEQDESK_RUN_DOCTOR:-}"
SEQDESK_CONFIG="${SEQDESK_CONFIG:-}"
SEQDESK_PROFILE="${SEQDESK_PROFILE:-${SEQDESK_SETTING:-}}"
SEQDESK_PROFILE_CODE="${SEQDESK_PROFILE_CODE:-${SEQDESK_KEY:-}}"
SEQDESK_PROFILE_REGISTRY_URL="${SEQDESK_PROFILE_REGISTRY_URL:-https://seqdesk.org/api/install-profiles}"
SEQDESK_PROFILE_CONFIG_FILE=""
SEQDESK_PROFILE_MIN_VERSION=""
# Normalized boolean feature-module switches loaded from --config or a hosted
# install profile. Keeping only this non-secret JSON lets the InstallPlan show
# and validate the exact module selection after temporary config files are gone.
SEQDESK_FEATURE_MODULES_JSON="${SEQDESK_FEATURE_MODULES_JSON:-}"
SEQDESK_PREFETCHED_VERSION_INFO=""
SEQDESK_ADDITIONAL_SETTINGS_FILE="${SEQDESK_ADDITIONAL_SETTINGS_FILE:-}"
SEQDESK_ADDITIONAL_SETTINGS=()
SEQDESK_RECONFIGURE="${SEQDESK_RECONFIGURE:-}"
SEQDESK_UPDATE_EXISTING="${SEQDESK_UPDATE_EXISTING:-}"
SEQDESK_EMPTY_TARGET="false"
SEQDESK_OVERWRITE_EXISTING="${SEQDESK_OVERWRITE_EXISTING:-}"
SEQDESK_RESEED_DB="${SEQDESK_RESEED_DB:-}"
SEQDESK_REQUIRE_CHECKSUM="${SEQDESK_REQUIRE_CHECKSUM:-}"
SEQDESK_PREFLIGHT_READ_ONLY="false"
# Network policy for every download this installer performs. Previously no curl
# invocation had a timeout at all, so a blackholed route or a captive
# institutional proxy left the installer hanging indefinitely with nothing on
# screen -- the hardest possible failure to diagnose from a bug report. The
# values are per attempt and overridable, because a ~100 MB release tarball over
# a throttled VPN legitimately needs longer than the metadata ceiling.
SEQDESK_CURL_CONNECT_TIMEOUT="${SEQDESK_CURL_CONNECT_TIMEOUT:-10}"
SEQDESK_CURL_MAX_TIME="${SEQDESK_CURL_MAX_TIME:-120}"
SEQDESK_CURL_DOWNLOAD_MAX_TIME="${SEQDESK_CURL_DOWNLOAD_MAX_TIME:-1800}"
SEQDESK_CURL_RETRIES="${SEQDESK_CURL_RETRIES:-2}"
# Miniconda source. The default is still the rolling "-latest-" installer, so
# two reviewers a month apart can get different Conda versions; pinning it needs
# the matching upstream SHA256, which is not something this script may invent.
# Until that decision is made, both halves are overridable so a site (or a
# reproducibility appendix) can name an exact build and an internal mirror.
SEQDESK_MINICONDA_BASE_URL="${SEQDESK_MINICONDA_BASE_URL:-https://repo.anaconda.com/miniconda}"
SEQDESK_MINICONDA_INSTALLER="${SEQDESK_MINICONDA_INSTALLER:-}"
SEQDESK_PREPARE_POSTGRES="${SEQDESK_PREPARE_POSTGRES:-}"
SEQDESK_PLAN_ONLY="${SEQDESK_PLAN_ONLY:-}"
SEQDESK_PLAN_JSON="${SEQDESK_PLAN_JSON:-}"
SEQDESK_EXEC_USE_SLURM="${SEQDESK_EXEC_USE_SLURM:-}"
SEQDESK_EXEC_SLURM_QUEUE="${SEQDESK_EXEC_SLURM_QUEUE:-}"
SEQDESK_EXEC_SLURM_CORES="${SEQDESK_EXEC_SLURM_CORES:-}"
SEQDESK_EXEC_SLURM_MEMORY="${SEQDESK_EXEC_SLURM_MEMORY:-}"
SEQDESK_EXEC_SLURM_TIME_LIMIT="${SEQDESK_EXEC_SLURM_TIME_LIMIT:-}"
SEQDESK_EXEC_SLURM_OPTIONS="${SEQDESK_EXEC_SLURM_OPTIONS:-}"
SEQDESK_EXEC_CONDA_PATH="${SEQDESK_EXEC_CONDA_PATH:-}"
SEQDESK_EXEC_CONDA_ENV="${SEQDESK_EXEC_CONDA_ENV:-}"
SEQDESK_EXEC_NEXTFLOW_PROFILE="${SEQDESK_EXEC_NEXTFLOW_PROFILE:-}"
SEQDESK_EXEC_WEBLOG_URL="${SEQDESK_EXEC_WEBLOG_URL:-}"
SEQDESK_EXEC_WEBLOG_SECRET="${SEQDESK_EXEC_WEBLOG_SECRET:-}"
SEQDESK_PIPELINE_DATABASE_DIR="${SEQDESK_PIPELINE_DATABASE_DIR:-}"
SEQDESK_METAXPATH_PACKAGE_URL="${SEQDESK_METAXPATH_PACKAGE_URL:-${METAXPATH_PACKAGE_URL:-}}"
SEQDESK_METAXPATH_KEY="${SEQDESK_METAXPATH_KEY:-${METAXPATH_PACKAGE_TOKEN:-}}"
SEQDESK_METAXPATH_SHA256="${SEQDESK_METAXPATH_SHA256:-${METAXPATH_PACKAGE_SHA256:-}}"
TEMP_FILE=""

SEQDESK_LOG_ENABLED="false"
PM2_CONFIGURED="false"
PM2_STARTUP_ENABLED="false"
PM2_PROCESS_EXISTS="false"
PM2_BIN=""
PM2_DISPLAY_CMD="pm2"
SEQDESK_VERIFICATION_STATUS="not-run"
CONDA_BIN_FROM_PATH=""
CONDA_DISCOVERY_SOURCE=""
CONDA_INSTALL_BASE=""
CONDA_RESOLUTION="missing"
CONDA_SKIPPED_PREFIX=""
CONDA_CONFLICT_PATH=""
MINICONDA_INSTALLER_FILE=""
MINICONDA_OUTPUT_FILE=""

MIN_NODE_VERSION="22.13.0"
NODE_SUPPORT_LABEL="22.13.0+ or 24.x"
INSTALL_START_TS=$(date +%s)
INSTALL_STARTED_AT=$(date '+%Y-%m-%d %H:%M:%S %Z')
TOTAL_STEPS=9
CURRENT_STEP=0
RESTORE_BACKUP_PATH=""
RESTORE_CURRENT_LINK_TARGET=""
INSTALL_LOCK_DIR=""
INSTALL_LOCK_HELD="false"
INSTALL_CHECKPOINT_PATH=""
INSTALL_PHASE="init"
# What the installer can actually say about the release tarball it unpacked.
# Surfaced in the final summary, because "SUCCESS" next to an unverified
# download is the one line a reviewer must not have to take on trust.
RELEASE_INTEGRITY="not applicable (no release downloaded)"
PLAN_RELEASE_VERSION=""
PLAN_RELEASE_CHECKSUM=""
PLAN_RELEASE_SIZE=""
PLAN_TARGET_CLASSIFICATION=""

print_header() {
    echo ""
    printf '%b%s%b\n' "$BOLD" "$1" "$NC"
}

print_step() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo ""
    printf '%b%d/%d %s%b\n' "$CYAN" "$CURRENT_STEP" "$TOTAL_STEPS" "$1" "$NC"
}

# Success used to be an alias of print_info, so a check that passed and a note
# about what happens next rendered identically and the output could not be
# skimmed for "did that work". Marked in the same ASCII idiom as warning/error.
print_success() {
    local message="$1"

    # Wizard sub-steps pass pre-indented text; keep their nesting intact.
    if [[ "$message" == " "* ]]; then
        printf '  %s\n' "$message"
        return 0
    fi
    printf '  %bok%b %s\n' "$GREEN" "$NC" "$message"
}

print_warning() {
    printf '  %bwarning%b %s\n' "$YELLOW" "$NC" "$1"
}

print_error() {
    printf '  %berror%b %s\n' "$RED" "$NC" "$1"
}

print_troubleshooting_url() {
    local url="${1:-https://seqdesk.org/docs/installation/common-problems}"
    echo "  Troubleshooting:"
    echo "    $url"
}

print_info() {
    print_log_line "$1"
}

print_kv() {
    printf "  %-20s %s\n" "$1" "$2"
}

# Credentials go to the terminal only. FD 3 is the original stdout, duplicated
# before output is teed into the install log, so a generated password is not
# written to a file that outlives the session. Falls back to normal output when
# there is no log (and therefore no FD 3), where losing it entirely is worse.
print_secret_kv() {
    if [ "$SEQDESK_LOG_ENABLED" = "true" ]; then
        printf "  %-20s %s\n" "$1" "$2" >&3
        return 0
    fi
    printf "  %-20s %s\n" "$1" "$2"
}

print_log_line() {
    local message="$1"
    if [[ "$message" == *": "* ]]; then
        print_kv "${message%%:*}" "${message#*: }"
    else
        printf '  %s\n' "$message"
    fi
}

# Diagnostic narration: which binary was chosen, which probe answered, why a
# candidate was rejected. It goes to the install log only, so the terminal can
# stay short while a failure still has a full trail to read. --verbose promotes
# it to the terminal.
detail() {
    local message="$*"

    if is_truthy "${SEQDESK_VERBOSE:-}"; then
        printf '  %s\n' "$message"
        return 0
    fi
    if [ "$SEQDESK_LOG_ENABLED" = "true" ]; then
        printf '  %s\n' "$message" >> "$SEQDESK_LOG" 2>/dev/null || true
    fi
}

# On failure the detail the terminal skipped is exactly what is needed, so
# replay the tail of the log rather than making the user go find it.
replay_recent_detail() {
    local lines="${1:-20}"
    local excerpt

    is_truthy "${SEQDESK_VERBOSE:-}" && return 0
    [ "$SEQDESK_LOG_ENABLED" = "true" ] || return 0

    excerpt="$(tail -n "$lines" "$SEQDESK_LOG" 2>/dev/null || true)"
    [ -n "$excerpt" ] || return 0

    echo ""
    echo "  Recent detail (full log: $SEQDESK_LOG):"
    printf '%s\n' "$excerpt" | sed 's/^/  /'
}

format_elapsed() {
    local seconds="${1:-0}"
    printf '%dm%ds' $((seconds / 60)) $((seconds % 60))
}

shell_quote() {
    printf '%q' "$1"
}

app_port() {
    printf '%s' "${SEQDESK_PORT:-8000}"
}

local_app_url() {
    printf 'http://127.0.0.1:%s' "$(app_port)"
}

browser_app_url() {
    if [ -n "${SEQDESK_NEXTAUTH_URL:-}" ]; then
        printf '%s' "$SEQDESK_NEXTAUTH_URL"
    else
        local_app_url
    fi
}

bind_host() {
    if [ -n "${SEQDESK_BIND_HOST:-}" ]; then
        printf '%s' "$SEQDESK_BIND_HOST"
        return 0
    fi

    local persisted_bind_host=""
    if [ -f "$SEQDESK_DIR/.seqdesk-bind-host" ]; then
        IFS= read -r persisted_bind_host < "$SEQDESK_DIR/.seqdesk-bind-host" || true
        persisted_bind_host="${persisted_bind_host%$'\r'}"
    fi
    printf '%s' "${persisted_bind_host:-127.0.0.1}"
}

doctor_url() {
    local_app_url
}

seqdesk_cli_command() {
    if [ -n "${SEQDESK_USER_CLI_PATH:-}" ] && [ -x "$SEQDESK_USER_CLI_PATH" ]; then
        printf '%s\n' "$SEQDESK_USER_CLI_PATH"
        return 0
    fi
    if command_exists seqdesk; then
        command -v seqdesk
        return 0
    fi
    return 1
}

print_doctor_command() {
    local cli
    cli="$(seqdesk_cli_command 2>/dev/null || printf 'seqdesk')"
    printf '  %s doctor --dir %s --url %s\n' \
        "$(shell_quote "$cli")" \
        "$(shell_quote "$SEQDESK_DIR")" \
        "$(shell_quote "$(doctor_url)")"
}

run_doctor_if_requested() {
    local cli
    if ! is_truthy "$SEQDESK_RUN_DOCTOR"; then
        SEQDESK_VERIFICATION_STATUS="skipped"
        return 0
    fi

    cli="$(seqdesk_cli_command 2>/dev/null || true)"
    if [ -z "$cli" ]; then
        SEQDESK_VERIFICATION_STATUS="unavailable"
        print_warning "seqdesk CLI not found; skipping automatic doctor run."
        return 0
    fi

    echo ""
    print_info "Running seqdesk doctor..."
    if "$cli" doctor --dir "$SEQDESK_DIR" --url "$(doctor_url)"; then
        SEQDESK_VERIFICATION_STATUS="passed"
        print_success "Doctor checks completed"
    else
        SEQDESK_VERIFICATION_STATUS="failed"
        print_warning "Doctor reported issues. Installation completed; review the checks above."
    fi
}

enable_doctor_for_persistent_service() {
    if [ "${PM2_CONFIGURED:-false}" = "true" ] && [ -z "${SEQDESK_RUN_DOCTOR:-}" ]; then
        SEQDESK_RUN_DOCTOR="1"
    fi
}

can_mirror_output_to_log() {
    ( : > >(cat >/dev/null) ) 2>/dev/null
}

# The default log used to be /tmp/seqdesk-install-<timestamp>.log, created with
# `: >` and only then chmod 600. Both halves are a problem on a shared facility
# or HPC login node: the name is guessable from the install time, and `: >`
# follows symlinks, so another local user can pre-create that path as a link and
# have an arbitrary file (possibly root-owned) truncated on their behalf.
# mktemp picks an unpredictable name and refuses to follow an existing link, and
# umask 077 makes the file private from the moment it exists rather than one
# syscall later. An explicit SEQDESK_LOG is still honoured verbatim -- CI and
# support workflows depend on naming the file -- but it too is created under the
# restrictive umask.
configure_install_log() {
    local previous_umask
    local log_dir
    local log_stamp

    exec 3>&1 || true

    previous_umask="$(umask)"
    umask 077

    if [ -z "$SEQDESK_LOG" ]; then
        log_dir="${TMPDIR:-/tmp}"
        log_dir="${log_dir%/}"
        log_stamp="$(date '+%Y%m%d-%H%M%S')"
        # A template suffix after the X's needs mktemp(1) from coreutils or BSD;
        # fall back to a bare template where it is unsupported (busybox).
        SEQDESK_LOG="$(mktemp "$log_dir/seqdesk-install-$log_stamp-XXXXXX.log" 2>/dev/null || \
            mktemp "$log_dir/seqdesk-install-$log_stamp-XXXXXX" 2>/dev/null || true)"
        if [ -z "$SEQDESK_LOG" ]; then
            umask "$previous_umask"
            print_warning "Could not create install log in $log_dir"
            return 0
        fi
    else
        mkdir -p "$(dirname "$SEQDESK_LOG")" 2>/dev/null || true
        if ! : > "$SEQDESK_LOG" 2>/dev/null; then
            umask "$previous_umask"
            print_warning "Could not create install log: $SEQDESK_LOG"
            return 0
        fi
    fi

    umask "$previous_umask"

    if ! chmod 600 "$SEQDESK_LOG" 2>/dev/null; then
        print_warning "Could not secure install log permissions; logging is disabled: $SEQDESK_LOG"
        rm -f "$SEQDESK_LOG" 2>/dev/null || true
        return 0
    fi
    SEQDESK_LOG_ENABLED="true"

    if command_exists mkfifo && command_exists tee; then
        local fifo_path
        local tee_pid
        fifo_path="${TMPDIR:-/tmp}/seqdesk-install-log-$$.fifo"
        rm -f "$fifo_path" 2>/dev/null || true
        if mkfifo "$fifo_path" 2>/dev/null; then
            tee -a "$SEQDESK_LOG" < "$fifo_path" &
            tee_pid=$!
            if exec > "$fifo_path" 2>&1; then
                rm -f "$fifo_path" 2>/dev/null || true
                return 0
            fi
            kill "$tee_pid" 2>/dev/null || true
            rm -f "$fifo_path" 2>/dev/null || true
        fi
    fi

    if can_mirror_output_to_log; then
        exec > >(tee -a "$SEQDESK_LOG") 2>&1
    else
        print_warning "Could not mirror installer output to log in this shell."
        print_info "Log: $SEQDESK_LOG"
    fi
}

spinner_supported() {
    [ "$SEQDESK_LOG_ENABLED" = "true" ] && [ -t 3 ] && [ -z "${CI:-}" ] && [ "${TERM:-}" != "dumb" ]
}

run_command_for_progress() {
    if [ "$SEQDESK_LOG_ENABLED" = "true" ]; then
        "$@" >> "$SEQDESK_LOG" 2>&1
    else
        "$@"
    fi
}

clear_progress_line() {
    printf '\r\033[K' >&3
}

run_with_progress_status() {
    local failure_level="$1"
    local label="$2"
    shift 2

    if [ "$#" -eq 0 ]; then
        return 0
    fi

    local status
    if spinner_supported; then
        local frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
        local frame_index=0
        local command_pid

        run_command_for_progress "$@" &
        command_pid=$!

        while kill -0 "$command_pid" 2>/dev/null; do
            printf '\r  %s %s' "${frames[$frame_index]}" "$label" >&3
            frame_index=$(((frame_index + 1) % ${#frames[@]}))
            sleep 0.12
        done

        if wait "$command_pid"; then
            status=0
        else
            status=$?
        fi
        clear_progress_line
    else
        print_info "$label..."
        if run_command_for_progress "$@"; then
            status=0
        else
            status=$?
        fi
    fi

    if [ "$status" -eq 0 ]; then
        print_kv "$label" "done"
        return 0
    fi

    if [ "$failure_level" = "warning" ]; then
        print_warning "$label failed"
    else
        print_error "$label failed"
    fi
    if [ "$SEQDESK_LOG_ENABLED" = "true" ]; then
        print_info "Log: $SEQDESK_LOG"
    fi
    return "$status"
}

run_with_spinner() {
    run_with_progress_status "error" "$@"
}

run_with_spinner_warn() {
    run_with_progress_status "warning" "$@"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# --- Network fetches ---------------------------------------------------------
#
# Set by curl_fetch_to_file/curl_download_to_file so a caller can say WHY a
# fetch failed. "000" as the status means curl never got a response at all
# (DNS, connect, TLS, or timeout) and its exit code is the informative part.
# curl keeps its own diagnostic on stderr (-S), which the install log captures,
# so nothing is swallowed here the way `2>/dev/null || true` used to swallow it.
CURL_LAST_HTTP_STATUS=""
CURL_LAST_STATUS="0"

curl_fetch_with_timeout() {
    local max_time="$1"
    local url="$2"
    local dest="$3"
    shift 3

    # An empty max_time means "no per-attempt ceiling"; see
    # curl_download_unbounded_to_file. The ${arr[@]+"${arr[@]}"} guard is not
    # optional: bash 3.2, which is what stock macOS ships, treats "${arr[@]}" on
    # an empty array as an unbound variable and aborts under set -u.
    local max_time_args=()
    if [ -n "$max_time" ]; then
        max_time_args=(--max-time "$max_time")
    fi

    CURL_LAST_HTTP_STATUS=""
    CURL_LAST_STATUS="0"
    CURL_LAST_HTTP_STATUS="$(curl -fsS -L -o "$dest" -w '%{http_code}' \
        --connect-timeout "$SEQDESK_CURL_CONNECT_TIMEOUT" \
        ${max_time_args[@]+"${max_time_args[@]}"} \
        --retry "$SEQDESK_CURL_RETRIES" \
        --retry-delay 2 \
        "$@" "$url")" || CURL_LAST_STATUS=$?
    return "$CURL_LAST_STATUS"
}

# Small payloads: release metadata, install profiles, --config URLs.
curl_fetch_to_file() {
    local url="$1"
    local dest="$2"
    shift 2

    curl_fetch_with_timeout "$SEQDESK_CURL_MAX_TIME" "$url" "$dest" "$@"
}

is_safe_profile_registry_url() {
    local registry_url="${1:-}"

    node - "$registry_url" <<'NODE'
const raw = process.argv[2];
let url;
try {
  url = new URL(raw);
} catch {
  process.exit(1);
}

const hostname = url.hostname.toLowerCase();
const isLoopback =
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]";

if (url.protocol === "https:" || (url.protocol === "http:" && isLoopback)) {
  process.exit(0);
}
process.exit(1);
NODE
}

# Large payloads with a bounded size: the release tarball.
curl_download_to_file() {
    local url="$1"
    local dest="$2"
    shift 2

    curl_fetch_with_timeout "$SEQDESK_CURL_DOWNLOAD_MAX_TIME" "$url" "$dest" "$@"
}

# The Miniconda installer, deliberately with no --max-time. It is ~150 MB, and
# SEQDESK_CURL_DOWNLOAD_MAX_TIME (1800 s) would abort it below roughly 85 KB/s
# on a link where the download would otherwise have finished. install.sh has
# always fetched it without a ceiling for that reason; this keeps the two
# installers on one policy. --connect-timeout still bounds an unreachable host
# and --retry still rides out a dropped connection, so a dead endpoint does not
# hang the install.
curl_download_unbounded_to_file() {
    local url="$1"
    local dest="$2"
    shift 2

    curl_fetch_with_timeout "" "$url" "$dest" "$@"
}

curl_failure_detail() {
    local detail=""

    if [ -n "$CURL_LAST_HTTP_STATUS" ] && [ "$CURL_LAST_HTTP_STATUS" != "000" ]; then
        detail="HTTP $CURL_LAST_HTTP_STATUS"
    fi
    if [ -n "$CURL_LAST_STATUS" ] && [ "$CURL_LAST_STATUS" != "0" ]; then
        if [ -n "$detail" ]; then
            detail="$detail, curl exit $CURL_LAST_STATUS"
        else
            detail="curl exit $CURL_LAST_STATUS"
        fi
    fi
    printf '%s' "$detail"
}

# A configured proxy is the most common reason a fetch fails inside an institute
# network and it is invisible in curl's own message. The proxy URL itself is
# deliberately not echoed: it routinely embeds credentials.
print_network_failure_hints() {
    if [ -n "${https_proxy:-}${HTTPS_PROXY:-}${http_proxy:-}${HTTP_PROXY:-}" ]; then
        print_info "A proxy is configured in this environment; confirm it allows the URL above."
    else
        print_info "No proxy is configured in this environment; if your site requires one, export https_proxy and retry."
    fi
    print_info "Slow link? Raise SEQDESK_CURL_MAX_TIME (small fetches) or SEQDESK_CURL_DOWNLOAD_MAX_TIME (release tarball), or SEQDESK_CURL_RETRIES."
    print_info "The Miniconda download has no time ceiling, so a slow link cannot time it out."
}

path_exists_or_symlink() {
    [ -e "$1" ] || [ -L "$1" ]
}

normalize_conda_base_path() {
    local value="$1"
    while [ "$value" != "/" ] && [[ "$value" == */ ]]; do
        value="${value%/}"
    done
    printf '%s\n' "$value"
}

absolute_conda_base_path() {
    local value
    value="$(normalize_conda_base_path "$1")"
    if [[ "$value" != /* ]]; then
        value="$PWD/${value#./}"
    fi
    normalize_conda_base_path "$value"
}

find_usable_conda_in_prefix() {
    local prefix
    local candidate

    prefix="$(normalize_conda_base_path "$1")"
    [ -n "$prefix" ] || return 1
    for candidate in "$prefix/condabin/conda" "$prefix/bin/conda"; do
        if [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

conda_base_from_command() {
    local conda_command="$1"
    local base

    base="$("$conda_command" info --base 2>/dev/null | tail -n 1)" || true
    [ -n "$base" ] || return 1
    if find_usable_conda_in_prefix "$base" >/dev/null; then
        normalize_conda_base_path "$base"
        return 0
    fi
    return 1
}

activate_conda_runtime() {
    local base="$1"
    local binary="$2"
    local source="$3"

    CONDA_BIN_FROM_PATH="$binary"
    CONDA_DISCOVERY_SOURCE="$source"
    CONDA_RESOLUTION="found"
    CONDA_INSTALL_BASE=""
    CONDA_CONFLICT_PATH=""
    CONDA_SKIPPED_PREFIX=""

    if [ -n "$base" ]; then
        SEQDESK_EXEC_CONDA_PATH="$(normalize_conda_base_path "$base")"
        export PATH="$SEQDESK_EXEC_CONDA_PATH/bin:$PATH"
    elif [[ "$binary" == */* ]]; then
        export PATH="$(dirname "$binary"):$PATH"
    fi
}

resolve_conda_runtime() {
    local configured_path="${SEQDESK_EXEC_CONDA_PATH:-}"
    local candidate_path
    local candidate_binary
    local path_binary
    local resolved_base
    local default_base="$HOME/miniconda3"
    local fallback_base="$HOME/seqdesk-miniconda3"

    CONDA_BIN_FROM_PATH=""
    CONDA_DISCOVERY_SOURCE=""
    CONDA_INSTALL_BASE=""
    CONDA_RESOLUTION="missing"
    CONDA_SKIPPED_PREFIX=""
    CONDA_CONFLICT_PATH=""

    if [ -n "$configured_path" ]; then
        configured_path="${configured_path/#\~/$HOME}"
        SEQDESK_EXEC_CONDA_PATH="$(absolute_conda_base_path "$configured_path")"
        if candidate_binary="$(find_usable_conda_in_prefix "$SEQDESK_EXEC_CONDA_PATH")"; then
            activate_conda_runtime "$SEQDESK_EXEC_CONDA_PATH" "$candidate_binary" "configured"
        elif path_exists_or_symlink "$SEQDESK_EXEC_CONDA_PATH"; then
            CONDA_RESOLUTION="invalid-configured"
            CONDA_CONFLICT_PATH="$SEQDESK_EXEC_CONDA_PATH"
        else
            CONDA_RESOLUTION="install-configured"
            CONDA_INSTALL_BASE="$SEQDESK_EXEC_CONDA_PATH"
        fi
        return 0
    fi

    if command_exists conda && conda --version >/dev/null 2>&1; then
        if resolved_base="$(conda_base_from_command conda)"; then
            candidate_binary="$(find_usable_conda_in_prefix "$resolved_base")"
            activate_conda_runtime "$resolved_base" "$candidate_binary" "PATH"
            return 0
        fi

        path_binary="$(command -v conda 2>/dev/null || true)"
        if [ -n "$path_binary" ] && [ -x "$path_binary" ]; then
            activate_conda_runtime "" "$path_binary" "PATH"
            return 0
        fi
    fi

    if [ -n "${CONDA_EXE:-}" ] && [ -x "$CONDA_EXE" ] && "$CONDA_EXE" --version >/dev/null 2>&1; then
        if resolved_base="$(conda_base_from_command "$CONDA_EXE")"; then
            candidate_binary="$(find_usable_conda_in_prefix "$resolved_base")"
            activate_conda_runtime "$resolved_base" "$candidate_binary" "CONDA_EXE"
        else
            activate_conda_runtime "" "$CONDA_EXE" "CONDA_EXE"
        fi
        return 0
    fi

    for candidate_path in \
        "$default_base" \
        "$fallback_base" \
        "$HOME/miniforge3" \
        "$HOME/mambaforge" \
        "$HOME/anaconda3"; do
        if candidate_binary="$(find_usable_conda_in_prefix "$candidate_path")"; then
            activate_conda_runtime "$candidate_path" "$candidate_binary" "standard-prefix"
            return 0
        fi
    done

    if ! path_exists_or_symlink "$default_base"; then
        CONDA_RESOLUTION="install-default"
        CONDA_INSTALL_BASE="$default_base"
        return 0
    fi

    CONDA_SKIPPED_PREFIX="$default_base"
    if ! path_exists_or_symlink "$fallback_base"; then
        CONDA_RESOLUTION="install-fallback"
        CONDA_INSTALL_BASE="$fallback_base"
        return 0
    fi

    CONDA_RESOLUTION="invalid-defaults"
    CONDA_CONFLICT_PATH="$fallback_base"
}

conda_preflight_status() {
    case "$CONDA_RESOLUTION" in
        found)
            if [ -n "$SEQDESK_EXEC_CONDA_PATH" ]; then
                printf 'found at %s (will reuse)' "$SEQDESK_EXEC_CONDA_PATH"
            else
                printf 'found on PATH (will reuse)'
            fi
            ;;
        install-default|install-configured)
            printf 'not found (will install Miniconda to %s)' "$CONDA_INSTALL_BASE"
            ;;
        install-fallback)
            printf 'will install to %s; leaving %s untouched' "$CONDA_INSTALL_BASE" "$CONDA_SKIPPED_PREFIX"
            ;;
        invalid-configured|invalid-defaults)
            printf 'unusable prefix (action required)'
            ;;
        *)
            printf 'not found'
            ;;
    esac
}

print_conda_resolution_notice() {
    case "$CONDA_RESOLUTION:$CONDA_DISCOVERY_SOURCE" in
        found:configured)
            print_info "Using configured Conda at $CONDA_BIN_FROM_PATH"
            ;;
        found:PATH|found:CONDA_EXE)
            if [ -n "$SEQDESK_EXEC_CONDA_PATH" ]; then
                print_info "Using Conda from $CONDA_DISCOVERY_SOURCE at $SEQDESK_EXEC_CONDA_PATH"
            fi
            ;;
        found:standard-prefix)
            print_info "Found Conda outside PATH at $SEQDESK_EXEC_CONDA_PATH; it will be reused."
            ;;
        install-fallback:*)
            print_warning "$CONDA_SKIPPED_PREFIX exists but is not a working Conda base."
            print_info "It will be left untouched; Miniconda will be installed to $CONDA_INSTALL_BASE."
            ;;
    esac
}

suggest_unused_conda_base() {
    local base="$HOME/seqdesk-miniconda3-new"
    local suffix=2

    while path_exists_or_symlink "$base"; do
        base="$HOME/seqdesk-miniconda3-new-$suffix"
        suffix=$((suffix + 1))
    done
    printf '%s\n' "$base"
}

print_unusable_conda_prefix_error() {
    local suggested_base
    suggested_base="$(suggest_unused_conda_base)"

    if [ "$CONDA_RESOLUTION" = "invalid-configured" ]; then
        print_error "The configured Conda base exists but does not contain a working conda executable."
        print_kv "Configured base" "$CONDA_CONFLICT_PATH"
    else
        print_error "Existing Conda target directories are present, but neither contains a working conda executable."
        print_kv "Default base" "$CONDA_SKIPPED_PREFIX"
        print_kv "Fallback base" "$CONDA_CONFLICT_PATH"
    fi

    echo "  SeqDesk will not delete, overwrite, or update these directories automatically."
    echo "  To use an existing base, verify that bin/conda or condabin/conda runs, then set"
    echo "  SEQDESK_EXEC_CONDA_PATH to that base."
    echo "  To install into a fresh base, rerun the same command with:"
    echo "    SEQDESK_EXEC_CONDA_PATH=$(shell_quote "$suggested_base") seqdesk --interactive --dir $(shell_quote "$SEQDESK_DIR")"
    echo "  Or rerun without pipeline support if Conda and Nextflow are not needed."
    print_troubleshooting_url "https://seqdesk.org/docs/installation/common-problems#miniconda-says-the-prefix-already-exists"
}

cleanup_miniconda_temp_files() {
    if [ -n "${MINICONDA_INSTALLER_FILE:-}" ]; then
        rm -f "$MINICONDA_INSTALLER_FILE" 2>/dev/null || true
        MINICONDA_INSTALLER_FILE=""
    fi
    if [ -n "${MINICONDA_OUTPUT_FILE:-}" ]; then
        rm -f "$MINICONDA_OUTPUT_FILE" 2>/dev/null || true
        MINICONDA_OUTPUT_FILE=""
    fi
}

run_miniconda_installer_capture() {
    local output_file="$1"
    shift
    local status

    if "$@" >"$output_file" 2>&1; then
        status=0
    else
        status=$?
    fi

    if [ "$SEQDESK_LOG_ENABLED" = "true" ] && [ -n "$SEQDESK_LOG" ]; then
        {
            echo ""
            echo "[Miniconda installer output]"
            sed 's/^/[Miniconda] /' "$output_file"
        } >> "$SEQDESK_LOG"
    fi
    return "$status"
}

install_miniconda_with_diagnostics() {
    local installer_file="$1"
    local install_base="$2"
    local status

    if run_with_spinner "Install Miniconda" \
        run_miniconda_installer_capture "$MINICONDA_OUTPUT_FILE" \
        bash "$installer_file" -b -p "$install_base"; then
        cleanup_miniconda_temp_files
        return 0
    else
        status=$?
    fi

    print_error "Miniconda could not install into $install_base."
    if [ -s "$MINICONDA_OUTPUT_FILE" ]; then
        print_warning "Miniconda's error output:"
        tail -n 20 "$MINICONDA_OUTPUT_FILE" | sed 's/^/    /'
    fi
    echo "  SeqDesk did not delete or replace a Conda directory that existed before this attempt."
    echo "  Miniconda may have left a partial new prefix at $install_base."
    echo "  Reuse it only if its bin/conda or condabin/conda command works; otherwise choose"
    echo "  a new unused base with SEQDESK_EXEC_CONDA_PATH."
    print_troubleshooting_url "https://seqdesk.org/docs/installation/common-problems#miniconda-says-the-prefix-already-exists"
    cleanup_miniconda_temp_files
    return "$status"
}

select_miniconda_installer() {
    local os="${1:-}"
    local arch="${2:-}"

    case "${os}:${arch}" in
        linux:x86_64|linux:amd64)
            printf '%s\n' "Miniconda3-latest-Linux-x86_64.sh"
            ;;
        linux:aarch64|linux:arm64)
            printf '%s\n' "Miniconda3-latest-Linux-aarch64.sh"
            ;;
        macos:x86_64|macos:amd64)
            printf '%s\n' "Miniconda3-latest-MacOSX-x86_64.sh"
            ;;
        macos:arm64|macos:aarch64)
            printf '%s\n' "Miniconda3-latest-MacOSX-arm64.sh"
            ;;
        *)
            return 1
            ;;
    esac
}

node_meets_minimum_version() {
    node -e '
      const parse = (value) => {
        const match = String(value).match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
        return match ? match.slice(1, 4).map((part) => Number(part || 0)) : null;
      };
      const current = parse(process.argv[2] || process.versions.node);
      const required = parse(process.argv[1]);
      if (!current || !required) process.exit(1);
      if (current[0] !== 22 && current[0] !== 24) process.exit(1);
      for (let index = 0; index < 3; index += 1) {
        if (current[index] > required[index]) process.exit(0);
        if (current[index] < required[index]) process.exit(1);
      }
      process.exit(0);
    ' "$MIN_NODE_VERSION"
}

version_at_least() {
    local current_version="${1:-}"
    local required_version="${2:-}"

    node -e '
      const parse = (value) => {
        const match = String(value).trim().match(
          /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/
        );
        return match ? match.slice(1, 4).map((part) => Number(part || 0)) : null;
      };
      const current = parse(process.argv[1]);
      const required = parse(process.argv[2]);
      if (!current || !required) process.exit(1);
      for (let index = 0; index < 3; index += 1) {
        if (current[index] > required[index]) process.exit(0);
        if (current[index] < required[index]) process.exit(1);
      }
      process.exit(0);
    ' "$current_version" "$required_version"
}

is_root_user() {
    [ "$(id -u 2>/dev/null || echo 1)" = "0" ]
}

can_run_privileged() {
    is_root_user || {
        command_exists sudo && sudo -n true >/dev/null 2>&1
    }
}

run_privileged() {
    if is_root_user; then
        "$@"
    else
        sudo -n "$@"
    fi
}

run_as_postgres() {
    # A SeqDesk-owned cluster was created by initdb as the invoking user, who is
    # therefore its superuser. Escalating to the system `postgres` account would
    # be both unnecessary and wrong — that account has no role in this cluster.
    if [ "${OS:-}" = "macos" ] || [ "${SEQDESK_PRIVATE_POSTGRES:-false}" = "true" ]; then
        "$@"
        return $?
    fi

    if is_root_user; then
        if command_exists runuser; then
            runuser -u postgres -- "$@"
        else
            sudo -n -u postgres "$@"
        fi
    else
        sudo -n -u postgres "$@"
    fi
}

is_truthy() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|y|Y) return 0 ;;
        *) return 1 ;;
    esac
}

resolve_pipeline_enablement() {
    PIPELINES_ENABLED=""

    if [ -n "$SEQDESK_WITH_PIPELINES" ]; then
        if is_truthy "$SEQDESK_WITH_PIPELINES"; then
            PIPELINES_ENABLED="true"
        else
            PIPELINES_ENABLED="false"
        fi
    elif is_truthy "$SEQDESK_WITH_CONDA"; then
        # Backward-compatible opt-in for older unattended configurations.
        PIPELINES_ENABLED="true"
    else
        # Keep a fresh install small and avoid provisioning Conda/Nextflow
        # unless the operator, profile, or existing install explicitly opts in.
        PIPELINES_ENABLED="false"
    fi
}

generate_postgres_password() {
    if command_exists openssl; then
        openssl rand -hex 16
        return 0
    fi

    if command_exists node; then
        node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))'
        return 0
    fi

    # Last resort: 16 bytes from the kernel CSPRNG, hex-encoded with od (POSIX,
    # present on both macOS and Linux). The previous fallback hashed the current
    # timestamp, which leaves only a few thousand candidates for anyone who
    # knows roughly when the install ran.
    if [ -r /dev/urandom ]; then
        dd if=/dev/urandom bs=1 count=16 2>/dev/null | od -An -tx1 | tr -d ' \n'
        return 0
    fi

    # No caller-visible message here: the caller reads this function's stdout
    # into the password, so diagnostics have to be printed there.
    return 1
}

# Percent-encode a value for use in a URL query parameter. Iterated over bytes
# (LC_ALL=C) so a home directory containing spaces or non-ASCII characters
# survives the round trip into DATABASE_URL.
url_encode_component() {
    local raw="$1"
    local out="" index char
    local LC_ALL=C

    for (( index = 0; index < ${#raw}; index++ )); do
        char="${raw:index:1}"
        case "$char" in
            [a-zA-Z0-9.~_-]) out+="$char" ;;
            *) out+="$(printf '%%%02X' "'$char")" ;;
        esac
    done
    printf '%s' "$out"
}

default_postgres_url() {
    local password="$1"
    if [ -n "${MACOS_POSTGRES_SOCKET_DIR:-}" ]; then
        printf 'postgresql://seqdesk:%s@localhost:%s/seqdesk?schema=public&host=%s' \
            "$password" \
            "${PG_PORT:-5432}" \
            "$(url_encode_component "$MACOS_POSTGRES_SOCKET_DIR")"
        return 0
    fi
    printf 'postgresql://seqdesk:%s@127.0.0.1:5432/seqdesk?schema=public' "$password"
}

is_postgres_url() {
    [[ "${1:-}" =~ ^postgres(ql)?:// ]]
}

configure_postgres_urls() {
    if [ -z "$SEQDESK_DATABASE_URL" ] && [ -n "$SEQDESK_DATABASE_DIRECT_URL" ]; then
        print_error "DIRECT_URL was supplied without DATABASE_URL."
        echo "  Supply both URLs, or omit DIRECT_URL so the generated local DATABASE_URL is used for migrations too."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#postgresql-options"
        exit 1
    fi

    if [ -z "$SEQDESK_DATABASE_URL" ]; then
        local generated_password
        # A guessable database password is worse than no install: it would be
        # written into settings.json and the DATABASE_URL and never rotated.
        if ! generated_password="$(generate_postgres_password)"; then
            print_error "Cannot generate a database password: openssl, node and /dev/urandom are all unavailable."
            print_error "Re-run with --database-url and a connection string you created yourself."
            print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#postgresql-options"
            exit 1
        fi
        SEQDESK_DATABASE_URL="$(default_postgres_url "$generated_password")"
        if [ -n "${MACOS_POSTGRES_SOCKET_DIR:-}" ]; then
            print_info "No DATABASE_URL supplied. Using local PostgreSQL through Unix socket ${MACOS_POSTGRES_SOCKET_DIR}:5432."
        else
            print_info "No DATABASE_URL supplied. Defaulting to local PostgreSQL on 127.0.0.1:5432."
        fi
        print_info "Generated local PostgreSQL credentials; the password will be stored only in the protected runtime config."
    fi

    if [[ "$SEQDESK_DATABASE_URL" == file:* ]]; then
        print_error "SQLite is no longer supported. Configure PostgreSQL via --database-url or SEQDESK_DATABASE_URL."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#postgresql-cannot-be-reached-or-migrations-fail"
        exit 1
    fi

    if ! is_postgres_url "$SEQDESK_DATABASE_URL"; then
        print_error "Unsupported DATABASE_URL. SeqDesk now only supports PostgreSQL connection strings."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#postgresql-cannot-be-reached-or-migrations-fail"
        exit 1
    fi

    if [ -z "$SEQDESK_DATABASE_DIRECT_URL" ]; then
        SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
    fi

    if [[ "$SEQDESK_DATABASE_DIRECT_URL" == file:* ]]; then
        print_error "SQLite is no longer supported for DIRECT_URL. Use a PostgreSQL connection string."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#postgresql-cannot-be-reached-or-migrations-fail"
        exit 1
    fi

    if ! is_postgres_url "$SEQDESK_DATABASE_DIRECT_URL"; then
        print_error "Unsupported DIRECT_URL. SeqDesk now only supports PostgreSQL connection strings."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#postgresql-cannot-be-reached-or-migrations-fail"
        exit 1
    fi
}

print_postgres_setup_instructions() {
    local redacted_database_url
    redacted_database_url="$(redact_database_url "$SEQDESK_DATABASE_URL")"

    if load_postgres_url_parts; then
        local installed_config_path=""
        local config_name
        for config_name in settings.json seqdesk.config.json; do
            if [ -f "$SEQDESK_DIR/$config_name" ]; then
                installed_config_path="$SEQDESK_DIR/$config_name"
                break
            fi
        done

        print_warning "Local PostgreSQL must be installed, running, and contain the SeqDesk role/database before migrations can run."
        if [ "$OS" = "macos" ]; then
            echo "  PostgreSQL setup must run as your normal macOS login user (do not use sudo)."
        else
            echo "  PostgreSQL setup must run from a sudo-capable account."
        fi

        if [ -n "$installed_config_path" ]; then
            echo "  Reuse the protected database URL stored in $(shell_quote "$installed_config_path"):"
            if [ "$OS" = "macos" ]; then
                echo "  npx -y seqdesk@latest -y --prepare-postgres --dir $(shell_quote "$SEQDESK_DIR")"
            else
                echo "  sudo npx -y seqdesk@latest -y --prepare-postgres --dir $(shell_quote "$SEQDESK_DIR")"
            fi
            echo "  Then rerun:"
            echo "  npx -y seqdesk@latest -y --reconfigure --reseed-db --dir $(shell_quote "$SEQDESK_DIR")"
        else
            echo "  No installed settings file was found in $(shell_quote "$SEQDESK_DIR")."
            echo "  This is expected when --prepare-postgres is run before a fresh install."
            echo "  After installing/starting PostgreSQL, rerun the original --prepare-postgres"
            echo "  command with SEQDESK_DATABASE_URL set in your private shell."
            echo "  The connection string is intentionally not echoed here."
            echo "  Then rerun the original SeqDesk installation command."
        fi
        echo ""
        echo "  Manual fallback:"
        case "$OS:$DISTRO" in
            macos:macos)
                if command_exists brew; then
                    echo "  brew install postgresql@16"
                    echo "  brew services start postgresql@16"
                else
                    echo "  Install PostgreSQL 14+ and start the server."
                fi
                ;;
            linux:debian)
                echo "  sudo apt-get update"
                echo "  sudo apt-get install -y postgresql postgresql-contrib"
                echo "  sudo systemctl enable --now postgresql"
                ;;
            linux:redhat)
                if command_exists dnf; then
                    echo "  sudo dnf install -y postgresql-server postgresql-contrib"
                    echo "  sudo postgresql-setup --initdb"
                    echo "  sudo systemctl enable --now postgresql"
                else
                    echo "  sudo yum install -y postgresql-server postgresql-contrib"
                    echo "  sudo postgresql-setup initdb"
                    echo "  sudo systemctl enable --now postgresql"
                fi
                ;;
            *)
                echo "  Install PostgreSQL 14+ and ensure it is reachable from this host."
                ;;
        esac
        if [ "$OS" = "macos" ]; then
            echo "  psql -d postgres <<'SQL'"
        else
            echo "  sudo -u postgres psql <<'SQL'"
        fi
        echo "  CREATE ROLE seqdesk LOGIN PASSWORD 'replace-with-password-from-DATABASE_URL';"
        echo "  CREATE DATABASE seqdesk OWNER seqdesk;"
        echo "  SQL"
        echo "  Current DATABASE_URL: ${redacted_database_url}"
    else
        # postgres_url_host returns non-zero for an empty or unparseable URL --
        # an empty DIRECT_URL is the common case, which is precisely why the
        # fallback below exists. Without the guards the first line aborts this
        # diagnosis instead of falling through to it. Same form as the call in
        # try_reuse_local_postgres_socket.
        local database_host
        database_host="$(postgres_url_host "$SEQDESK_DATABASE_DIRECT_URL" 2>/dev/null || true)"
        if [ -z "$database_host" ]; then
            database_host="$(postgres_url_host "$SEQDESK_DATABASE_URL" 2>/dev/null || true)"
        fi

        print_warning "Configured PostgreSQL is remote. The installer will not install or prepare a local database for this URL."
        echo "  Current DATABASE_URL: ${redacted_database_url}"
        if [ -n "$database_host" ]; then
            echo "  Database host: ${database_host}"
            echo "  Verify outbound TCP 5432 from this machine:"
            echo "  timeout 8 bash -lc '</dev/tcp/${database_host}/5432' && echo 'tcp ok' || echo 'tcp failed'"
        fi
        echo "  If TCP fails, ask the network administrator to allow outbound PostgreSQL access to the database host."
        echo "  If TCP succeeds, check the database credentials, Neon project status, and DIRECT_URL."
        echo "  After fixing connectivity or credentials, rerun:"
        echo "  npx -y seqdesk@latest -y --reconfigure --reseed-db --dir $(shell_quote "$SEQDESK_DIR")"
    fi
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#postgresql-cannot-be-reached-or-migrations-fail"
}

# Which of the accounts the seed is about to bootstrap already exist in the
# target database.
#
# The seed upserts bootstrap users by email with an empty update clause, so an
# account that is already in the database keeps the password it was created
# with. A password generated for this install is therefore never applied to it:
# hashing that password into settings.json and printing it in the closing
# summary hands the operator credentials that cannot sign in. Every installation
# CI leg starts from an empty database, where the create branch always runs, so
# nothing caught this until a second install adopted a database left behind by
# an earlier one.
#
# Writes one "<kind><TAB><email>" line per bootstrap address that already
# exists. Returns 0 when at least one does, 1 when none do, and 2 when the
# database could not be inspected at all (no Node, no generated Prisma client,
# no connection). A 2 must never be read as "the database is empty".
probe_existing_bootstrap_accounts() {
    command_exists node || return 2
    [ -n "${DATABASE_URL:-}" ] || return 2

    local probe_output probe_status
    probe_status=0
    probe_output="$(
        SEQDESK_PROBE_ADMIN_EMAIL="${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}" \
        SEQDESK_PROBE_RESEARCHER_EMAIL="${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-user@example.com}" \
        SEQDESK_PROBE_RESEARCHER_ENABLED="${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" \
        node --no-warnings 2>/dev/null <<'NODE'
const wanted = [];
const adminEmail = (process.env.SEQDESK_PROBE_ADMIN_EMAIL || "").trim();
const researcherEmail = (process.env.SEQDESK_PROBE_RESEARCHER_EMAIL || "").trim();
const researcherEnabled = (process.env.SEQDESK_PROBE_RESEARCHER_ENABLED || "").trim();
if (adminEmail) wanted.push(["admin", adminEmail]);
if (researcherEmail && researcherEnabled !== "0") wanted.push(["researcher", researcherEmail]);
if (wanted.length === 0) process.exit(0);

let PrismaClient;
try {
  ({ PrismaClient } = require("@prisma/client"));
} catch (error) {
  process.exit(3);
}

const prisma = new PrismaClient();
prisma.user
  .findMany({ where: { email: { in: wanted.map((entry) => entry[1]) } }, select: { email: true } })
  .then((rows) => {
    const found = rows.map((row) => row.email);
    for (const entry of wanted) {
      if (found.indexOf(entry[1]) !== -1) {
        process.stdout.write(entry[0] + "\t" + entry[1] + "\n");
      }
    }
  })
  .catch((error) => {
    // A database that never had migrations applied has no User table, and so
    // has no bootstrap accounts. That is an answer, not a failed inspection.
    if (error && error.code === "P2021") return;
    process.exitCode = 3;
  })
  .then(() => prisma.$disconnect().catch(() => {}));
NODE
    )" || probe_status=$?

    if [ "$probe_status" -ne 0 ]; then
        return 2
    fi
    if [ -z "$probe_output" ]; then
        return 1
    fi
    printf '%s\n' "$probe_output"
    return 0
}

verify_bootstrap_administrator_created() {
    command_exists node || return 1
    [ -n "${DATABASE_URL:-}" ] || return 1
    [ -n "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ] || return 1

    SEQDESK_VERIFY_ADMIN_EMAIL="$SEQDESK_BOOTSTRAP_ADMIN_EMAIL" \
    SEQDESK_VERIFY_ADMIN_PASSWORD="${SEQDESK_GENERATED_ADMIN_PASSWORD:-}" \
    node --no-warnings >/dev/null 2>&1 <<'NODE'
let PrismaClient;
try {
  ({ PrismaClient } = require("@prisma/client"));
} catch {
  process.exit(1);
}

const email = (process.env.SEQDESK_VERIFY_ADMIN_EMAIL || "").trim();
const expectedPassword = process.env.SEQDESK_VERIFY_ADMIN_PASSWORD || "";
const prisma = new PrismaClient();
prisma.user
  .findUnique({
    where: { email },
    select: { systemRole: true, isActive: true, password: true },
  })
  .then(async (user) => {
    if (!user || user.systemRole !== "ADMIN" || user.isActive !== true) {
      process.exitCode = 1;
      return;
    }
    if (expectedPassword) {
      let compare;
      try {
        ({ compare } = require("bcryptjs"));
      } catch {
        process.exitCode = 1;
        return;
      }
      if (!(await compare(expectedPassword, user.password))) process.exitCode = 1;
    }
  })
  .catch(() => {
    process.exitCode = 1;
  })
  .then(() => prisma.$disconnect().catch(() => {}));
NODE
}

# The honest report for a database that already holds SeqDesk accounts.
#
# Printed instead of -- never next to -- bootstrap credentials. Overwriting the
# password of an account that is already there is deliberately not an option:
# anyone able to run the installer could then reset the admin password of any
# database they pointed it at. So the installer says what it did and did not do,
# and leaves the existing credentials in charge.
print_adopted_bootstrap_accounts_notice() {
    local existing_accounts="$1"
    local kind email
    # The reset command is only actionable with a concrete address, so keep the
    # first account the probe reported and name that one in the example.
    local reset_email=""

    print_warning "The selected database already contains SeqDesk accounts."
    print_info "Database: $(redact_database_url "${DATABASE_URL:-}")"
    while IFS=$'\t' read -r kind email; do
        [ -n "$email" ] || continue
        [ -n "$reset_email" ] || reset_email="$email"
        print_info "Existing ${kind} account: ${email} (password left unchanged)"
    done <<ACCOUNTS
$existing_accounts
ACCOUNTS
    echo "  Sign in with the credentials this database was set up with. This install"
    echo "  neither generated nor stored a password for an account that already exists,"
    echo "  because the seed leaves such an account untouched and any password shown"
    echo "  here would not work."
    echo "  A forgotten one can be replaced for a single account, without editing the"
    echo "  database by hand:"
    echo "    npx -y seqdesk@latest reset-password ${reset_email:-admin@example.com} --dir $(shell_quote "$SEQDESK_DIR")"
    echo "  For a clean instance with new credentials, install against a different"
    echo "  database, for example:"
    echo "    --database-url \"postgresql://USER:PASSWORD@HOST:5432/seqdesk_new\""
}

# Drop every credential this install generated for an account the seed will not
# touch, so nothing downstream can advertise it. Paired with
# strip_unapplied_bootstrap_password_hashes, which does the same for the copy
# already written to settings.json.
discard_unapplied_bootstrap_credentials() {
    local existing_accounts="$1"
    local kind email

    while IFS=$'\t' read -r kind email; do
        [ -n "$email" ] || continue
        case "$kind" in
            admin)
                SEQDESK_BOOTSTRAP_ADMIN_EXISTED="true"
                SEQDESK_BOOTSTRAP_ADMIN_PASSWORD=""
                SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH=""
                SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="false"
                SEQDESK_GENERATED_ADMIN_PASSWORD=""
                ;;
            researcher)
                SEQDESK_BOOTSTRAP_RESEARCHER_EXISTED="true"
                SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD=""
                SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH=""
                SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="false"
                SEQDESK_GENERATED_RESEARCHER_PASSWORD=""
                ;;
        esac
    done <<ACCOUNTS
$existing_accounts
ACCOUNTS
}

# Remove a bootstrap passwordHash that the seed is not going to apply.
#
# settings.json has to exist before the seed runs -- it is what tells the seed
# which accounts to create -- while whether an account is already there can only
# be answered once the database is reachable, which is after that write. So the
# file is reconciled here instead of being written twice. A hash left behind for
# an account the seed leaves untouched matches nothing in the database and is
# exactly what misleads the next person debugging a failed login. Nothing has
# read the file in between: the app is not started until much later.
strip_unapplied_bootstrap_password_hashes() {
    local existing_accounts="$1"
    command_exists node || return 0

    SEQDESK_STRIP_BOOTSTRAP_ACCOUNTS="$existing_accounts" node <<'NODE' || return 0
const fs = require('fs');

const kinds = (process.env.SEQDESK_STRIP_BOOTSTRAP_ACCOUNTS || '')
  .split('\n')
  .map((line) => line.split('\t')[0].trim())
  .filter((kind) => kind === 'admin' || kind === 'researcher');
if (kinds.length === 0) process.exit(0);

const configPath = ['settings.json', 'seqdesk.config.json'].find((name) => fs.existsSync(name));
if (!configPath) process.exit(0);

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  process.exit(0);
}

const users = config && config.bootstrap && config.bootstrap.users;
if (!users || typeof users !== 'object') process.exit(0);

let changed = false;
for (const kind of kinds) {
  const user = users[kind];
  if (!user || typeof user !== 'object') continue;
  for (const key of ['password', 'passwordHash']) {
    if (Object.prototype.hasOwnProperty.call(user, key)) {
      delete user[key];
      changed = true;
    }
  }
}
if (changed) fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
NODE
}

# How many User rows the target database holds, through the same generated
# Prisma client probe_existing_bootstrap_accounts uses.
#
# "Database initialized (new, empty SeqDesk database)" used to print whenever no
# bootstrap account was found, which answers a different question. A facility
# database whose administrator is not admin@example.com has no bootstrap
# account and is still full of real data: the installer announced a new and
# empty database, added its own FACILITY_ADMIN to that data and printed its
# password. A claim about emptiness needs a row count, so the claim is made only
# when this produces one.
#
# Deliberately a separate function rather than an extra line out of
# probe_existing_bootstrap_accounts: that one is shared byte-for-byte with
# scripts/install.sh and guarded by scripts/ci/check-installer-drift.sh.
#
# Called after `migrate deploy` and before the seed, so the User table exists
# and nothing this install creates is counted yet. Prints the count and returns
# 0; returns 1 when the count could not be established, which means "unknown".
probe_database_user_count() {
    command_exists node || return 1
    [ -n "${DATABASE_URL:-}" ] || return 1

    local count
    count="$(node --no-warnings 2>/dev/null <<'NODE'
let PrismaClient;
try {
  ({ PrismaClient } = require("@prisma/client"));
} catch (error) {
  process.exit(1);
}

const prisma = new PrismaClient();
prisma.user
  .count()
  .then((count) => {
    process.stdout.write(String(count));
  })
  .catch(() => {
    // No table, no connection, no answer. Printing nothing keeps this "unknown"
    // rather than letting a failure read as an empty database.
    process.exitCode = 1;
  })
  .then(() => prisma.$disconnect().catch(() => {}));
NODE
    )" || return 1

    case "$count" in
        ''|*[!0-9]*) return 1 ;;
    esac

    printf '%s' "$count"
    return 0
}

# Reconcile what the seed can actually apply with what this install generated.
# Runs after the migrations (so the User table is there to look at) and before
# the seed, the summary, and anything else that could advertise a credential.
adopt_existing_bootstrap_accounts() {
    local existing_accounts probe_status
    probe_status=0
    existing_accounts="$(probe_existing_bootstrap_accounts)" || probe_status=$?

    case "$probe_status" in
        0)
            SEQDESK_DB_ADOPTED="true"
            discard_unapplied_bootstrap_credentials "$existing_accounts"
            strip_unapplied_bootstrap_password_hashes "$existing_accounts"
            print_adopted_bootstrap_accounts_notice "$existing_accounts"
            ;;
        1)
            detail "no bootstrap account exists in the target database yet"
            # "No bootstrap account" is not "no data". Count the rows now, while
            # the seed has not added any, so the closing summary can only call
            # this database new and empty when that is what was measured.
            SEQDESK_DB_USER_COUNT="$(probe_database_user_count)" || SEQDESK_DB_USER_COUNT=""
            ;;
        *)
            # Visible, not just logged: this install cannot yet know whether the
            # seed will create the requested accounts or leave existing rows
            # untouched. The final summary therefore withholds generated
            # credentials unless a post-seed probe proves the administrator and
            # password are usable.
            SEQDESK_DB_PROBE_FAILED="true"
            print_warning "Could not verify whether this database already contains SeqDesk accounts."
            if [ -n "${DATABASE_URL:-}" ]; then
                print_info "Database: $(redact_database_url "$DATABASE_URL")"
            fi
            echo "  If it does, the seed leaves those accounts exactly as they are. The final"
            echo "  summary will show a generated password only after verifying that it works."
            ;;
    esac
}

probe_postgres_database() {
    # Connect to DATABASE_URL with the "pg" module and report a categorized
    # failure if anything is wrong.
    #
    # "pg" is NOT a dependency of SeqDesk: it is in neither package.json nor
    # package-lock.json, nothing installs it, and the Prisma client speaks to
    # PostgreSQL through its own engine. So on a normal install the require
    # below fails, this probe reports SKIP and does nothing at all -- it only
    # runs where "pg" happens to be resolvable from the install directory.
    # Nothing user-facing may be documented as coming from here for that reason;
    # the checks the installer really performs on the target database live in
    # probe_existing_bootstrap_accounts and probe_database_user_count, which go
    # through the generated Prisma client and therefore always run.
    if [ -z "$SEQDESK_DATABASE_URL" ]; then
        return 0
    fi
    if [ -n "${MACOS_POSTGRES_SOCKET_DIR:-}" ] && \
        ! postgres_socket_owned_by_current_user "$MACOS_POSTGRES_SOCKET_DIR" "${PG_PORT:-5432}"; then
        print_selected_socket_no_longer_trusted "$MACOS_POSTGRES_SOCKET_DIR" "${PG_PORT:-5432}"
        return 1
    fi

    local probe_output probe_status
    probe_output="$(DATABASE_URL="$SEQDESK_DATABASE_URL" node --no-warnings 2>&1 <<'NODE'
async function main() {
  const url = process.env.DATABASE_URL || "";
  let pg;
  try {
    pg = require("pg");
  } catch {
    console.log("SKIP\tno-pg");
    return;
  }
  const { Client } = pg;
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000, statement_timeout: 8000 });
  try {
    await client.connect();
  } catch (error) {
    console.log("CONNECT_FAIL\t" + (error.code || "") + "\t" + (error.message || "").replace(/[\n\r\t]+/g, " "));
    return;
  }
  try {
    const meta = await client.query("SELECT current_database() AS db, current_user AS usr, current_setting('server_version') AS version");
    console.log("OK\t" + (meta.rows[0].db || "") + "\t" + (meta.rows[0].usr || "") + "\t" + (meta.rows[0].version || ""));
    // No existing-data report here. It used to count User/Order rows and print
    // "Existing SeqDesk data was detected in the selected database", which never
    // once reached a screen because "pg" is not installed -- and its absence
    // read as an all-clear. That disclosure is made after the migrations now,
    // by print_adopted_bootstrap_accounts_notice and by the row count from
    // probe_database_user_count, both over the Prisma client that is present.
    try {
      await client.query("CREATE TEMP TABLE _seqdesk_probe_temp (id INT)");
      await client.query("DROP TABLE _seqdesk_probe_temp");
      console.log("WRITE_OK");
    } catch (error) {
      console.log("WRITE_FAIL\t" + (error.code || "") + "\t" + (error.message || "").replace(/[\n\r\t]+/g, " "));
    }
  } catch (error) {
    console.log("QUERY_FAIL\t" + (error.code || "") + "\t" + (error.message || "").replace(/[\n\r\t]+/g, " "));
  } finally {
    try { await client.end(); } catch {}
  }
}
main().catch((error) => console.log("UNCAUGHT\t\t" + (error.message || "").replace(/[\n\r\t]+/g, " ")));
NODE
)"
    probe_status=$?

    # If node itself failed (e.g. node not found, syntax error), bail out gracefully
    # so we don't block migrations on a broken probe.
    if [ "$probe_status" -ne 0 ] && [ -z "$probe_output" ]; then
        return 0
    fi

    local first_line
    first_line="$(printf '%s\n' "$probe_output" | head -n 1)"

    case "$first_line" in
        SKIP*)
            detail "PostgreSQL preflight probe skipped: the 'pg' module is not installed (it is not a SeqDesk dependency)"
            return 0
            ;;
        OK*)
            local database_name database_role database_version
            IFS=$'\t' read -r _ database_name database_role database_version <<< "$first_line"
            print_kv "PostgreSQL server" "${database_version:-unknown} (${database_name:-unknown} as ${database_role:-unknown})"

            if printf '%s\n' "$probe_output" | grep -q "^WRITE_OK$"; then
                return 0
            fi
            local write_line
            write_line="$(printf '%s\n' "$probe_output" | grep "^WRITE_FAIL" | head -n 1)"
            print_error "PostgreSQL connection succeeded, but the role cannot create tables in the database."
            postgres_probe_print_grant_hint "$write_line"
            return 1
            ;;
        CONNECT_FAIL*|QUERY_FAIL*|UNCAUGHT*)
            postgres_probe_print_failure "$probe_output"
            return 1
            ;;
        *)
            print_error "PostgreSQL connection probe returned an unexpected result:"
            printf '%s\n' "$probe_output" | sed 's/^/  /'
            return 1
            ;;
    esac
}

postgres_probe_print_grant_hint() {
    local write_line="$1"
    local redacted
    redacted="$(redact_database_url "$SEQDESK_DATABASE_URL")"
    if printf '%s' "$write_line" | grep -qi "permission denied"; then
        echo "  The role connected but cannot CREATE in the public schema."
        echo "  Ask a privileged DB user (e.g. the database superuser) to run:"
        echo "    GRANT ALL ON SCHEMA public TO <role>;"
        echo "    GRANT ALL ON DATABASE <db> TO <role>;"
    else
        echo "  Probe write step failed: $write_line"
    fi
    echo "  Current DATABASE_URL: ${redacted}"
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#postgresql-cannot-be-reached-or-migrations-fail"
}

postgres_probe_print_failure() {
    local probe_output="$1"
    local redacted
    redacted="$(redact_database_url "$SEQDESK_DATABASE_URL")"
    local lower
    lower="$(printf '%s' "$probe_output" | tr '[:upper:]' '[:lower:]')"

    if printf '%s' "$lower" | grep -q "econnrefused"; then
        print_error "PostgreSQL refused the connection (ECONNREFUSED)."
        echo "  Host responded but nothing is listening on the configured port. Verify"
        echo "  the port number, that PostgreSQL is running, and that pg_hba.conf permits"
        echo "  connections from this machine."
    elif printf '%s' "$lower" | grep -q "etimedout\|econnreset\|enetunreach\|ehostunreach"; then
        print_error "Network timeout / unreachable when reaching the PostgreSQL host."
        echo "  Check firewall rules, that outbound TCP to this host:port is allowed,"
        echo "  and that the host has not gone away."
    elif printf '%s' "$lower" | grep -q "enotfound"; then
        print_error "Cannot resolve the PostgreSQL hostname (DNS)."
        echo "  Inspect /etc/resolv.conf and try: getent hosts <host>"
    elif printf '%s' "$lower" | grep -q "password authentication failed\|28p01"; then
        print_error "PostgreSQL rejected the password (28P01)."
        echo "  Confirm the credentials and URL-encode any of @ : / ? # & in the password."
    elif printf '%s' "$lower" | grep -q '3d000\|database ".*" does not exist'; then
        print_error "The PostgreSQL database does not exist on the server."
        echo "  Ask a privileged DB user to run:"
        echo "    CREATE DATABASE <name> OWNER <role>;"
    elif printf '%s' "$lower" | grep -q 'role ".*" does not exist'; then
        print_error "The PostgreSQL role does not exist on the server."
        echo "  Ask a privileged DB user to run:"
        echo "    CREATE ROLE <name> LOGIN PASSWORD '<password>';"
    elif printf '%s' "$lower" | grep -q "no pg_hba.conf entry"; then
        print_error "PostgreSQL rejected the connection (pg_hba.conf entry missing)."
        echo "  The DB admin must allow this host's IP in pg_hba.conf and reload."
    elif printf '%s' "$lower" | grep -q "ssl required\|sslmode"; then
        print_error "PostgreSQL requires SSL but the connection string does not request it."
        echo "  Append '?sslmode=require' (or '?sslmode=verify-full' with a CA) to DATABASE_URL."
    else
        print_error "PostgreSQL connection probe failed:"
        printf '%s\n' "$probe_output" | sed 's/^/  /'
    fi
    echo "  Current DATABASE_URL: ${redacted}"
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#postgresql-cannot-be-reached-or-migrations-fail"
}

load_postgres_url_parts() {
    local temp_env
    temp_env="$(mktemp)"
    if ! DATABASE_URL="$SEQDESK_DATABASE_URL" node >"$temp_env" <<'NODE'
const raw = process.env.DATABASE_URL || "";
function shell(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
try {
  const url = new URL(raw);
  const protocol = url.protocol.replace(/:$/, "");
  if (protocol !== "postgres" && protocol !== "postgresql") process.exit(2);
  const socketHost = url.searchParams.get("host") || "";
  const host = socketHost.startsWith("/") ? socketHost : (url.hostname || "127.0.0.1");
  if (!host.startsWith("/") && !["127.0.0.1", "localhost", "::1"].includes(host)) process.exit(2);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "seqdesk";
  const user = decodeURIComponent(url.username || "seqdesk");
  const password = decodeURIComponent(url.password || "");
  const port = url.port || "5432";
  process.stdout.write([
    "PG_HOST=" + shell(host),
    "PG_PORT=" + shell(port),
    "PG_USER_NAME=" + shell(user),
    "PG_PASSWORD_VALUE=" + shell(password),
    "PG_DATABASE_NAME=" + shell(database),
  ].join("\n"));
} catch {
  process.exit(2);
}
NODE
    then
        rm -f "$temp_env"
        return 1
    fi

    # shellcheck disable=SC1090
    source "$temp_env"
    rm -f "$temp_env"
    return 0
}

postgres_url_host() {
    local raw_url="${1:-}"
    if [ -z "$raw_url" ]; then
        return 1
    fi

    DATABASE_URL="$raw_url" node <<'NODE'
const raw = process.env.DATABASE_URL || "";
try {
  const url = new URL(raw);
  const protocol = url.protocol.replace(/:$/, "");
  if (protocol !== "postgres" && protocol !== "postgresql") process.exit(2);
  const socketHost = url.searchParams.get("host") || "";
  process.stdout.write(socketHost.startsWith("/") ? socketHost : (url.hostname || ""));
} catch {
  process.exit(2);
}
NODE
}

postgres_url_host_port() {
    # Print "host<TAB>port" for a postgres URL, or nothing if unparseable.
    local raw_url="${1:-}"
    if [ -z "$raw_url" ]; then
        return 1
    fi

    DATABASE_URL="$raw_url" node <<'NODE'
const raw = process.env.DATABASE_URL || "";
try {
  const url = new URL(raw);
  const protocol = url.protocol.replace(/:$/, "");
  if (protocol !== "postgres" && protocol !== "postgresql") process.exit(2);
  const socketHost = url.searchParams.get("host") || "";
  const host = socketHost.startsWith("/") ? socketHost : (url.hostname || "");
  if (!host) process.exit(2);
  const port = url.port || "5432";
  process.stdout.write(host + "\t" + port);
} catch {
  process.exit(2);
}
NODE
}

db_tcp_reachable() {
    # Bounded TCP connect to host:port. Returns 0 if reachable, 1 if not.
    local host="$1"
    local port="$2"
    DB_TCP_HOST="$host" DB_TCP_PORT="$port" node <<'NODE' >/dev/null 2>&1
const net = require("net");
const host = process.env.DB_TCP_HOST || "";
const port = Number(process.env.DB_TCP_PORT || "");
if (!host || !Number.isInteger(port) || port < 1 || port > 65535) process.exit(1);
const socket = net.createConnection({ host, port });
const timer = setTimeout(() => socket.destroy(new Error("timeout")), 8000);
socket.once("connect", () => {
  clearTimeout(timer);
  socket.destroy();
  process.exit(0);
});
socket.once("error", () => {
  clearTimeout(timer);
  process.exit(1);
});
NODE
}

postgres_connection_ready() {
    local psql_bin
    psql_bin="$(find_postgres_binary psql 2>/dev/null || true)"
    if [ -z "$psql_bin" ]; then
        return 1
    fi

    PGCONNECT_TIMEOUT=5 PGPASSWORD="${PG_PASSWORD_VALUE:-}" "$psql_bin" \
        -X -w \
        -h "${PG_HOST:-127.0.0.1}" \
        -p "${PG_PORT:-5432}" \
        -U "${PG_USER_NAME:-seqdesk}" \
        -d "${PG_DATABASE_NAME:-seqdesk}" \
        -qAt -c "select 1" >/dev/null 2>&1
}

postgres_server_ready() {
    local pg_isready_bin
    pg_isready_bin="$(find_postgres_binary pg_isready 2>/dev/null || true)"
    if [ -n "$pg_isready_bin" ]; then
        "$pg_isready_bin" \
            -h "${PG_HOST:-127.0.0.1}" \
            -p "${PG_PORT:-5432}" >/dev/null 2>&1
        return $?
    fi

    # pg_isready is supplied by every supported PostgreSQL package. This TCP
    # fallback is only for an externally managed local server with client tools
    # absent from PATH; credential validation still happens before migrations.
    db_tcp_reachable "${PG_HOST:-127.0.0.1}" "${PG_PORT:-5432}"
}

postgres_socket_server_ready() {
    local socket_dir="${1:-/tmp}"
    local socket_port="${2:-5432}"
    local pg_isready_bin

    [[ "$socket_dir" == /* ]] || return 1
    pg_isready_bin="$(find_postgres_binary pg_isready 2>/dev/null || true)"
    [ -n "$pg_isready_bin" ] || return 1
    "$pg_isready_bin" -h "$socket_dir" -p "$socket_port" >/dev/null 2>&1
}

postgres_socket_owned_by_current_user() {
    local socket_dir="${1:-/tmp}"
    local socket_port="${2:-5432}"
    local socket_file socket_uid current_uid

    [[ "$socket_dir" == /* ]] || return 1
    socket_file="${socket_dir%/}/.s.PGSQL.${socket_port}"
    [ -S "$socket_file" ] || return 1

    socket_uid="$(stat -f '%u' "$socket_file" 2>/dev/null || true)"
    if ! [[ "$socket_uid" =~ ^[0-9]+$ ]]; then
        socket_uid="$(stat -c '%u' "$socket_file" 2>/dev/null || true)"
    fi
    current_uid="$(id -u 2>/dev/null || true)"
    [[ "$socket_uid" =~ ^[0-9]+$ ]] || return 1
    [[ "$current_uid" =~ ^[0-9]+$ ]] || return 1
    [ "$socket_uid" = "$current_uid" ]
}

# Not fatal. SeqDesk declines to send generated credentials to a server it does
# not own, but declining is not a reason to stop: the ladder continues, and the
# usual outcome is a private instance the user does own. Stopping here would
# break every Linux host whose system PostgreSQL listens only on
# /var/run/postgresql, which is owned by the postgres account rather than the
# person running the installer.
print_untrusted_postgres_socket() {
    local socket_dir="${1:-/tmp}"
    local socket_port="${2:-5432}"
    local owner="unknown"
    local socket_file="${socket_dir%/}/.s.PGSQL.${socket_port}"

    if [ -S "$socket_file" ]; then
        owner="$(stat -f '%Su' "$socket_file" 2>/dev/null || stat -c '%U' "$socket_file" 2>/dev/null || echo unknown)"
    fi

    print_warning "PostgreSQL answered through ${socket_dir}:${socket_port}, but that socket belongs to '${owner}', not $(id -un)."
    echo "  SeqDesk will not send generated database credentials to a server it does not own,"
    echo "  so it is skipping this one. To use it instead, rerun as '${owner}' or pass"
    echo "  --database-url \"postgresql://...\" naming it explicitly."
}

# The fatal variant, for when the socket was already selected and is about to be
# used. Ownership changing between selection and use means something moved
# underneath the install, which is not something to continue through.
print_selected_socket_no_longer_trusted() {
    local socket_dir="${1:-/tmp}"
    local socket_port="${2:-5432}"

    print_error "The selected PostgreSQL socket ${socket_dir}:${socket_port} is no longer owned by $(id -un)."
    echo "  SeqDesk will not send generated database credentials to it."
    echo "  Rerun the installer as the account that owns that server, or pass"
    echo "  --database-url \"postgresql://...\" to name a database explicitly."
    print_troubleshooting_url "https://seqdesk.org/docs/installation/macos#seqdesk-manages-its-own-postgresql"
}

postgres_socket_admin_ready() {
    local socket_dir="${1:-/tmp}"
    local socket_port="${2:-5432}"
    local psql_bin version_num

    [[ "$socket_dir" == /* ]] || return 1
    psql_bin="$(find_postgres_binary psql 2>/dev/null || true)"
    [ -n "$psql_bin" ] || return 1

    version_num="$(PGCONNECT_TIMEOUT=5 run_as_postgres "$psql_bin" \
        -X \
        -h "$socket_dir" \
        -p "$socket_port" \
        -w -d postgres -qAt -c \
        "select current_setting('server_version_num') from pg_roles where rolname = current_user and rolsuper" \
        2>/dev/null | \
        tr -d '[:space:]')" || return 1
    [[ "$version_num" =~ ^[0-9]+$ ]] || return 1
    [ "$version_num" -ge 140000 ]
}

select_macos_postgres_socket() {
    local socket_dir="${1:-/tmp}"
    local socket_port="${2:-5432}"

    MACOS_POSTGRES_SOCKET_DIR="$socket_dir"
    PG_HOST="$socket_dir"
    PG_PORT="$socket_port"
    print_success "Reusing PostgreSQL via Unix socket ${socket_dir}:${socket_port}; no PostgreSQL service configuration changed."
}

# --- Private, SeqDesk-managed PostgreSQL -------------------------------------
#
# A private instance is a cluster SeqDesk creates and owns, instead of asking
# the machine's shared server for a seat. It answers on a Unix socket only,
# lives under $HOME, and is started with pg_ctl rather than a launchd or
# systemd service. That removes every failure mode which comes from
# negotiating with somebody else's server: an occupied port 5432, a Homebrew
# service registered to root, a login user without CREATE ROLE on the existing
# cluster, pg_hba rules, and loopback TCP filtered by endpoint-security tools.
#
# It is deliberately NOT the first choice: a healthy local server the installer
# can administer is still reused untouched. This is the fallback that makes a
# fresh reviewer machine work without asking anyone to repair anything.

# macOS caps a Unix socket path (sun_path) at 104 bytes and PostgreSQL appends
# "/.s.PGSQL.<port>" to the directory, so the directory itself must stay short.
PRIVATE_PG_MAX_SOCKET_DIR_LEN=85

# The one port the private instance ever uses. It is pinned in the cluster's own
# postgresql.conf, not merely assumed, because `port` falls back to the PGPORT
# environment variable: a user with PGPORT exported got a socket named
# .s.PGSQL.<their port> while the generated DATABASE_URL still said 5432, and
# the install then aborted with no indication why. Everything that writes the
# URL reads this constant, so the port in settings.json is the port in use.
PRIVATE_PG_PORT="5432"

# libpq variables that silently redirect the private cluster's own tooling.
# PGPORT changes the socket the postmaster creates and PGHOST changes where
# pg_ctl looks for it; neither has any business influencing a cluster SeqDesk
# creates, owns and addresses by explicit path. Stripped from every initdb,
# pg_ctl and status call rather than trusted to be unset.
private_postgres_env() {
    env -u PGPORT -u PGHOST -u PGDATA LC_ALL=C LANG=C "$@"
}

private_postgres_root() {
    printf '%s' "${SEQDESK_PG_HOME:-$HOME/.seqdesk/postgres}"
}

private_postgres_data_dir() {
    printf '%s/data' "$(private_postgres_root)"
}

private_postgres_socket_dir() {
    printf '%s/socket' "$(private_postgres_root)"
}

private_postgres_log_file() {
    printf '%s/server.log' "$(private_postgres_root)"
}

private_postgres_socket_dir_usable() {
    local socket_dir="${1:-$(private_postgres_socket_dir)}"
    [ "${#socket_dir}" -le "$PRIVATE_PG_MAX_SOCKET_DIR_LEN" ]
}

# A cluster exists once initdb has written its PG_VERSION stamp. An empty or
# half-written directory is treated as absent so a failed attempt can be retried.
private_postgres_initialized() {
    local data_dir="${1:-$(private_postgres_data_dir)}"
    [ -s "$data_dir/PG_VERSION" ]
}

# Normalised to 0/1. pg_ctl status distinguishes "not running" (3) from
# "unusable data directory" (4), but every caller only asks whether it can
# connect, and leaking those codes makes `return $?` chains hard to read.
private_postgres_running() {
    local data_dir="${1:-$(private_postgres_data_dir)}"
    local pg_ctl_bin
    pg_ctl_bin="$(find_postgres_binary pg_ctl 2>/dev/null || true)"
    [ -n "$pg_ctl_bin" ] || return 1
    if private_postgres_env "$pg_ctl_bin" -D "$data_dir" status >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

# Only used to restart a cluster whose configuration had to be repaired, so a
# fast shutdown (roll back open transactions, do not wait for clients) is right.
private_postgres_stop() {
    local data_dir="${1:-$(private_postgres_data_dir)}"
    local pg_ctl_bin

    pg_ctl_bin="$(find_postgres_binary pg_ctl 2>/dev/null || true)"
    [ -n "$pg_ctl_bin" ] || return 1
    private_postgres_env "$pg_ctl_bin" -D "$data_dir" -m fast -w stop >/dev/null 2>&1
}

# The block SeqDesk owns in the cluster's postgresql.conf is delimited so it can
# be replaced. Earlier installers appended it with no end marker, so a repair
# used to append a second copy: PostgreSQL honours the last occurrence of a
# setting, which left a stale, contradictory copy in the file that nobody would
# find until they read it.
PRIVATE_PG_CONFIG_BEGIN="# --- SeqDesk-managed private instance ---"
PRIVATE_PG_CONFIG_END="# --- end SeqDesk-managed private instance ---"

# Print $1 with any block SeqDesk previously wrote removed. A block written
# before the end marker existed is unterminated; every version of it is a
# contiguous run of comments and the four settings it owns, so it ends at the
# first blank line or at the first line that is neither -- which keeps whatever
# an operator appended after it. Blank lines are held back and only emitted
# before real content, so repeated rewrites cannot grow a run of empty lines
# where the block used to be.
private_postgres_strip_config() {
    local conf_file="$1"

    awk -v begin_marker="$PRIVATE_PG_CONFIG_BEGIN" -v end_marker="$PRIVATE_PG_CONFIG_END" '
        !inside && $0 == begin_marker { blanks = 0; inside = 1; next }
        inside && $0 == end_marker { inside = 0; next }
        inside {
            if ($0 ~ /^[[:space:]]*$/) {
                inside = 0
            } else if ($0 ~ /^[[:space:]]*#/) {
                next
            } else if ($0 ~ /^[[:space:]]*(listen_addresses|unix_socket_directories|unix_socket_permissions|port)[[:space:]]*=/) {
                next
            } else {
                inside = 0
            }
        }
        /^[[:space:]]*$/ { blanks++; next }
        {
            while (blanks > 0) {
                print ""
                blanks--
            }
            print
        }
    ' "$conf_file"
}

# Both the config and the HBA file are written by SeqDesk rather than patched,
# so the resulting cluster is identical on every machine and auditable in one
# place. listen_addresses='' means the server never opens a TCP socket at all.
# Writing goes through a temporary file in the same directory and one rename, so
# an interrupted repair can never leave a truncated postgresql.conf behind.
private_postgres_write_config() {
    local data_dir="$1"
    local socket_dir="$2"
    local conf_file="$data_dir/postgresql.conf"
    local tmp_file

    [ -f "$conf_file" ] || return 1

    tmp_file="$(mktemp "$data_dir/postgresql.conf.seqdesk.XXXXXX" 2>/dev/null)" || return 1
    if ! private_postgres_strip_config "$conf_file" > "$tmp_file" 2>/dev/null; then
        rm -f "$tmp_file" 2>/dev/null || true
        return 1
    fi

    cat >> "$tmp_file" <<CONF

$PRIVATE_PG_CONFIG_BEGIN
# Unix socket only: no TCP listener is opened, on any interface or port.
listen_addresses = ''
unix_socket_directories = '$socket_dir'
unix_socket_permissions = 0700
# Pinned so an inherited PGPORT cannot move the socket out from under the
# DATABASE_URL that names this instance.
port = $PRIVATE_PG_PORT
$PRIVATE_PG_CONFIG_END
CONF

    chmod 600 "$tmp_file" 2>/dev/null || true
    if ! mv "$tmp_file" "$conf_file"; then
        rm -f "$tmp_file" 2>/dev/null || true
        return 1
    fi
}

# Whether a cluster has actually received the configuration above, as opposed to
# merely having been created by initdb. listen_addresses is the one line that
# makes the instance private: without it the cluster still has PostgreSQL's
# defaults -- a socket in /tmp and TCP listeners on 127.0.0.1 and [::1] -- while
# looking, to a PG_VERSION check, fully provisioned. Missing it means the
# cluster has to be stopped, reconfigured and restarted.
private_postgres_configured() {
    local data_dir="${1:-$(private_postgres_data_dir)}"

    [ -f "$data_dir/postgresql.conf" ] || return 1
    grep -q "^listen_addresses = ''" "$data_dir/postgresql.conf"
}

# The pinned port is a later addition, so every cluster the already-published
# installer created is missing it while being otherwise correct and healthy.
# That is a retrofit, not a half-provisioned cluster, and it is deliberately NOT
# part of private_postgres_configured: treating it as half provisioned would
# stop a working database, and appending the block a second time, on every
# single re-run of install or --reconfigure.
private_postgres_port_pinned() {
    local data_dir="${1:-$(private_postgres_data_dir)}"

    [ -f "$data_dir/postgresql.conf" ] || return 1
    grep -q "^port = $PRIVATE_PG_PORT\$" "$data_dir/postgresql.conf"
}

# Peer authentication for the owning OS user keeps administration passwordless
# (and impossible for anyone else), while the application role authenticates
# with scram. Every host line is rejected because no TCP listener exists.
private_postgres_write_hba() {
    local data_dir="$1"
    local owner="$2"

    cat > "$data_dir/pg_hba.conf" <<HBA
# Written by the SeqDesk installer. The socket directory is mode 0700, so the
# owning OS user is the only account that can reach this cluster at all.
local   all   $owner   peer
local   all   all      scram-sha-256
host    all   all      all             reject
hostssl all   all      all             reject
HBA
    chmod 600 "$data_dir/pg_hba.conf"
}

private_postgres_start() {
    local data_dir="${1:-$(private_postgres_data_dir)}"
    local log_file="${2:-$(private_postgres_log_file)}"
    local pg_ctl_bin

    pg_ctl_bin="$(find_postgres_binary pg_ctl 2>/dev/null || true)"
    [ -n "$pg_ctl_bin" ] || return 1
    private_postgres_env "$pg_ctl_bin" -D "$data_dir" -l "$log_file" -w start >/dev/null 2>&1
}

# initdb reads LC_* from the environment and aborts with "invalid locale
# settings" when they are unset or unusable. A `curl … | bash` shell routinely
# has no LANG at all, so pin both the environment and the cluster's own locale
# rather than inheriting whatever the terminal happened to export.
private_postgres_initdb() {
    local data_dir="$1"
    local owner="$2"
    local initdb_bin

    initdb_bin="$(find_postgres_binary initdb 2>/dev/null || true)"
    [ -n "$initdb_bin" ] || return 1
    private_postgres_env "$initdb_bin" \
        -D "$data_dir" \
        --username="$owner" \
        --encoding=UTF8 \
        --lc-collate=C \
        --lc-ctype=C \
        --auth-local=peer \
        --auth-host=reject >/dev/null 2>&1
}

select_private_postgres() {
    local socket_dir="$1"

    SEQDESK_PRIVATE_POSTGRES="true"
    MACOS_POSTGRES_SOCKET_DIR="$socket_dir"
    PG_HOST="$socket_dir"
    # Same constant the cluster's postgresql.conf pins, so the port recorded in
    # settings.json is by construction the port the instance actually listens on.
    PG_PORT="$PRIVATE_PG_PORT"
}

print_private_postgres_start_failure() {
    local log_file="$1"
    local excerpt

    print_error "The SeqDesk PostgreSQL instance did not start."
    if [ -r "$log_file" ]; then
        excerpt="$(tail -n 5 "$log_file" 2>/dev/null || true)"
        if [ -n "$excerpt" ]; then
            printf '%s\n' "$excerpt" | sed 's/^/  /'
        fi
    fi
    echo "  Its data directory and log are under $(private_postgres_root)."
    echo "  Nothing outside that directory was modified."
    print_troubleshooting_url "https://seqdesk.org/docs/installation/macos#seqdesk-manages-its-own-postgresql"
}

# Create (or adopt) the private cluster and point the installer at it. Safe to
# re-run: an existing cluster is started rather than rebuilt, so reinstalling
# SeqDesk never destroys data.
provision_private_postgres() {
    local root data_dir socket_dir log_file owner

    root="$(private_postgres_root)"
    data_dir="$(private_postgres_data_dir)"
    socket_dir="$(private_postgres_socket_dir)"
    log_file="$(private_postgres_log_file)"
    owner="$(id -un 2>/dev/null || true)"

    if [ -z "$owner" ]; then
        print_error "Could not determine the current user name for the PostgreSQL cluster owner."
        return 1
    fi

    # PostgreSQL refuses to start as root, so a cluster owned by root is
    # unusable. This is reachable on Linux, where the installer may be run under
    # sudo; fail with the reason rather than letting initdb error obscurely.
    if is_root_user; then
        print_error "SeqDesk will not create a PostgreSQL instance owned by root."
        echo "  PostgreSQL refuses to run as root, so the instance could never start."
        echo "  Rerun the installer as your normal user account, or supply an existing"
        echo "  database with --database-url \"postgresql://...\"."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#postgresql-options"
        return 1
    fi

    if ! private_postgres_socket_dir_usable "$socket_dir"; then
        print_error "The SeqDesk PostgreSQL socket path is too long for this system."
        echo "  ${socket_dir} (${#socket_dir} characters, limit ${PRIVATE_PG_MAX_SOCKET_DIR_LEN})"
        echo "  Set SEQDESK_PG_HOME to a shorter path and retry, for example:"
        echo "    SEQDESK_PG_HOME=/tmp/seqdesk-pg-$(id -u)"
        return 1
    fi

    if [ -z "$(find_postgres_binary initdb 2>/dev/null || true)" ] || \
        [ -z "$(find_postgres_binary pg_ctl 2>/dev/null || true)" ]; then
        print_error "PostgreSQL server programs (initdb, pg_ctl) were not found."
        echo "  SeqDesk installs its own PostgreSQL instance and needs the server package,"
        echo "  not only the client tools."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#macos-prerequisites"
        return 1
    fi

    if ! mkdir -p "$socket_dir" 2>/dev/null; then
        print_error "Could not create the PostgreSQL directory ${socket_dir}."
        return 1
    fi
    chmod 700 "$root" "$socket_dir" 2>/dev/null || true

    if private_postgres_initialized "$data_dir"; then
        # PG_VERSION alone does not mean "provisioned". If a previous run was
        # interrupted between initdb and the config write, the cluster is still
        # running PostgreSQL's defaults: a socket in /tmp and TCP listeners on
        # 127.0.0.1 and [::1] -- the exact opposite of the socket-only guarantee
        # this instance is documented to provide. Adopting that as a success made
        # the mismatch invisible and left retrying useless. Complete it instead,
        # stopping first so the corrected settings actually take effect.
        if ! private_postgres_configured "$data_dir"; then
            print_warning "The SeqDesk PostgreSQL instance in ${data_dir} is only half provisioned; completing it."
            echo "  It was created but never received SeqDesk's socket-only configuration."
            if private_postgres_running "$data_dir" && \
                ! run_with_spinner "Stop half-provisioned SeqDesk PostgreSQL" private_postgres_stop "$data_dir"; then
                print_error "Could not stop the half-provisioned instance in ${data_dir} to repair it."
                echo "  Stop it manually with: pg_ctl -D $(shell_quote "$data_dir") -m fast stop"
                echo "  then re-run the installer."
                return 1
            fi
            if ! private_postgres_write_config "$data_dir" "$socket_dir" || \
                ! private_postgres_write_hba "$data_dir" "$owner"; then
                print_error "Could not write the PostgreSQL configuration in ${data_dir}."
                echo "  The instance stays half provisioned until this succeeds. Check the directory"
                echo "  permissions, or supply an existing database with --database-url \"postgresql://...\"."
                return 1
            fi
            print_success "Repaired the configuration of the SeqDesk PostgreSQL instance."
        elif ! private_postgres_port_pinned "$data_dir"; then
            # A healthy cluster from an installer that predates the pinned port.
            # Rewriting the managed block in place adds the line without a
            # restart; the running server keeps the port it already has until it
            # is next restarted, which is why nothing is stopped here. Failing
            # to write it is not fatal either -- the cluster is usable as it is.
            if private_postgres_write_config "$data_dir" "$socket_dir"; then
                detail "pinned port $PRIVATE_PG_PORT in ${data_dir}/postgresql.conf; the running instance was left alone"
            else
                print_warning "Could not pin the PostgreSQL port in ${data_dir}/postgresql.conf; continuing with the instance as it is."
            fi
            # The DATABASE_URL names this exact socket file, so if the running
            # server is on some other port (an inherited PGPORT at the time it
            # was started -- the reason the pin exists), say so instead of
            # handing out a URL that cannot connect.
            if private_postgres_running "$data_dir" && \
                [ ! -S "$socket_dir/.s.PGSQL.$PRIVATE_PG_PORT" ]; then
                print_warning "The running SeqDesk PostgreSQL instance is not on port ${PRIVATE_PG_PORT}."
                echo "  The pinned port applies at its next restart:"
                echo "    pg_ctl -D $(shell_quote "$data_dir") -m fast restart"
            fi
        fi

        if private_postgres_running "$data_dir"; then
            select_private_postgres "$socket_dir"
            print_success "Using the existing SeqDesk PostgreSQL instance in ${root}."
            return 0
        fi
        if ! run_with_spinner "Start SeqDesk PostgreSQL" private_postgres_start "$data_dir" "$log_file"; then
            print_private_postgres_start_failure "$log_file"
            return 1
        fi
        select_private_postgres "$socket_dir"
        return 0
    fi

    if ! run_with_spinner "Create SeqDesk PostgreSQL" private_postgres_initdb "$data_dir" "$owner"; then
        print_error "Could not create the SeqDesk PostgreSQL instance in ${data_dir}."
        echo "  Remove that directory and retry, or supply an existing database with"
        echo "  --database-url \"postgresql://...\"."
        return 1
    fi

    if ! private_postgres_write_config "$data_dir" "$socket_dir" || \
        ! private_postgres_write_hba "$data_dir" "$owner"; then
        print_error "Could not write the PostgreSQL configuration in ${data_dir}."
        return 1
    fi

    if ! run_with_spinner "Start SeqDesk PostgreSQL" private_postgres_start "$data_dir" "$log_file"; then
        print_private_postgres_start_failure "$log_file"
        return 1
    fi

    select_private_postgres "$socket_dir"
    print_success "SeqDesk PostgreSQL is running on its own Unix socket in ${root} (no TCP port used)."
    return 0
}

# This gate decides whether the bootstrap in ensure_local_postgres_database can
# run, so it has to probe the exact connection that bootstrap will use: -h/-p
# only when PG_HOST names a Unix socket directory, and the default peer socket
# otherwise. Forcing -h 127.0.0.1 here instead sends the probe through the TCP
# path, where stock Debian/Ubuntu applies scram-sha-256 and rejects it for want
# of a password -- on a machine whose peer socket would have worked. The role
# then never gets created and the install fails blaming sudo.
sudo_postgres_ready() {
    local psql_bin
    psql_bin="$(find_postgres_binary psql 2>/dev/null || true)"
    if [ -z "$psql_bin" ]; then
        return 1
    fi

    if [[ "${PG_HOST:-}" == /* ]]; then
        PGCONNECT_TIMEOUT=5 run_as_postgres "$psql_bin" \
            -X -w -h "$PG_HOST" -p "${PG_PORT:-5432}" \
            -d postgres -qAt -c "select 1" >/dev/null 2>&1
    else
        PGCONNECT_TIMEOUT=5 run_as_postgres "$psql_bin" \
            -X -w -d postgres -qAt -c "select 1" >/dev/null 2>&1
    fi
}

find_postgres_binary() {
    local tool="$1"
    local candidate formula prefix

    candidate="$(command -v "$tool" 2>/dev/null || true)"
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
        printf '%s' "$candidate"
        return 0
    fi

    if [ "${OS:-}" = "macos" ] && command_exists brew; then
        for formula in postgresql@16 postgresql@18 postgresql@17 postgresql@15 postgresql@14 postgresql; do
            if ! brew list --versions "$formula" >/dev/null 2>&1; then
                continue
            fi
            prefix="$(brew --prefix "$formula" 2>/dev/null || true)"
            candidate="$prefix/bin/$tool"
            if [ -n "$prefix" ] && [ -x "$candidate" ]; then
                printf '%s' "$candidate"
                return 0
            fi
        done
    fi

    # Distribution packages keep the server programs off PATH: Debian/Ubuntu put
    # them in /usr/lib/postgresql/<major>/bin and the PGDG RPMs in
    # /usr/pgsql-<major>/bin. Without this, initdb and pg_ctl look absent on a
    # machine that has them, and SeqDesk falls back to demanding sudo.
    if [ "${OS:-}" = "linux" ]; then
        # SEQDESK_PG_SEARCH_ROOT prefixes the search so this branch can be
        # exercised against a fixture; empty in every real install.
        local major search_root="${SEQDESK_PG_SEARCH_ROOT:-}"
        for major in 18 17 16 15 14; do
            for candidate in \
                "$search_root/usr/lib/postgresql/$major/bin/$tool" \
                "$search_root/usr/pgsql-$major/bin/$tool"; do
                if [ -x "$candidate" ]; then
                    printf '%s' "$candidate"
                    return 0
                fi
            done
        done
    fi

    return 1
}

find_installed_brew_postgres_formula() {
    local formula running_formula
    command_exists brew || return 1
    running_formula="$(brew services list 2>/dev/null | \
        awk '$1 ~ /^postgresql(@[0-9]+)?$/ && $2 == "started" { print $1; exit }')"
    if [ -n "$running_formula" ] && brew list --versions "$running_formula" >/dev/null 2>&1; then
        printf '%s' "$running_formula"
        return 0
    fi
    for formula in postgresql@16 postgresql@18 postgresql@17 postgresql@15 postgresql@14 postgresql; do
        if brew list --versions "$formula" >/dev/null 2>&1; then
            printf '%s' "$formula"
            return 0
        fi
    done
    return 1
}

add_brew_postgres_to_path() {
    local formula="$1"
    local prefix
    prefix="$(brew --prefix "$formula" 2>/dev/null || true)"
    if [ -n "$prefix" ] && [ -d "$prefix/bin" ]; then
        export PATH="$prefix/bin:$PATH"
    fi
}

macos_brew_service_runs_as_root() {
    local formula="$1"
    local plist="/Library/LaunchDaemons/homebrew.mxcl.${formula}.plist"
    [ -f "$plist" ] || return 1

    # A root-level LaunchDaemon is safe only when it explicitly drops to an
    # unprivileged account. Old `sudo brew services start postgresql...` calls
    # create a plist without UserName, causing PostgreSQL to reject startup.
    if [ -x /usr/libexec/PlistBuddy ] && \
        /usr/libexec/PlistBuddy -c 'Print :UserName' "$plist" >/dev/null 2>&1; then
        return 1
    fi
    return 0
}

warn_macos_root_postgres_services() {
    [ "${OS:-}" = "macos" ] || return 0
    [ "${MACOS_ROOT_POSTGRES_WARNING_SHOWN:-}" != "1" ] || return 0

    local formula log_file brew_prefix found="false" running_formula
    brew_prefix="$(brew --prefix 2>/dev/null || true)"
    running_formula="$(brew services list 2>/dev/null | \
        awk '$1 ~ /^postgresql(@[0-9]+)?$/ && $2 == "started" { print $1; exit }')"
    for formula in postgresql@16 postgresql@18 postgresql@17 postgresql@15 postgresql@14 postgresql; do
        if ! macos_brew_service_runs_as_root "$formula"; then
            continue
        fi

        found="true"
        print_warning "Homebrew PostgreSQL service '$formula' is registered to run as root."
        echo "  PostgreSQL refuses to run as root; this commonly appears as launchctl error 5"
        echo "  followed by Homebrew service status 'error 78'."
        echo "  Repair the stale system service as follows:"
        echo "    sudo brew services stop $formula"
        echo "    brew services stop $formula"

        log_file="$brew_prefix/var/log/${formula}.log"
        if [ -n "$brew_prefix" ] && [ -f "$log_file" ] && [ ! -w "$log_file" ]; then
            echo "    sudo chown \"$(id -un)\":admin $(shell_quote "$log_file")"
        fi
        if [ -n "$running_formula" ] && [ "$running_formula" != "$formula" ]; then
            echo "  '$running_formula' is already running. SeqDesk supports PostgreSQL 14+,"
            echo "  so keep using it instead of starting a second server on port 5432."
        else
            echo "    brew services start $formula"
        fi
        echo "  Do not run 'sudo brew services start' for PostgreSQL."
    done

    if [ "$found" = "true" ]; then
        MACOS_ROOT_POSTGRES_WARNING_SHOWN=1
    fi
}

print_macos_brew_postgres_failure() {
    local formula="$1"
    local service_output="${2:-}"
    local brew_prefix log_file log_excerpt log_mtime service_line

    if [ -n "$service_output" ]; then
        printf '%s\n' "$service_output" | sed 's/^/  /'
    fi

    warn_macos_root_postgres_services

    service_line="$(brew services list 2>/dev/null | awk -v formula="$formula" '$1 == formula { print; exit }')"
    if [ -n "$service_line" ]; then
        print_info "Homebrew service: $service_line"
    fi

    brew_prefix="$(brew --prefix 2>/dev/null || true)"
    log_file="$brew_prefix/var/log/${formula}.log"
    if [ -n "$brew_prefix" ] && [ -f "$log_file" ] && [ ! -w "$log_file" ] && \
        ! macos_brew_service_runs_as_root "$formula"; then
        print_warning "The PostgreSQL log is not writable by $(id -un): $log_file"
        echo "  Repair its ownership, then retry:"
        echo "    sudo chown \"$(id -un)\":admin $(shell_quote "$log_file")"
    fi
    if [ -n "$brew_prefix" ] && [ -r "$log_file" ]; then
        log_mtime="$(stat -c '%Y' "$log_file" 2>/dev/null || \
            stat -f '%m' "$log_file" 2>/dev/null || true)"
        if [[ "$log_mtime" =~ ^[0-9]+$ ]] && [ "$log_mtime" -lt "$INSTALL_START_TS" ]; then
            print_info "PostgreSQL log has no entries from this install attempt; historical errors omitted: $log_file"
        else
            log_excerpt="$(tail -n 120 "$log_file" 2>/dev/null | \
                grep -Ei 'root.*not permitted|address already in use|could not bind|lock file|permission denied|fatal|panic' | \
                tail -n 8 || true)"
            if [ -n "$log_excerpt" ]; then
                print_warning "PostgreSQL log excerpt from this install attempt ($log_file):"
                printf '%s\n' "$log_excerpt" | sed 's/^/  /'
            else
                print_info "PostgreSQL log: $log_file"
            fi
        fi
    fi
}

# Name the process holding the port instead of telling the user to go run lsof.
# Nearly every "TCP does not answer but the socket does" report comes down to
# which process owns the port, and the installer can simply look.
describe_port_owner() {
    local port="$1"
    local owner

    command_exists lsof || return 1
    owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | \
        awk 'NR > 1 { printf "%s (pid %s, user %s)", $1, $2, $3; exit }')"
    [ -n "$owner" ] || return 1
    printf '%s' "$owner"
}

print_macos_postgres_protocol_diagnosis() {
    local pg_isready_bin port_owner
    local configured_host="${PG_HOST:-127.0.0.1}"
    local configured_port="${PG_PORT:-5432}"

    pg_isready_bin="$(find_postgres_binary pg_isready 2>/dev/null || true)"
    if [ -z "$pg_isready_bin" ]; then
        print_error "PostgreSQL dependency check failed: pg_isready was not found."
        echo "  Install or repair a supported PostgreSQL 14+ client/server package,"
        echo "  then rerun the same SeqDesk command."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#macos-prerequisites"
        return
    fi

    if "$pg_isready_bin" -h /tmp -p "$configured_port" >/dev/null 2>&1; then
        if [[ "$configured_host" == /* ]]; then
            print_error "The configured PostgreSQL Unix socket is unavailable, but /tmp works."
            echo "  Configured socket     ${configured_host}:${configured_port} — no PostgreSQL response"
            echo "  Available socket      /tmp:${configured_port} — accepting connections"
            echo "  SeqDesk kept the explicit socket URL unchanged. If /tmp is intentional,"
            echo "  set host=%2Ftmp in both DATABASE_URL and DIRECT_URL."
            echo ""
            echo "  Check:"
            echo "    $pg_isready_bin -h ${configured_host} -p ${configured_port}"
            echo "    $pg_isready_bin -h /tmp -p ${configured_port}"
            echo "  Confirm unix_socket_directories on the intended PostgreSQL server."
            echo "  Do not delete postmaster.pid."
            print_troubleshooting_url "https://seqdesk.org/docs/installation/macos#postgresql-unix-socket-works-but-tcp-does-not"
            return
        fi

        print_error "PostgreSQL answers on its Unix socket, but not over TCP."
        echo "  /tmp:${configured_port}          accepting connections"
        port_owner="$(describe_port_owner "$configured_port" 2>/dev/null || true)"
        if [ -n "$port_owner" ]; then
            echo "  ${configured_host}:${configured_port}     held by ${port_owner}, no PostgreSQL response"
        else
            echo "  ${configured_host}:${configured_port}     nothing is listening"
        fi
        # Stated in both cases: a port that answers TCP but not the PostgreSQL
        # protocol, and a port with no listener at all, have the same two likely
        # causes from the user's point of view.
        echo "  Either PostgreSQL is not configured for TCP, or a VPN or"
        echo "  endpoint-security tool is intercepting local connections."
        echo ""
        if [ -n "${SEQDESK_DATABASE_URL:-}" ]; then
            echo "  Your explicit DATABASE_URL was left unchanged. To use the working socket,"
            echo "  append its directory as a host parameter:"
            echo "    postgresql://USER:PASSWORD@localhost:${configured_port}/DATABASE?schema=public&host=%2Ftmp"
        fi
        # A live server is answering here, so the stale-PID-file "fix" found in
        # search results is exactly the wrong move.
        echo "  Do not remove postmaster.pid while a live postgres process owns it."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/macos#postgresql-unix-socket-works-but-tcp-does-not"
        return
    fi

    print_error "PostgreSQL dependency check failed: no healthy local server answered."
    echo "  Neither TCP ${configured_host}:${configured_port} nor the macOS Unix socket /tmp:${configured_port}"
    echo "  accepted a PostgreSQL readiness probe."
    echo "  Repair the service as your normal macOS user; never start PostgreSQL with sudo."
    echo "  Do not remove postmaster.pid while a live postgres process owns it."
    print_troubleshooting_url "https://seqdesk.org/docs/installation/macos#postgresql-fails-with-launchctl-bootstrap--exited-with-5"
}

install_postgres_packages_if_possible() {
    if [ "${OS:-}" = "macos" ]; then
        if ! command_exists brew; then
            print_warning "Homebrew is required to provision local PostgreSQL automatically on macOS."
            return 1
        fi

        local formula
        formula="$(find_installed_brew_postgres_formula 2>/dev/null || true)"
        if [ -z "$formula" ]; then
            if run_with_spinner_warn "Install PostgreSQL 16" brew install postgresql@16; then
                formula="postgresql@16"
            else
                print_warning "Homebrew could not install postgresql@16."
                return 1
            fi
        fi
        add_brew_postgres_to_path "$formula"
        return 0
    fi

    if ! can_run_privileged; then
        return 1
    fi

    case "$OS:$DISTRO" in
        linux:redhat)
            if command_exists dnf; then
                run_with_spinner_warn "Install PostgreSQL packages" run_privileged dnf install -y postgresql-server postgresql-contrib || true
            elif command_exists yum; then
                run_with_spinner_warn "Install PostgreSQL packages" run_privileged yum install -y postgresql-server postgresql-contrib || true
            fi
            ;;
        linux:debian)
            if command_exists apt-get; then
                run_with_spinner_warn "Refresh package index" run_privileged apt-get update || true
                run_with_spinner_warn "Install PostgreSQL packages" run_privileged apt-get install -y postgresql postgresql-contrib || true
            fi
            ;;
    esac
}

start_postgres_if_possible() {
    if [ "${OS:-}" = "macos" ]; then
        if command_exists brew; then
            warn_macos_root_postgres_services
            local formula service_output running_formula formula_candidates seen_formulas=""
            running_formula="$(brew services list 2>/dev/null | \
                awk '$1 ~ /^postgresql(@[0-9]+)?$/ && $2 == "started" { print $1; exit }')"
            formula_candidates="$running_formula postgresql@16 postgresql@18 postgresql@17 postgresql@15 postgresql@14 postgresql"
            for formula in $formula_candidates; do
                [ -n "$formula" ] || continue
                case " $seen_formulas " in
                    *" $formula "*) continue ;;
                esac
                seen_formulas="$seen_formulas $formula"
                if ! brew list --versions "$formula" >/dev/null 2>&1; then
                    continue
                fi
                if macos_brew_service_runs_as_root "$formula"; then
                    print_info "Skipping misconfigured root service $formula until it is repaired."
                    print_macos_brew_postgres_failure "$formula"
                    continue
                fi

                add_brew_postgres_to_path "$formula"
                print_info "Starting PostgreSQL with Homebrew ($formula)"
                if ! service_output="$(brew services start "$formula" 2>&1)"; then
                    print_warning "Homebrew could not start $formula."
                    print_macos_brew_postgres_failure "$formula" "$service_output"
                    continue
                fi

                for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
                    if postgres_server_ready; then
                        return 0
                    fi
                    sleep 1
                done

                print_warning "$formula started but PostgreSQL did not become ready on ${PG_HOST:-127.0.0.1}:${PG_PORT:-5432}."
                print_macos_brew_postgres_failure "$formula" "$service_output"

                # Do not register several PostgreSQL versions after one service
                # starts successfully. A port or data-directory error needs to
                # be fixed explicitly rather than hidden by another version.
                return 1
            done
        else
            print_warning "Homebrew is required to provision local PostgreSQL automatically on macOS."
        fi

        return 1
    fi

    if ! can_run_privileged; then
        return 1
    fi

    if command_exists postgresql-setup; then
        run_privileged postgresql-setup --initdb >/dev/null 2>&1 || true
    fi

    if command_exists systemctl; then
        run_privileged systemctl enable --now postgresql >/dev/null 2>&1 || true
    fi
}

postgres_client_tools_available() {
    [ -n "$(find_postgres_binary pg_isready 2>/dev/null || true)" ]
}

# Socket directories worth probing for a local server, most specific first. A
# SeqDesk-managed instance wins over the machine's shared server so a repeat
# install keeps using its own data.
local_postgres_socket_candidates() {
    local brew_prefix

    private_postgres_socket_dir
    printf '\n'
    if [ -n "${PGHOST:-}" ] && [[ "${PGHOST}" == /* ]]; then
        printf '%s\n' "$PGHOST"
    fi
    printf '/tmp\n'
    brew_prefix="$(brew --prefix 2>/dev/null || true)"
    if [ -n "$brew_prefix" ]; then
        printf '%s/var/run\n' "$brew_prefix"
    fi
    printf '/var/run/postgresql\n'
}

# Adopt an existing local server reachable over a Unix socket.
#
# Returns 0 when one was adopted, 1 when a server answered but must not be used
# (already explained to the user), and 2 when nothing usable was found. The
# tri-state matters: "I could not check" and "there is nothing there" used to be
# the same answer, which is how a healthy server got skipped in favour of
# starting a second one.
try_reuse_local_postgres_socket() {
    local url_was_supplied="$1"
    local port="${PG_PORT:-5432}"
    local socket_dir candidates

    if ! postgres_client_tools_available; then
        detail "socket reuse skipped: no pg_isready on PATH or in any Homebrew keg yet"
        return 2
    fi

    candidates="$(local_postgres_socket_candidates)"
    while IFS= read -r socket_dir; do
        [ -n "$socket_dir" ] || continue

        if ! postgres_socket_server_ready "$socket_dir" "$port"; then
            detail "socket ${socket_dir}:${port} — no server responding"
            continue
        fi
        detail "socket ${socket_dir}:${port} — accepting connections"

        # An explicit database URL is the user's decision. Report, never retarget.
        if [ "$url_was_supplied" = "true" ]; then
            detail "socket ${socket_dir}:${port} — not adopted: an explicit DATABASE_URL was supplied"
            return 2
        fi

        if ! postgres_socket_owned_by_current_user "$socket_dir" "$port"; then
            print_untrusted_postgres_socket "$socket_dir" "$port"
            continue
        fi

        if postgres_socket_admin_ready "$socket_dir" "$port"; then
            select_macos_postgres_socket "$socket_dir" "$port"
            return 0
        fi

        detail "socket ${socket_dir}:${port} — reachable, but $(id -un) is not a PostgreSQL 14+ superuser there; not adopting"
    done <<CANDIDATES
$candidates
CANDIDATES

    return 2
}

# Start a Homebrew PostgreSQL that is already installed and registered, so an
# earlier SeqDesk installation keeps its existing data instead of silently
# getting a new empty database. Never fatal: if this cannot work, the caller
# provisions a private instance instead.
try_adopt_registered_brew_postgres() {
    local formula service_output

    [ "${OS:-}" = "macos" ] || return 1
    command_exists brew || return 1

    formula="$(brew services list 2>/dev/null | \
        awk '$1 ~ /^postgresql(@[0-9]+)?$/ { print $1; exit }')"
    [ -n "$formula" ] || { detail "no Homebrew PostgreSQL service is registered"; return 1; }

    if macos_brew_service_runs_as_root "$formula"; then
        detail "$formula is registered to run as root; not touching it"
        return 1
    fi

    add_brew_postgres_to_path "$formula"
    detail "starting registered Homebrew service $formula"
    if ! service_output="$(brew services start "$formula" 2>&1)"; then
        detail "brew services start $formula failed: $service_output"
        return 1
    fi

    local attempt
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if postgres_server_ready; then
            detail "$formula became ready on ${PG_HOST:-127.0.0.1}:${PG_PORT:-5432}"
            return 0
        fi
        if try_reuse_local_postgres_socket "false"; then
            return 0
        fi
        sleep 1
    done

    detail "$formula did not become usable within 10s"
    return 1
}

uses_local_postgres_target() {
    if [ -z "${SEQDESK_DATABASE_URL:-}" ]; then
        return 0
    fi

    local database_host
    database_host="$(postgres_url_host "$SEQDESK_DATABASE_URL" 2>/dev/null || true)"
    case "$database_host" in
        127.0.0.1|localhost|::1|'[::1]'|/*) return 0 ;;
        *) return 1 ;;
    esac
}

# Diagnosis dispatcher. The macOS text is about Homebrew services and /tmp
# sockets; neither means anything on a Linux host.
print_local_postgres_diagnosis() {
    if [ "${OS:-}" = "macos" ]; then
        print_macos_postgres_protocol_diagnosis
        return
    fi

    local configured_host="${PG_HOST:-127.0.0.1}"
    local configured_port="${PG_PORT:-5432}"
    local port_owner

    print_error "No usable PostgreSQL was found and SeqDesk could not create one."
    port_owner="$(describe_port_owner "$configured_port" 2>/dev/null || true)"
    if [ -n "$port_owner" ]; then
        echo "  ${configured_host}:${configured_port}     held by ${port_owner}, no PostgreSQL response"
    else
        echo "  ${configured_host}:${configured_port}     nothing is listening"
    fi
    echo "  SeqDesk needs either the PostgreSQL server package (so it can create its"
    echo "  own instance without root) or an existing database:"
    echo "    Debian/Ubuntu   sudo apt-get install postgresql"
    echo "    RHEL/Alma       sudo dnf install postgresql-server"
    echo "    Managed         --database-url \"postgresql://...\""
    print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#postgresql-options"
}

preflight_local_postgres() {
    case "${OS:-}" in
        macos|linux) ;;
        *) return 0 ;;
    esac
    uses_local_postgres_target || return 0

    if [ -z "${SEQDESK_DATABASE_URL:-}" ] && [ -n "${SEQDESK_DATABASE_DIRECT_URL:-}" ]; then
        print_header "Prepare local PostgreSQL"
        print_error "DIRECT_URL was supplied without DATABASE_URL."
        echo "  Supply both URLs, or omit DIRECT_URL so one generated local URL is used consistently."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#postgresql-options"
        return 1
    fi

    local database_url_was_supplied="false"
    if [ -n "${SEQDESK_DATABASE_URL:-}" ]; then
        database_url_was_supplied="true"
        load_postgres_url_parts || return 0
    else
        PG_HOST="127.0.0.1"
        PG_PORT="5432"
    fi

    print_header "Prepare local PostgreSQL"
    warn_macos_root_postgres_services

    # The ladder, in order of least interference:
    #   1. a healthy server on the configured transport   -> reuse untouched
    #   2. a healthy server on a local socket we can admin -> reuse untouched
    #   3. a Homebrew service that is installed but idle   -> start it once
    #   4. nothing usable                                  -> own one privately
    # Rungs 3 and 4 are skipped when the user supplied an explicit DATABASE_URL:
    # an unreachable URL they chose is an error to report, never a reason to
    # build a different database behind their back.

    if postgres_server_ready; then
        print_success "PostgreSQL is already available on ${PG_HOST:-127.0.0.1}:${PG_PORT:-5432}; reusing it."
        return 0
    fi
    detail "TCP ${PG_HOST:-127.0.0.1}:${PG_PORT:-5432} — no PostgreSQL response"

    # Captured with `|| status=$?` rather than called bare: the installer runs
    # under `set -e`, where a bare call returning the "nothing usable" code
    # would abort the whole script instead of falling through to the next rung.
    local socket_reuse_status=0
    try_reuse_local_postgres_socket "$database_url_was_supplied" || socket_reuse_status=$?
    case "$socket_reuse_status" in
        0) return 0 ;;
        1) return 1 ;;
    esac

    # The guided review calls this once in read-only mode. At this point we
    # have exhausted the non-mutating reuse checks; starting a service,
    # installing server packages, or creating a private cluster belongs only
    # to the post-confirmation apply phase.
    if is_truthy "${SEQDESK_PREFLIGHT_READ_ONLY:-}"; then
        if [ "$database_url_was_supplied" = "true" ]; then
            print_info "The selected local PostgreSQL endpoint is not running yet; it will be prepared after confirmation."
        else
            print_info "No active local PostgreSQL was found; SeqDesk will prepare one after confirmation."
        fi
        if [ "${OS:-}" = "macos" ] && ! command_exists brew && \
            [ -z "$(find_postgres_binary initdb 2>/dev/null || true)" ]; then
            print_error "Homebrew or existing PostgreSQL server programs are required for the local database choice on macOS."
            echo "  Install Homebrew from https://brew.sh, or choose Existing/managed PostgreSQL."
            return 1
        fi
        return 0
    fi

    if [ "$database_url_was_supplied" = "true" ]; then
        # On Linux an explicit URL that is unreachable right now has always been
        # recoverable further down, where ensure_local_postgres_database can
        # install and start a system server with sudo. Failing here would remove
        # that recovery, so leave the existing path in charge.
        if [ "${OS:-}" != "macos" ]; then
            detail "explicit DATABASE_URL is unreachable; deferring to the system PostgreSQL setup"
            return 0
        fi
        print_local_postgres_diagnosis
        print_error "SeqDesk kept the explicit PostgreSQL URL unchanged."
        echo "  Choose an intentional Unix-socket URL or restore the configured TCP transport, then retry."
        replay_recent_detail
        return 1
    fi

    if try_adopt_registered_brew_postgres; then
        print_success "PostgreSQL is ready on ${PG_HOST:-127.0.0.1}:${PG_PORT:-5432}."
        return 0
    fi

    # Nothing on this machine can serve SeqDesk, so stop negotiating and bring
    # our own. install_postgres_packages_if_possible only supplies the binaries;
    # the cluster and its lifecycle belong to SeqDesk. Checked with
    # find_postgres_binary rather than command_exists because distributions keep
    # initdb off PATH.
    if [ -z "$(find_postgres_binary initdb 2>/dev/null || true)" ] && \
        ! install_postgres_packages_if_possible; then
        print_error "PostgreSQL server programs are not available and could not be installed."
        if [ "${OS:-}" = "macos" ]; then
            echo "  Install Homebrew from https://brew.sh, or supply an existing database"
            echo "  with --database-url \"postgresql://...\"."
            print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#macos-prerequisites"
        else
            echo "  Install the server package once; SeqDesk needs no root after that:"
            echo "    Debian/Ubuntu   sudo apt-get install postgresql"
            echo "    RHEL/Alma       sudo dnf install postgresql-server"
            echo "  Or supply an existing database with --database-url \"postgresql://...\"."
            print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#postgresql-options"
        fi
        return 1
    fi

    if provision_private_postgres; then
        return 0
    fi

    print_local_postgres_diagnosis
    echo "  Nothing was installed and the install target was not replaced."
    echo "  Rerun the same command after applying the repair above, or supply an"
    echo "  existing database with --database-url \"postgresql://...\"."
    replay_recent_detail
    return 1
}

write_postgres_bootstrap_sql() {
    local sql_file="$1"
    PG_USER_NAME="$PG_USER_NAME" \
    PG_PASSWORD_VALUE="$PG_PASSWORD_VALUE" \
    PG_DATABASE_NAME="$PG_DATABASE_NAME" \
    node > "$sql_file" <<'NODE'
const user = process.env.PG_USER_NAME || "seqdesk";
const password = process.env.PG_PASSWORD_VALUE || "";
const database = process.env.PG_DATABASE_NAME || "seqdesk";

function literal(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

process.stdout.write(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(user)}) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', ${literal(user)}, ${literal(password)});
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${literal(user)}, ${literal(password)});
  END IF;
END
$$;

SELECT format('CREATE DATABASE %I OWNER %I', ${literal(database)}, ${literal(user)})
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${literal(database)})
\\gexec

ALTER DATABASE "${database.replace(/"/g, '""')}" OWNER TO "${user.replace(/"/g, '""')}";
`);
NODE
}

# Feed the bootstrap script to psql over an already-open file descriptor.
#
# On Linux run_as_postgres escalates to the system `postgres` account
# (runuser/sudo -u postgres), which cannot read the mktemp file: it is mode 0600
# and owned by the invoking user. Relaxing the mode is not an option -- the
# script carries the seqdesk role's password in clear text. So the file is
# opened HERE, by the user who owns it, and only the resulting descriptor is
# handed down as psql's stdin ("-f -"); both runuser and sudo pass descriptor 0
# through untouched.
#
# The redirection must live inside this function rather than on the
# run_with_spinner call, because the spinner runs its command as a background
# job and bash gives background jobs /dev/null on stdin unless the command
# redirects stdin itself.
run_postgres_bootstrap_sql() {
    local psql_bin="$1"
    local sql_file="$2"
    shift 2

    run_as_postgres "$psql_bin" -X -w "$@" \
        -v ON_ERROR_STOP=1 -d postgres -f - < "$sql_file"
}

ensure_local_postgres_database() {
    if ! load_postgres_url_parts; then
        return 0
    fi
    if [ -n "${MACOS_POSTGRES_SOCKET_DIR:-}" ] && \
        ! postgres_socket_owned_by_current_user "$MACOS_POSTGRES_SOCKET_DIR" "${PG_PORT:-5432}"; then
        print_selected_socket_no_longer_trusted "$MACOS_POSTGRES_SOCKET_DIR" "${PG_PORT:-5432}"
        return 1
    fi

    if postgres_connection_ready; then
        print_kv "PostgreSQL" "ready"
        return 0
    fi

    print_info "Preparing local PostgreSQL database"

    if [ "${OS:-}" = "macos" ] && command_exists brew; then
        warn_macos_root_postgres_services
    fi

    if ! sudo_postgres_ready; then
        install_postgres_packages_if_possible || true
        start_postgres_if_possible || true
    fi

    if ! sudo_postgres_ready; then
        if [ "${OS:-}" = "macos" ]; then
            print_warning "Could not access local PostgreSQL as the current macOS user."
        else
            print_warning "Could not access local PostgreSQL as root or through passwordless sudo."
        fi
        return 1
    fi

    local sql_file psql_bin
    psql_bin="$(find_postgres_binary psql 2>/dev/null || true)"
    if [ -z "$psql_bin" ]; then
        print_warning "PostgreSQL client 'psql' was not found."
        return 1
    fi
    sql_file="$(mktemp)"
    write_postgres_bootstrap_sql "$sql_file"

    if [[ "${PG_HOST:-}" == /* ]]; then
        if ! run_with_spinner "Local PostgreSQL database" \
            run_postgres_bootstrap_sql "$psql_bin" "$sql_file" \
            -h "$PG_HOST" -p "${PG_PORT:-5432}"; then
            rm -f "$sql_file"
            return 1
        fi
    elif ! run_with_spinner "Local PostgreSQL database" \
        run_postgres_bootstrap_sql "$psql_bin" "$sql_file"; then
        rm -f "$sql_file"
        return 1
    fi
    rm -f "$sql_file"

    if postgres_connection_ready; then
        print_kv "PostgreSQL" "ready"
        return 0
    fi

    print_warning "Local PostgreSQL setup ran, but the SeqDesk database is still not reachable."
    return 1
}

prepare_postgres_and_exit() {
    print_header "PostgreSQL setup"

    if [ -z "$SEQDESK_DATABASE_URL" ]; then
        print_error "No DATABASE_URL found. Pass --database-url or --dir for an existing SeqDesk install."
        exit 1
    fi

    configure_postgres_urls

    if ensure_local_postgres_database; then
        print_success "PostgreSQL is ready"
        exit 0
    fi

    print_postgres_setup_instructions
    exit 1
}

parse_release_version_info() {
    local version_info="$1"

    VERSION_INFO="$version_info" node <<'NODE'
const raw = process.env.VERSION_INFO;

if (!raw) {
  console.error("Missing version info payload.");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  console.error(`Invalid version info JSON: ${error.message}`);
  process.exit(1);
}

if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  console.error("Version info payload must be an object.");
  process.exit(1);
}

const release =
  parsed.latest && typeof parsed.latest === "object" && !Array.isArray(parsed.latest)
    ? parsed.latest
    : parsed;

function readRequiredString(key) {
  const value = release[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    console.error(`${key} must be a non-empty string.`);
    process.exit(1);
  }

  return value.trim();
}

function readOptionalString(key) {
  const value = release[key];
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    console.error(`${key} must be a string when provided.`);
    process.exit(1);
  }

  return value.trim();
}

function readOptionalSize(key) {
  const value = release[key];
  if (value === undefined || value === null || value === "") {
    return "";
  }

  const parsedValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    console.error(`${key} must be a non-negative integer when provided.`);
    process.exit(1);
  }

  return String(parsedValue);
}

const delimiter = "\u001f";
const endMarker = "__SEQDESK_VERSION_INFO_END__";
process.stdout.write(
  [
    readRequiredString("version"),
    readRequiredString("downloadUrl"),
    readOptionalString("checksum"),
    readOptionalSize("size"),
    endMarker,
  ].join(delimiter)
);
NODE
}

read_installed_seqdesk_version() {
    local install_dir="$1"

    node - "$install_dir" <<'NODE'
const fs = require("fs");
const path = require("path");
const installDir = process.argv[2];
for (const candidate of [
  path.join(installDir, "current", "package.json"),
  path.join(installDir, "package.json"),
]) {
  try {
    const value = JSON.parse(fs.readFileSync(candidate, "utf8"))?.version;
    if (typeof value === "string" && value.trim()) {
      process.stdout.write(value.trim());
      process.exit(0);
    }
  } catch {
    // Try the next supported release layout.
  }
}
process.exit(1);
NODE
}

print_profile_minimum_version_error() {
    local selected_version="$1"
    local reconfigure_mode="${2:-false}"

    if [ -n "$SEQDESK_PROFILE" ]; then
        print_error "Hosted profile '$SEQDESK_PROFILE' requires SeqDesk ${SEQDESK_PROFILE_MIN_VERSION} or newer, but the selected version is ${selected_version:-unknown}."
    else
        print_error "Installer config requires SeqDesk ${SEQDESK_PROFILE_MIN_VERSION} or newer, but the selected version is ${selected_version:-unknown}."
    fi
    if [ "$reconfigure_mode" = "true" ]; then
        print_info "Update SeqDesk before reconfiguring with this profile."
    else
        print_info "Choose a newer SeqDesk release or lower minSeqDeskVersion in the installer config."
    fi
    print_troubleshooting_url
}

# Resolve the selected/installed version before any PostgreSQL or Miniconda
# provisioning. A profile compatibility failure must leave the host unchanged.
preflight_profile_minimum_version() {
    if [ -z "$SEQDESK_PROFILE_MIN_VERSION" ]; then
        return 0
    fi

    if is_truthy "$SEQDESK_RECONFIGURE"; then
        local installed_version=""
        installed_version="$(read_installed_seqdesk_version "$SEQDESK_DIR" 2>/dev/null || true)"
        if [ -z "$installed_version" ] || \
            ! version_at_least "$installed_version" "$SEQDESK_PROFILE_MIN_VERSION"; then
            print_profile_minimum_version_error "$installed_version" "true"
            exit 1
        fi
        return 0
    fi

    local version_url="$SEQDESK_API/version"
    local version_info_file=""
    local version_info=""
    local fetch_detail=""
    local version_fields=""
    local selected_version=""
    local selected_download_url=""
    local selected_checksum=""
    local selected_file_size=""
    local version_fields_end=""

    if [ -n "$SEQDESK_VERSION" ]; then
        version_url="$SEQDESK_API/version?version=$SEQDESK_VERSION"
    fi
    version_info_file="$(mktemp)"
    if curl_fetch_to_file "$version_url" "$version_info_file"; then
        version_info="$(cat "$version_info_file")"
    fi
    fetch_detail="$(curl_failure_detail)"
    rm -f "$version_info_file"

    if [ -z "$version_info" ]; then
        print_error "Could not fetch release metadata from the SeqDesk server."
        print_kv "URL" "$version_url"
        if [ -n "$fetch_detail" ]; then
            print_kv "Result" "$fetch_detail"
        else
            print_kv "Result" "empty response"
        fi
        print_network_failure_hints
        print_troubleshooting_url
        exit 1
    fi

    if ! version_fields="$(parse_release_version_info "$version_info")"; then
        print_error "Could not parse version info"
        print_troubleshooting_url
        exit 1
    fi
    IFS=$'\x1f' read -r selected_version selected_download_url selected_checksum \
        selected_file_size version_fields_end <<< "$version_fields"
    if [ "$version_fields_end" != "__SEQDESK_VERSION_INFO_END__" ] || \
        [ -z "$selected_version" ] || [ -z "$selected_download_url" ]; then
        print_error "Could not parse version info"
        print_troubleshooting_url
        exit 1
    fi
    if ! version_at_least "$selected_version" "$SEQDESK_PROFILE_MIN_VERSION"; then
        print_profile_minimum_version_error "$selected_version" "false"
        exit 1
    fi

    # Reuse the exact response during the later artifact-download phase so a
    # changing release endpoint cannot pass one version and download another.
    SEQDESK_PREFETCHED_VERSION_INFO="$version_info"
}

update_pm2_display_cmd() {
    case "$PM2_BIN" in
        pm2)
            PM2_DISPLAY_CMD="pm2"
            ;;
        */node_modules/.bin/pm2|./node_modules/.bin/pm2)
            PM2_DISPLAY_CMD="./node_modules/.bin/pm2"
            ;;
        *)
            PM2_DISPLAY_CMD="$PM2_BIN"
            ;;
    esac
}

resolve_pm2_bin() {
    if command_exists pm2; then
        PM2_BIN="pm2"
        update_pm2_display_cmd
        return 0
    fi

    if [ -x "./node_modules/.bin/pm2" ]; then
        PM2_BIN="./node_modules/.bin/pm2"
        update_pm2_display_cmd
        return 0
    fi

    PM2_BIN=""
    PM2_DISPLAY_CMD="pm2"
    return 1
}

pm2_exec() {
    if [ -z "$PM2_BIN" ] && ! resolve_pm2_bin; then
        return 127
    fi
    "$PM2_BIN" "$@"
}

# Start or restart the app under PM2 so the process it manages reads its
# database configuration from settings.json instead of from this installer's
# transient environment.
#
# PM2 stores the environment of whoever started the app and replays that same
# copy on every later `pm2 restart`. The installer exports DATABASE_URL and
# DIRECT_URL for its migration and seed steps, so starting PM2 from here froze
# those values into the process for good: both start.sh and the app's runtime
# env bootstrap (bootstrapRuntimeEnv, src/lib/config/runtime-env.ts) only fill
# variables that are NOT already set, so the captured copy beat settings.json
# forever, and editing settings.json changed nothing at all.
#
# The variables are set to an EMPTY value here rather than removed, because
# removing them does not repair an installation that already has the old value
# stored -- which is every installation that has this defect. `pm2 restart
# --update-env` MERGES the current environment into the copy PM2 holds; it
# deletes nothing from it. Measured against pm2 7.0.1 with an isolated PM2_HOME
# and a throwaway app that prints its own environment:
#
#   DATABASE_URL=OLDVALUE pm2 start app.js --name t   -> process sees OLDVALUE
#   env -u DATABASE_URL pm2 restart t --update-env    -> process sees OLDVALUE
#   DATABASE_URL= pm2 restart t --update-env          -> process sees ""
#
# An empty value is what overwrites the stored one, and start.sh trims
# DATABASE_URL/DIRECT_URL and falls back to settings.json when the result is
# empty, so the process lands on the configured database and stays there: a
# later plain `pm2 restart` replays the empty value, not the stale URL.
#
# A deliberate override still works exactly as before: export DATABASE_URL in
# your own shell and run `pm2 restart --update-env` yourself, or run start.sh
# directly with it set -- an env-set value still wins inside start.sh.
# SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED and SEQDESK_DATA_PATH go the same way
# and for the same reason: the installer writes both decisions to durable
# settings, while a copy frozen into the process manager would outlive every
# later edit (including `seqdesk storage configure`).
pm2_exec_runtime() {
    if [ -z "$PM2_BIN" ] && ! resolve_pm2_bin; then
        return 127
    fi
    env DATABASE_URL= DIRECT_URL= SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED= \
        SEQDESK_DATA_PATH= \
        "$PM2_BIN" "$@"
}

read_input() {
    local prompt="$1"
    local reply=""
    if [ -e /dev/tty ]; then
        read -r -p "$prompt" reply < /dev/tty || true
    else
        read -r -p "$prompt" reply || true
    fi
    printf '%s' "$reply"
}

prompt_value() {
    local var_name="$1"
    local prompt="$2"
    local default_value="$3"
    local current_value="${!var_name:-}"

    if [ -n "$current_value" ]; then
        return 0
    fi

    if is_truthy "$SEQDESK_YES"; then
        printf -v "$var_name" '%s' "$default_value"
        return 0
    fi

    local reply
    reply=$(read_input "$prompt [$default_value]: ")
    if [ -z "$reply" ]; then
        reply="$default_value"
    fi
    printf -v "$var_name" '%s' "$reply"
}

prompt_yes_no() {
    local var_name="$1"
    local prompt="$2"
    local default_value="$3"
    local current_value="${!var_name:-}"

    if [ -n "$current_value" ]; then
        return 0
    fi

    if is_truthy "$SEQDESK_YES"; then
        if [[ "$default_value" == "y" || "$default_value" == "Y" ]]; then
            printf -v "$var_name" '%s' "true"
        else
            printf -v "$var_name" '%s' "false"
        fi
        return 0
    fi

    local reply
    reply=$(read_input "$prompt [$default_value]: ")
    reply=${reply:-$default_value}
    case "$reply" in
        y|Y|yes|YES)
            printf -v "$var_name" '%s' "true"
            ;;
        *)
            printf -v "$var_name" '%s' "false"
            ;;
    esac
}

prompt_app_port() {
    if [ -n "$SEQDESK_PORT" ]; then
        return 0
    fi

    if is_truthy "$SEQDESK_YES"; then
        SEQDESK_PORT="8000"
        return 0
    fi

    local reply
    reply=$(read_input "Use recommended app port 8000? [Y/n]: ")
    case "$reply" in
        ""|y|Y|yes|YES)
            SEQDESK_PORT="8000"
            ;;
        *)
            prompt_value SEQDESK_PORT "Custom app port" "8000"
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Interactive setup wizard (opt-in via --interactive)
#
# Gathers the database connection and the initial accounts up front, with input
# validation and a live reachability check, then hands the values to the normal
# install flow. It NEVER runs under -y / --config / --profile, so automated and
# unattended installs are unaffected. Helpers return their result in the global
# INTERACTIVE_RESULT so their on-screen prompts are not captured as the value.
# ---------------------------------------------------------------------------

is_valid_email() {
    local re='^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    [[ "${1:-}" =~ $re ]]
}

# bcrypt ignores bytes after the first 72. Count bytes rather than shell
# characters so multi-byte passwords cannot slip through and become silently
# truncated credentials.
bcrypt_plaintext_password_is_supported() {
    local password="${1-}" byte_count
    byte_count="$(printf '%s' "$password" | wc -c)"
    byte_count="${byte_count//[[:space:]]/}"
    [[ "$byte_count" =~ ^[0-9]+$ ]] && [ "$byte_count" -le 72 ]
}

validate_bootstrap_plaintext_passwords() {
    if [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD:-}" ] && \
        [ -z "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH:-}" ] && \
        ! bcrypt_plaintext_password_is_supported "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD"; then
        print_error "Initial administrator password exceeds bcrypt's 72-byte UTF-8 limit. Choose a shorter password."
        return 1
    fi

    if [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD:-}" ] && \
        [ -z "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH:-}" ] && \
        ! bcrypt_plaintext_password_is_supported "$SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD"; then
        print_error "Initial researcher password exceeds bcrypt's 72-byte UTF-8 limit. Choose a shorter password."
        return 1
    fi

    return 0
}

# Read a secret without echoing it. Prompt goes to the terminal; the value is
# printed to stdout for capture via $(...).
read_secret() {
    local prompt="$1" value=""
    if [ -e /dev/tty ]; then
        read -r -s -p "$prompt" value < /dev/tty || true
        printf '\n' > /dev/tty
    else
        read -r -s -p "$prompt" value || true
        printf '\n' >&2
    fi
    printf '%s' "$value"
}

interactive_prompt_email() {
    local label="$1" default_value="$2" reply prompt
    prompt="$label"
    if [ -n "$default_value" ]; then
        prompt="$prompt [$default_value]"
    fi
    while true; do
        reply=$(read_input "$prompt: ")
        reply=${reply:-$default_value}
        if is_valid_email "$reply"; then
            INTERACTIVE_RESULT="$reply"
            return 0
        fi
        print_error "  '$reply' is not a valid email address. Try again."
    done
}

interactive_prompt_name() {
    local label="$1" default_value="$2" reply
    while true; do
        reply=$(read_input "$label [$default_value]: ")
        reply=${reply:-$default_value}
        if [ -n "${reply//[[:space:]]/}" ] && [ "${#reply}" -le 100 ]; then
            INTERACTIVE_RESULT="$reply"
            return 0
        fi
        print_error "  Enter a name between 1 and 100 characters."
    done
}

interactive_prompt_password() {
    local label="$1" pw pw2
    INTERACTIVE_RESULT_GENERATED="false"
    while true; do
        pw=$(read_secret "$label (leave blank to generate a strong one): ")
        if [ -z "$pw" ]; then
            if ! pw="$(generate_postgres_password)"; then
                print_error "  Cannot generate a password: openssl, node and /dev/urandom are all unavailable."
                print_error "  Enter a password of your own instead."
                continue
            fi
            # Deliberately not printed here. A generated password shown mid-wizard
            # scrolls away behind the rest of the install (or behind a failure
            # that means the account was never created). It is printed once at
            # the end, next to the URL, only after the account is verified.
            print_info "  A strong password was generated; it is shown after its administrator account is verified."
            INTERACTIVE_RESULT="$pw"
            INTERACTIVE_RESULT_GENERATED="true"
            return 0
        fi
        if [ "${#pw}" -lt 8 ]; then
            print_error "  Password must be at least 8 characters. Try again."
            continue
        fi
        if ! bcrypt_plaintext_password_is_supported "$pw"; then
            print_error "  Password must be at most 72 UTF-8 bytes for bcrypt. Try again."
            continue
        fi
        pw2=$(read_secret "  Confirm password: ")
        if [ "$pw" != "$pw2" ]; then
            print_error "  Passwords did not match. Try again."
            continue
        fi
        INTERACTIVE_RESULT="$pw"
        return 0
    done
}

# Best-effort "looks ok" check for a managed DATABASE_URL: confirm the host:port
# is reachable. Returns 0 if reachable. The full credential check still runs
# after the runtime is installed (probe_postgres_database).
interactive_test_database() {
    local url="$1" host_port host port
    host_port="$(postgres_url_host_port "$url" 2>/dev/null || true)"
    if [ -z "$host_port" ]; then
        print_warning "  Could not parse host/port from that URL; skipping the reachability check."
        return 1
    fi
    IFS=$'\t' read -r host port <<< "$host_port"
    if [[ "$host" == /* ]]; then
        print_info "  Testing PostgreSQL Unix socket ${host}:${port} ..."
        if postgres_socket_server_ready "$host" "$port"; then
            print_success "  Looks OK — PostgreSQL is accepting connections through ${host}:${port}."
            return 0
        fi
        print_warning "  Could not reach PostgreSQL through ${host}:${port}. Check the socket path, port, and server."
        return 1
    fi
    print_info "  Testing connectivity to ${host}:${port} ..."
    if db_tcp_reachable "$host" "$port"; then
        print_success "  Looks OK — ${host}:${port} is reachable (credentials are verified after install)."
        return 0
    fi
    print_warning "  Could not reach ${host}:${port}. Check the host/port, firewall, and that PostgreSQL is running."
    return 1
}

interactive_wizard_enabled() {
    is_truthy "$SEQDESK_INTERACTIVE" || return 1
    is_truthy "$SEQDESK_YES" && return 1
    is_truthy "${SEQDESK_RECONFIGURE:-}" && return 1
    is_truthy "${SEQDESK_UPDATE_EXISTING:-}" && return 1
    [ -z "${SEQDESK_CONFIG:-}" ] || return 1
    [ -z "${SEQDESK_PROFILE:-}" ] || return 1
    return 0
}

deployment_profile_label() {
    case "${1:-}" in
        sequencing-center) printf '%s' "Sequencing center" ;;
        shared-lab) printf '%s' "Shared lab" ;;
        research-workbench) printf '%s' "Research workbench" ;;
        *) printf '%s' "Unknown" ;;
    esac
}

validate_deployment_profile() {
    if [ -z "$SEQDESK_DEPLOYMENT_PROFILE" ]; then
        local legacy_surface="${NEXT_PUBLIC_SEQDESK_APP_SURFACE:-${SEQDESK_APP_SURFACE:-}}"
        if [ "$legacy_surface" = "workbench" ] || is_truthy "${NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY:-}"; then
            SEQDESK_DEPLOYMENT_PROFILE="research-workbench"
            print_info "Migrating legacy Workbench mode to deployment.profile=research-workbench."
        else
            SEQDESK_DEPLOYMENT_PROFILE="sequencing-center"
            if is_truthy "${SEQDESK_YES:-}" && ! is_truthy "${SEQDESK_RECONFIGURE:-}"; then
                print_warning "No deployment profile was supplied; using Sequencing center for backward compatibility."
                print_info "New automated installs should pass --deployment-profile explicitly."
            fi
        fi
    fi

    case "$SEQDESK_DEPLOYMENT_PROFILE" in
        sequencing-center|shared-lab|research-workbench)
            return 0
            ;;
        *)
            print_error "Unknown deployment profile: $SEQDESK_DEPLOYMENT_PROFILE"
            print_info "Choose sequencing-center, shared-lab, or research-workbench."
            exit 1
            ;;
    esac
}

# Validate the smaller feature-module switches against the deployment profile
# while the normalized InstallPlan is still read-only. This bootstrap copy of
# the compatibility table intentionally mirrors
# src/lib/deployment-profile/compatibility.ts: the public installer is a
# standalone artifact and cannot import application TypeScript before the
# release has been downloaded.
validate_install_plan_profile_compatibility() {
    local configured_modules="${SEQDESK_FEATURE_MODULES_JSON:-}"
    [ -n "$configured_modules" ] || configured_modules="{}"
    SEQDESK_PLAN_COMPATIBILITY_PROFILE="$SEQDESK_DEPLOYMENT_PROFILE" \
    SEQDESK_PLAN_COMPATIBILITY_MODULES="$configured_modules" \
    node <<'NODE'
const profiles = {
  "sequencing-center": {
    label: "Sequencing center",
    domains: [
      "core",
      "facility-intake",
      "sample-catalog",
      "sequencing-operations",
      "analysis",
      "publishing",
      "support",
    ],
  },
  "shared-lab": {
    label: "Shared lab",
    domains: [
      "core",
      "facility-intake",
      "sample-catalog",
      "sequencing-operations",
      "analysis",
      "publishing",
    ],
  },
  "research-workbench": {
    label: "Research workbench",
    domains: ["core", "analysis", "publishing", "workbench"],
  },
};
const requirements = {
  "ai-validation": ["facility-intake"],
  "mixs-metadata": ["sample-catalog"],
  "account-validation": ["core"],
  "funding-info": ["facility-intake"],
  "billing-info": ["facility-intake"],
  "ena-sample-fields": ["sample-catalog", "publishing"],
  "sequencing-tech": ["sequencing-operations"],
  "dynamic-studies": ["sample-catalog"],
  "notifications": ["core"],
};
const alwaysEnabled = new Set(["sequencing-tech"]);
const defaultStates = {
  "ai-validation": true,
  "mixs-metadata": true,
  "account-validation": false,
  "funding-info": false,
  "billing-info": false,
  "ena-sample-fields": true,
  "sequencing-tech": true,
  "dynamic-studies": false,
  "notifications": false,
};
const profileId = process.env.SEQDESK_PLAN_COMPATIBILITY_PROFILE;
const profile = profiles[profileId];
if (!profile) {
  console.error(
    `Install-plan compatibility check failed: unknown deployment profile ${JSON.stringify(profileId)}. Choose sequencing-center, shared-lab, or research-workbench.`
  );
  process.exit(1);
}

let modules;
try {
  modules = JSON.parse(process.env.SEQDESK_PLAN_COMPATIBILITY_MODULES || "{}");
} catch {
  console.error(
    "Install-plan compatibility check failed: configured feature modules are not valid JSON. Reload the installer configuration and try again."
  );
  process.exit(1);
}
if (!modules || typeof modules !== "object" || Array.isArray(modules)) {
  console.error(
    "Install-plan compatibility check failed: modules must be an object of module-id: true/false switches."
  );
  process.exit(1);
}

const domains = new Set(profile.domains);
const explicitModuleIds = new Set(Object.keys(modules));
const effectiveDefaults = Object.fromEntries(
  Object.entries(requirements).map(([moduleId, requiredDomains]) => [
    moduleId,
    requiredDomains.every((domain) => domains.has(domain))
      ? (alwaysEnabled.has(moduleId) || defaultStates[moduleId] === true)
      : false,
  ])
);
const completeModules = { ...effectiveDefaults, ...modules };
const errors = [];
for (const [moduleId, enabled] of Object.entries(completeModules)) {
  const requiredDomains = requirements[moduleId];
  if (!requiredDomains) {
    errors.push(
      `modules.${moduleId} is not a recognized SeqDesk feature module. Remove it or update SeqDesk to a release that declares it.`
    );
    continue;
  }
  if (typeof enabled !== "boolean") {
    errors.push(`modules.${moduleId} must be true or false.`);
    continue;
  }
  const missingDomains = requiredDomains.filter((domain) => !domains.has(domain));
  if (!enabled) {
    if (
      alwaysEnabled.has(moduleId) &&
      missingDomains.length === 0 &&
      explicitModuleIds.has(moduleId)
    ) {
      errors.push(
        `modules.${moduleId} cannot be disabled because SeqDesk currently treats it as always enabled. Remove this override; the deployment profile controls whether its domain is available.`
      );
    }
    continue;
  }
  if (missingDomains.length > 0) {
    errors.push(
      `${profile.label} cannot enable modules.${moduleId}: it requires ${missingDomains.join(
        " and "
      )}, which this deployment profile does not provide. Disable modules.${moduleId} or choose a compatible deployment profile.`
    );
  }
}

if (errors.length > 0) {
  console.error(`Install plan is incompatible with ${profile.label}:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
NODE
}

prompt_deployment_profile() {
    if [ -n "$SEQDESK_DEPLOYMENT_PROFILE" ]; then
        validate_deployment_profile
        return 0
    fi

    if is_truthy "$SEQDESK_YES"; then
        SEQDESK_DEPLOYMENT_PROFILE="sequencing-center"
        return 0
    fi

    print_info "Operating model — how will this SeqDesk installation be used?"
    echo "    1) Sequencing center"
    echo "       People request sequencing work and facility staff receive, process, and deliver it."
    echo "       Select this when requesters and sequencing operators are different groups."
    echo "       Researchers, operators, and administrators use the same sign-in; one account may combine responsibilities."
    echo "    2) Shared lab"
    echo "       One team shares sequencing projects, samples, runs, and analyses."
    echo "       All members can do normal shared work; one or more administrators additionally configure SeqDesk."
    echo "       Preview on this branch until the packaged Shared Lab acceptance journey passes."
    echo "    3) Research workbench"
    echo "       Researchers upload or import existing data and run analyses in private workspaces."
    echo "       Select this when sequencing orders and facility handoffs should not organize the UI."
    echo "       Administrators manage SeqDesk but do not automatically see another member's private workspace."
    echo "       Preview on this branch until the packaged Workbench acceptance journey passes."
    echo ""
    echo "  Not sure? External requesters -> 1. One shared lab team -> 2. Existing-data analysis -> 3."
    echo "  This selects one operating mode in the same application; it does not install a separate edition."
    echo "  The mode changes workflows, permissions, navigation, and setup guidance."
    echo "  It cannot currently be changed in Settings or with Reconfigure; updates preserve it."
    echo "  Use Back at the final review if you chose the wrong mode."

    local profile_choice
    while true; do
        profile_choice=$(read_input "  Choose 1, 2, or 3 (required): ")
        case "$profile_choice" in
            1|sequencing-center)
                SEQDESK_DEPLOYMENT_PROFILE="sequencing-center"
                break
                ;;
            2|shared-lab)
                SEQDESK_DEPLOYMENT_PROFILE="shared-lab"
                break
                ;;
            3|research-workbench)
                SEQDESK_DEPLOYMENT_PROFILE="research-workbench"
                break
                ;;
            *)
                print_error "  Choose 1, 2, or 3."
                ;;
        esac
    done

    print_success "  Selected $(deployment_profile_label "$SEQDESK_DEPLOYMENT_PROFILE")."
}

prompt_profile_pipeline_support() {
    [ -z "${SEQDESK_WITH_PIPELINES:-}" ] || return 0

    local default_answer="n"
    case "$SEQDESK_DEPLOYMENT_PROFILE" in
        sequencing-center)
            print_info "Workflow execution is optional for a Sequencing center."
            echo "  Order, sample, and sequencing tracking work without preparing Conda, Java, and Nextflow now."
            ;;
        shared-lab)
            default_answer="y"
            print_info "Workflow execution is recommended for a Shared lab."
            echo "  Prepare Conda, Java, and Nextflow now if members should run approved workflows after setup."
            ;;
        research-workbench)
            default_answer="y"
            print_info "Workflow execution is recommended for a Research workbench."
            echo "  Uploads and imports work without it, but analyses need Conda, Java, and Nextflow."
            ;;
    esac

    local answer
    if [ "$default_answer" = "y" ]; then
        answer=$(read_input "  Prepare workflow execution now? (Y/n): ")
        answer=${answer:-y}
    else
        answer=$(read_input "  Prepare workflow execution now? (y/N): ")
        answer=${answer:-n}
    fi
    if is_truthy "$answer"; then
        SEQDESK_WITH_PIPELINES="1"
        print_success "  Workflow runtime prerequisites will be prepared."
        print_info "  Approved workflow packages are selected after the administrator signs in."
    else
        if [ "$SEQDESK_DEPLOYMENT_PROFILE" = "research-workbench" ]; then
            print_warning "  Workbench uploads/imports will work, but analysis execution will remain blocked."
            answer=$(read_input "  Continue with workflow runtime deferred? (y/N): ")
            if ! is_truthy "$answer"; then
                print_info "  Workflow runtime preparation remains selected."
                SEQDESK_WITH_PIPELINES="1"
                return 0
            fi
        fi
        SEQDESK_WITH_PIPELINES="0"
        print_info "  Pipeline runtime setup is deferred; an administrator can configure it later."
    fi
}

prompt_pipeline_executor() {
    is_truthy "${SEQDESK_WITH_PIPELINES:-}" || return 0
    [ -z "${SEQDESK_EXEC_USE_SLURM:-}" ] || return 0

    print_info "Workflow executor — where should analysis jobs run?"
    echo "    1) This computer (recommended for a workstation or small server)"
    echo "       SeqDesk prepares the local Conda and Nextflow runtime."
    echo "    2) An existing Slurm cluster"
    echo "       SeqDesk submits to Slurm; it does not install or administer the cluster."
    echo "  Runtime download size depends on the selected packages and is resolved before each package install."

    local executor_choice
    while true; do
        executor_choice=$(read_input "  Choose [1]: ")
        executor_choice=${executor_choice:-1}
        case "$executor_choice" in
            1|local)
                SEQDESK_EXEC_USE_SLURM="false"
                print_success "  Local workflow execution selected."
                return 0
                ;;
            2|slurm)
                SEQDESK_EXEC_USE_SLURM="true"
                print_success "  Existing Slurm cluster selected."
                print_info "  Queue and resource defaults are optional and can be configured after sign-in."
                print_warning "  Slurm remains operationally pending until a compute-node smoke job verifies the selected storage paths."
                return 0
                ;;
            *)
                print_error "  Choose 1 or 2."
                ;;
        esac
    done
}

# Resolve the service lifecycle before the plan is reviewed. Older installer
# versions asked this after downloads, database setup, and application writes
# had already started, which made the review incomplete and surprised guided
# installs with a late product choice.
resolve_service_mode_for_plan() {
    [ -z "${SEQDESK_USE_PM2:-}" ] || return 0

    if is_truthy "${SEQDESK_RECONFIGURE:-}" || is_truthy "${SEQDESK_UPDATE_EXISTING:-}"; then
        if resolve_pm2_bin && pm2_exec describe seqdesk >/dev/null 2>&1; then
            PM2_PROCESS_EXISTS="true"
            SEQDESK_USE_PM2="1"
            print_info "Detected the existing SeqDesk background service; it will be restarted."
        else
            SEQDESK_USE_PM2="0"
            print_info "No existing SeqDesk background service was detected; service management is unchanged."
        fi
        return 0
    fi

    if interactive_wizard_enabled; then
        print_info "Startup — should SeqDesk run as a background service?"
        echo "  Recommended: PM2 starts SeqDesk now, restarts it after crashes, and can be enabled at boot."
        echo "  Choose manual only for short evaluations or when your organization provides systemd/another service manager."
        prompt_yes_no SEQDESK_USE_PM2 "  Start and manage SeqDesk with PM2?" "y"
        return 0
    fi

    # Preserve the historical unattended default. Operators can select manual
    # lifecycle explicitly with --no-pm2.
    SEQDESK_USE_PM2="1"
}

resolve_optional_content_for_plan() {
    local entry_source
    entry_source="$(install_plan_entry_source)"

    if interactive_wizard_enabled; then
        if [ -z "${SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA:-}" ]; then
            if [ "$SEQDESK_DEPLOYMENT_PROFILE" = "research-workbench" ]; then
                # The existing deterministic fixture models facility orders and
                # studies. Offering it in Workbench would teach the wrong first
                # journey; Workbench onboarding uses upload/import instead.
                SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA="false"
                SEQDESK_OPTIONAL_EXAMPLE_DATA_SOURCE="default"
            else
                print_info "Evaluation content — optional synthetic example data"
                echo "  This creates clearly labelled example orders, studies, samples, and small synthetic FASTQ files."
                echo "  It is for evaluating the selected workflow, not for production use, and can be removed later."
                if [ "$SEQDESK_ACCESS_AUDIENCE" = "team-server" ]; then
                    echo "  Team-server installations default to no example data."
                fi
                prompt_yes_no SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA \
                    "  Install deterministic example data?" "n"
                SEQDESK_OPTIONAL_EXAMPLE_DATA_SOURCE="answer"
            fi
        else
            SEQDESK_OPTIONAL_EXAMPLE_DATA_SOURCE="$entry_source"
        fi

        if [ -z "${SEQDESK_TELEMETRY_ENABLED:-}" ]; then
            print_info "Privacy — optional operational telemetry"
            echo "  If enabled, SeqDesk sends version, platform, uptime, and health status to seqdesk.org."
            echo "  It does not send names, email addresses, projects, samples, files, or analysis results."
            echo "  This is off by default and can be changed later in Admin settings."
            prompt_yes_no SEQDESK_TELEMETRY_ENABLED "  Enable optional telemetry?" "n"
            SEQDESK_OPTIONAL_TELEMETRY_SOURCE="answer"
        else
            SEQDESK_OPTIONAL_TELEMETRY_SOURCE="$entry_source"
        fi
        return 0
    fi

    # Absence of an explicit automated/hosted value is consent to nothing and
    # does not populate an evaluation dataset.
    if [ -z "${SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA:-}" ]; then
        SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA="false"
        SEQDESK_OPTIONAL_EXAMPLE_DATA_SOURCE="default"
    else
        SEQDESK_OPTIONAL_EXAMPLE_DATA_SOURCE="$entry_source"
    fi
    if [ -z "${SEQDESK_TELEMETRY_ENABLED:-}" ]; then
        SEQDESK_TELEMETRY_ENABLED="false"
        SEQDESK_OPTIONAL_TELEMETRY_SOURCE="default"
    else
        SEQDESK_OPTIONAL_TELEMETRY_SOURCE="$entry_source"
    fi
}

deployment_profile_storage_label() {
    case "${1:-}" in
        sequencing-center) printf '%s' "Sequencing data" ;;
        shared-lab) printf '%s' "Shared sequencing and analysis data" ;;
        research-workbench) printf '%s' "Managed datasets" ;;
        *) printf '%s' "Managed data" ;;
    esac
}

is_loopback_bind_host() {
    case "${1:-}" in
        127.0.0.1|localhost|::1|'[::1]') return 0 ;;
        *) return 1 ;;
    esac
}

is_loopback_browser_url() {
    node -e '
      try {
        const hostname = new URL(process.argv[1]).hostname.toLowerCase();
        const loopback = hostname === "localhost" || hostname.endsWith(".localhost") ||
          hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
        process.exit(loopback ? 0 : 1);
      } catch { process.exit(1); }
    ' "${1:-}" >/dev/null 2>&1
}

is_valid_port() {
    local value="${1:-}"
    [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -ge 1 ] && [ "$value" -le 65535 ]
}

is_valid_http_url() {
    node -e '
      try {
        const url = new URL(process.argv[1]);
        const protocolOk = url.protocol === "http:" || url.protocol === "https:";
        const isOrigin = (url.pathname === "" || url.pathname === "/") && !url.search && !url.hash;
        const noCredentials = !url.username && !url.password;
        process.exit(protocolOk && isOrigin && noCredentials ? 0 : 1);
      } catch { process.exit(1); }
    ' "${1:-}" >/dev/null 2>&1
}

is_https_url() {
    node -e '
      try { process.exit(new URL(process.argv[1]).protocol === "https:" ? 0 : 1); }
      catch { process.exit(1); }
    ' "${1:-}" >/dev/null 2>&1
}

interactive_prompt_port() {
    local default_value="${1:-8000}" reply
    while true; do
        reply=$(read_input "  Internal app port [$default_value]: ")
        reply=${reply:-$default_value}
        if is_valid_port "$reply"; then
            SEQDESK_PORT="$reply"
            return 0
        fi
        print_error "  Enter a port number between 1 and 65535."
    done
}

interactive_prompt_browser_url() {
    local require_https="${1:-false}" default_value="${2:-}" reply
    while true; do
        reply=$(read_input "  Browser URL${default_value:+ [$default_value]}: ")
        reply=${reply:-$default_value}
        if ! is_valid_http_url "$reply"; then
            print_error "  Enter a complete http:// or https:// URL."
            continue
        fi
        if [ "$require_https" = "true" ] && ! is_https_url "$reply"; then
            print_error "  Team-server access requires the canonical HTTPS URL."
            echo "  Configure a reverse proxy/TLS endpoint first, or choose Advanced/custom."
            continue
        fi
        SEQDESK_NEXTAUTH_URL="$reply"
        return 0
    done
}

confirm_non_loopback_bind() {
    local answer
    is_loopback_bind_host "$SEQDESK_BIND_HOST" && return 0
    print_warning "  SeqDesk will listen beyond this computer on $SEQDESK_BIND_HOST."
    echo "  Use a firewall and an HTTPS reverse proxy; the installer does not configure TLS."
    answer=$(read_input "  Continue with network-accessible binding? (y/N): ")
    is_truthy "$answer"
}

normalize_access_topology() {
    SEQDESK_PORT="${SEQDESK_PORT:-8000}"
    SEQDESK_BIND_HOST="${SEQDESK_BIND_HOST:-127.0.0.1}"

    if [ -z "$SEQDESK_ACCESS_AUDIENCE" ]; then
        if is_loopback_bind_host "$SEQDESK_BIND_HOST"; then
            if [ -z "$SEQDESK_NEXTAUTH_URL" ] || is_loopback_browser_url "$SEQDESK_NEXTAUTH_URL"; then
                SEQDESK_ACCESS_AUDIENCE="local"
            elif is_https_url "$SEQDESK_NEXTAUTH_URL"; then
                # The normal team-server topology keeps SeqDesk itself on
                # loopback and exposes only an HTTPS reverse proxy. Older
                # settings files did not persist the human-facing audience, so
                # infer it without rewriting the preserved URL or bind host.
                SEQDESK_ACCESS_AUDIENCE="team-server"
            else
                SEQDESK_ACCESS_AUDIENCE="advanced"
            fi
        else
            SEQDESK_ACCESS_AUDIENCE="advanced"
        fi
    fi

    if [ -z "$SEQDESK_NEXTAUTH_URL" ]; then
        SEQDESK_NEXTAUTH_URL="http://localhost:${SEQDESK_PORT}"
    fi

    case "$SEQDESK_ACCESS_AUDIENCE" in
        local|team-server|advanced) ;;
        *)
            print_error "Unknown access audience: $SEQDESK_ACCESS_AUDIENCE"
            print_info "Choose local, team-server, or advanced."
            return 1
            ;;
    esac
    if ! is_valid_port "$SEQDESK_PORT"; then
        print_error "App port must be between 1 and 65535."
        return 1
    fi
    if ! is_valid_http_url "$SEQDESK_NEXTAUTH_URL"; then
        print_error "Browser URL must be an http:// or https:// origin without credentials, path, query, or fragment."
        return 1
    fi
    if [ "$SEQDESK_ACCESS_AUDIENCE" = "local" ]; then
        if ! is_loopback_bind_host "$SEQDESK_BIND_HOST" || \
            ! is_loopback_browser_url "$SEQDESK_NEXTAUTH_URL"; then
            print_error "Local access requires both a loopback bind host and a localhost browser URL."
            return 1
        fi
    elif [ "$SEQDESK_ACCESS_AUDIENCE" = "team-server" ]; then
        if ! is_https_url "$SEQDESK_NEXTAUTH_URL" || is_loopback_browser_url "$SEQDESK_NEXTAUTH_URL"; then
            print_error "Team-server access requires a non-local canonical HTTPS browser URL."
            return 1
        fi
    fi
}

prompt_access_topology() {
    if [ -n "$SEQDESK_ACCESS_AUDIENCE" ]; then
        normalize_access_topology || return 1
        if ! confirm_non_loopback_bind; then
            print_error "  Network-accessible binding was not confirmed."
            return 1
        fi
        return 0
    fi

    print_info "Access — where will people open SeqDesk?"
    echo "    1) Only on this computer (recommended for evaluation or personal use)"
    echo "    2) On a trusted team server/intranet (requires prepared DNS and your HTTPS reverse proxy)"
    echo "    3) Advanced/custom"

    local access_choice
    while true; do
        access_choice=$(read_input "  Choose [1]: ")
        access_choice=${access_choice:-1}
        case "$access_choice" in
            1|local)
                SEQDESK_ACCESS_AUDIENCE="local"
                SEQDESK_BIND_HOST="127.0.0.1"
                interactive_prompt_port "${SEQDESK_PORT:-8000}"
                SEQDESK_NEXTAUTH_URL="http://localhost:${SEQDESK_PORT}"
                break
                ;;
            2|team-server|team)
                SEQDESK_ACCESS_AUDIENCE="team-server"
                # A reverse proxy on this host can reach loopback, and keeping
                # the application itself off the network is the safer default.
                # Containers or remote proxies belong in Advanced/custom,
                # where the non-loopback listener is acknowledged explicitly.
                SEQDESK_BIND_HOST="127.0.0.1"
                interactive_prompt_port "${SEQDESK_PORT:-8000}"
                interactive_prompt_browser_url "true" "${SEQDESK_NEXTAUTH_URL:-}"
                echo "  Keep SeqDesk behind an HTTPS reverse proxy on this host."
                echo "  Configure firewall/VPN, backups, and monitoring before production use."
                echo "  This choice is not intended for direct public-Internet exposure."
                break
                ;;
            3|advanced)
                SEQDESK_ACCESS_AUDIENCE="advanced"
                local default_bind_host="${SEQDESK_BIND_HOST:-127.0.0.1}"
                SEQDESK_BIND_HOST=$(read_input "  Bind host [$default_bind_host]: ")
                SEQDESK_BIND_HOST=${SEQDESK_BIND_HOST:-$default_bind_host}
                interactive_prompt_port "${SEQDESK_PORT:-8000}"
                interactive_prompt_browser_url "false" "${SEQDESK_NEXTAUTH_URL:-http://localhost:${SEQDESK_PORT}}"
                if confirm_non_loopback_bind; then
                    break
                fi
                print_info "  Choose local access or confirm the non-loopback binding."
                ;;
            *)
                print_error "  Choose 1, 2, or 3."
                ;;
        esac
    done

    normalize_access_topology || return 1
    print_success "  Browser URL: $SEQDESK_NEXTAUTH_URL"
    print_info "  Local health checks always use http://127.0.0.1:${SEQDESK_PORT}."
}

canonicalize_guided_path() {
    node -e '
      const fs = require("node:fs");
      const path = require("node:path");
      const requested = path.resolve(process.argv[1]);
      let existing = requested;
      const suffix = [];
      while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) break;
        suffix.unshift(path.basename(existing));
        existing = parent;
      }
      const base = fs.existsSync(existing) ? fs.realpathSync(existing) : existing;
      process.stdout.write(path.join(base, ...suffix));
    ' "$1"
}

path_relation() {
    node -e '
      const path = require("node:path");
      const a = path.resolve(process.argv[1]);
      const b = path.resolve(process.argv[2]);
      const inside = (child, parent) => {
        const rel = path.relative(parent, child);
        return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
      };
      process.stdout.write(a === b ? "equal" : inside(a, b) ? "inside" : inside(b, a) ? "contains" : "disjoint");
    ' "$1" "$2"
}

nearest_existing_directory() {
    local candidate="$1" parent
    while [ ! -e "$candidate" ]; do
        parent=$(dirname "$candidate")
        [ "$parent" != "$candidate" ] || break
        candidate="$parent"
    done
    [ -d "$candidate" ] || return 1
    printf '%s' "$candidate"
}

validate_guided_storage_path() {
    local label="$1" requested="$2" canonical relation ancestor
    requested="$(expand_home_relative_path "$requested")"
    canonical="$(canonicalize_guided_path "$requested" 2>/dev/null || true)"
    if [ -z "$canonical" ] || [ "$canonical" = "/" ]; then
        print_error "  $label cannot be the filesystem root."
        return 1
    fi

    local canonical_home canonical_install
    canonical_home="$(canonicalize_guided_path "$HOME" 2>/dev/null || printf '%s' "$HOME")"
    canonical_install="$(canonicalize_guided_path "$SEQDESK_DIR" 2>/dev/null || printf '%s' "$SEQDESK_DIR")"
    if [ "$canonical" = "$canonical_home" ]; then
        print_error "  $label cannot be the home directory itself; choose a dedicated subdirectory."
        return 1
    fi
    relation="$(path_relation "$canonical" "$canonical_install")"
    if [ "$relation" != "disjoint" ]; then
        if is_truthy "${SEQDESK_STORAGE_ALLOW_INSTALL_OVERLAP:-}"; then
            print_warning "  $label uses a legacy path inside the existing application directory: $canonical"
            echo "  It is preserved for reconfiguration; migrate it separately before changing this path."
        else
            print_error "  $label must be separate from the application directory $SEQDESK_DIR."
            echo "  This keeps scientific data out of application update/rollback operations."
            return 1
        fi
    fi
    if [ -e "$canonical" ] && [ ! -d "$canonical" ]; then
        print_error "  $label exists but is not a directory: $canonical"
        return 1
    fi
    ancestor="$(nearest_existing_directory "$canonical" 2>/dev/null || true)"
    if [ -z "$ancestor" ] || [ ! -w "$ancestor" ]; then
        print_error "  $label cannot be created or written by the current user: $canonical"
        return 1
    fi

    INTERACTIVE_RESULT="$canonical"
    print_success "  $label: $canonical ($(get_disk_info "$ancestor"))"
}

validate_guided_storage_layout() {
    local relation
    validate_guided_storage_path "$(deployment_profile_storage_label "$SEQDESK_DEPLOYMENT_PROFILE")" "$SEQDESK_DATA_PATH" || return 1
    SEQDESK_DATA_PATH="$INTERACTIVE_RESULT"

    if is_truthy "$SEQDESK_WITH_PIPELINES"; then
        validate_guided_storage_path "Pipeline run directory" "$SEQDESK_RUN_DIR" || return 1
        SEQDESK_RUN_DIR="$INTERACTIVE_RESULT"
        validate_guided_storage_path "Pipeline database/cache directory" "$SEQDESK_PIPELINE_DATABASE_DIR" || return 1
        SEQDESK_PIPELINE_DATABASE_DIR="$INTERACTIVE_RESULT"
        relation="$(path_relation "$SEQDESK_RUN_DIR" "$SEQDESK_PIPELINE_DATABASE_DIR")"
        if [ "$relation" != "disjoint" ]; then
            print_error "  Pipeline run and database/cache directories must not overlap."
            return 1
        fi
    fi
}

prepare_storage_directory() {
    local label="$1" storage_dir="$2" probe_error=""
    [ -n "$storage_dir" ] || return 0

    if [ -e "$storage_dir" ] && [ ! -d "$storage_dir" ]; then
        print_error "$label exists but is not a directory: $storage_dir"
        return 1
    fi
    if [ ! -d "$storage_dir" ]; then
        if ! mkdir -p "$storage_dir" 2>/dev/null; then
            print_error "Could not create $label: $storage_dir"
            return 1
        fi
        print_success "Created $label: $storage_dir"
    fi

    # The PM2 service runs as the user executing this installer. Exercise the
    # operations scientific-data ingestion and workflow staging rely on rather
    # than accepting a path merely because its parent looked writable earlier.
    # The authenticated first-login readiness check remains the authoritative
    # profile check and records longer-lived evidence after startup.
    if ! probe_error="$(node -e '
      const fs = require("node:fs");
      const path = require("node:path");
      const root = process.argv[1];
      let probeDir;
      try {
        probeDir = fs.mkdtempSync(path.join(root, ".seqdesk-install-probe-"));
        const pending = path.join(probeDir, "pending");
        const committed = path.join(probeDir, "committed");
        const fd = fs.openSync(pending, "wx", 0o600);
        try {
          fs.writeFileSync(fd, "seqdesk-storage-probe\n");
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(pending, committed);
        fs.unlinkSync(committed);
        fs.rmdirSync(probeDir);
      } catch (error) {
        if (probeDir) {
          try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}
        }
        process.stderr.write(error && error.message ? error.message : String(error));
        process.exit(1);
      }
    ' "$storage_dir" 2>&1)"; then
        print_error "$label is not usable by the SeqDesk service user: $storage_dir"
        [ -z "$probe_error" ] || print_info "  Storage probe: $probe_error"
        return 1
    fi

    print_success "$label write/rename/delete probe passed: $storage_dir"
}

prepare_storage_layout() {
    prepare_storage_directory "Managed data directory" "$SEQDESK_DATA_PATH" || return 1
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        prepare_storage_directory "Pipeline run directory" "$SEQDESK_RUN_DIR" || return 1
        prepare_storage_directory "Pipeline database/cache directory" "$SEQDESK_PIPELINE_DATABASE_DIR" || return 1
    fi
}

normalize_storage_layout() {
    if [ -z "$SEQDESK_DATA_PATH" ] && ! is_truthy "${SEQDESK_RECONFIGURE:-}"; then
        SEQDESK_DATA_PATH="$(dirname "$SEQDESK_DIR")/$(basename "$SEQDESK_DIR")-data"
    fi
    [ -n "$SEQDESK_DATA_PATH" ] || return 0

    if [ "${PIPELINES_ENABLED:-false}" = "true" ]; then
        SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-${SEQDESK_DATA_PATH%/}/pipeline-runs}"
        SEQDESK_PIPELINE_DATABASE_DIR="${SEQDESK_PIPELINE_DATABASE_DIR:-${SEQDESK_DATA_PATH%/}/pipeline-databases}"
    fi
    if is_truthy "${SEQDESK_RECONFIGURE:-}" || is_truthy "${SEQDESK_UPDATE_EXISTING:-}"; then
        SEQDESK_STORAGE_ALLOW_INSTALL_OVERLAP="true" validate_guided_storage_layout
    else
        validate_guided_storage_layout
    fi
}

prompt_profile_storage() {
    local data_label default_root use_recommended custom_path
    data_label="$(deployment_profile_storage_label "$SEQDESK_DEPLOYMENT_PROFILE")"
    default_root="$(dirname "$SEQDESK_DIR")/$(basename "$SEQDESK_DIR")-data"

    print_info "Storage — where should SeqDesk keep $data_label?"
    if [ -z "$SEQDESK_DATA_PATH" ]; then
        echo "  Recommended managed root: $default_root"
        echo "  It is separate from the application directory so updates do not move scientific data."
        use_recommended=$(read_input "  Use the recommended managed location? (Y/n): ")
        case "$use_recommended" in
            n|N|no|NO)
                while true; do
                    custom_path=$(read_input "  $data_label directory: ")
                    if [ -n "$custom_path" ]; then
                        SEQDESK_DATA_PATH="$custom_path"
                        break
                    fi
                    print_error "  A storage directory is required."
                done
                ;;
            *) SEQDESK_DATA_PATH="$default_root" ;;
        esac
    fi

    if is_truthy "$SEQDESK_WITH_PIPELINES"; then
        SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-${SEQDESK_DATA_PATH%/}/pipeline-runs}"
        SEQDESK_PIPELINE_DATABASE_DIR="${SEQDESK_PIPELINE_DATABASE_DIR:-${SEQDESK_DATA_PATH%/}/pipeline-databases}"
    fi

    while ! validate_guided_storage_layout; do
        print_info "  Choose a different dedicated storage root."
        SEQDESK_DATA_PATH=$(read_input "  $data_label directory: ")
        SEQDESK_RUN_DIR=""
        SEQDESK_PIPELINE_DATABASE_DIR=""
        if is_truthy "$SEQDESK_WITH_PIPELINES" && [ -n "$SEQDESK_DATA_PATH" ]; then
            SEQDESK_RUN_DIR="${SEQDESK_DATA_PATH%/}/pipeline-runs"
            SEQDESK_PIPELINE_DATABASE_DIR="${SEQDESK_DATA_PATH%/}/pipeline-databases"
        fi
    done
}

# The wizard is split so the database dependency can be verified between its two
# halves. Asking for accounts first meant a reviewer chose a password, was shown
# a generated one to "save now", and then watched the install abort on a
# database problem that had nothing to do with either.
run_interactive_wizard_database() {
    is_truthy "$SEQDESK_INTERACTIVE" || return 0
    if is_truthy "$SEQDESK_YES"; then
        return 0
    fi
    if [ -n "${SEQDESK_CONFIG:-}" ] || [ -n "${SEQDESK_PROFILE:-}" ]; then
        print_info "Config/profile supplied; skipping the interactive wizard."
        return 0
    fi

    if is_truthy "${SEQDESK_UPDATE_EXISTING:-}"; then
        print_header "Update existing SeqDesk installation"
        print_info "The deployment profile, access URL/bind, database, storage, accounts, and workflow settings are preserved."
        print_info "If this release requires a new choice, SeqDesk will show it as an onboarding/readiness item after the update."
        return 0
    fi

    if is_truthy "${SEQDESK_RECONFIGURE:-}"; then
        print_header "Reconfigure existing SeqDesk installation"
    else
        print_header "Guided setup"
    fi

    # The operating model determines the questions and onboarding that follow.
    prompt_deployment_profile
    if is_truthy "${SEQDESK_RECONFIGURE:-}"; then
        normalize_access_topology || return 1
        print_info "Access — current settings"
        echo "  Browser URL: $SEQDESK_NEXTAUTH_URL"
        echo "  Bind host: $SEQDESK_BIND_HOST"
        local change_access
        change_access=$(read_input "  Change access settings? (y/N): ")
        if is_truthy "$change_access"; then
            SEQDESK_ACCESS_AUDIENCE=""
            prompt_access_topology || return 1
        else
            print_info "  Existing access settings will be preserved."
        fi
    else
        prompt_access_topology
    fi

    if is_truthy "${SEQDESK_RECONFIGURE:-}" && [ -n "$SEQDESK_DATABASE_URL" ]; then
        print_info "Database — current connection"
        echo "  $(redact_database_url "$SEQDESK_DATABASE_URL")"
        echo "  Reconfiguration does not copy or migrate database contents."
        local change_database
        change_database=$(read_input "  Change the database connection? (y/N): ")
        if ! is_truthy "$change_database"; then
            print_info "  Existing database connection will be preserved."
            return 0
        fi
        print_warning "  A different database is a separate data set. SeqDesk will not move accounts or scientific records."
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        MACOS_POSTGRES_SOCKET_DIR=""
        SEQDESK_PRIVATE_POSTGRES="false"
    fi

    # Database
    print_info "Database — where should SeqDesk store its data?"
    if [ "${OS:-}" = "macos" ]; then
        echo "    1) Local PostgreSQL  — installed/started with Homebrew as your login user"
    else
        echo "    1) Local PostgreSQL  — the installer creates the role/database (needs sudo)"
    fi
    echo "    2) Existing/managed  — paste a PostgreSQL connection string"
    local db_choice
    db_choice=$(read_input "  Choose [1]: ")
    db_choice=${db_choice:-1}
    if [ "$db_choice" = "2" ]; then
        local url direct
        echo "  Connection strings contain credentials and are entered without echo."
        while true; do
            url=$(read_secret "  Runtime PostgreSQL URL: ")
            if [ -z "$url" ]; then
                print_error "  A connection string is required for this option."
                continue
            fi
            if ! is_postgres_url "$url"; then
                print_error "  That does not look like a postgresql:// connection string."
                continue
            fi
            SEQDESK_DATABASE_URL="$url"
            if interactive_test_database "$url"; then
                break
            fi
            print_info "  Enter a reachable URL, or use --config/--database-url for an advanced unattended plan."
        done
        echo "  Some hosted databases provide a separate direct/unpooled URL for schema migrations."
        while true; do
            direct=$(read_secret "  Direct migration URL (optional; blank uses the runtime URL): ")
            if [ -z "$direct" ]; then
                break
            fi
            if is_postgres_url "$direct"; then
                SEQDESK_DATABASE_DIRECT_URL="$direct"
                break
            else
                print_error "  The direct migration URL must start with postgresql://."
            fi
        done
    else
        if [ "${OS:-}" = "macos" ]; then
            print_info "  Using local PostgreSQL — reusing a healthy local server if there is one, otherwise SeqDesk installs its own."
        else
            print_info "  Using local PostgreSQL — the installer will create the role/database and generate a password."
        fi
    fi
}

run_interactive_wizard_accounts() {
    interactive_wizard_enabled || return 0

    prompt_profile_pipeline_support
    prompt_pipeline_executor
    prompt_profile_storage

    # Accounts
    print_info "Accounts — create exactly one initial administrator"
    echo "  Every account uses the same sign-in page; permissions decide what it can do."
    case "$SEQDESK_DEPLOYMENT_PROFILE" in
        sequencing-center)
            echo "  Researchers request work; facility operators process it; administrators configure SeqDesk."
            echo "  One account may combine these responsibilities."
            if [ "$SEQDESK_ACCESS_AUDIENCE" = "local" ]; then
                echo "  Researcher self-registration is enabled for local evaluation; invitations remain available."
            else
                echo "  Team-facing installations start invite-only; an administrator can deliberately open registration later."
            fi
            ;;
        shared-lab)
            echo "  Administrators can do normal lab work and additionally manage settings and accounts."
            echo "  Lab members join by invitation by default."
            ;;
        research-workbench)
            echo "  Administrators manage the installation but do not automatically enter private workspaces."
            echo "  Workbench members join by invitation by default."
            ;;
    esac
    interactive_prompt_name \
        "  Admin first name" "${SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME:-Admin}"
    SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME="$INTERACTIVE_RESULT"
    interactive_prompt_name \
        "  Admin last name" "${SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME:-User}"
    SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME="$INTERACTIVE_RESULT"
    local admin_email_default=""
    if [ "$SEQDESK_ACCESS_AUDIENCE" = "local" ]; then
        admin_email_default="admin@example.com"
    else
        echo "  The email is the administrator's login identifier."
        echo "  Password recovery by email is unavailable until mail is configured after login."
    fi
    interactive_prompt_email "  Admin email" "$admin_email_default"
    SEQDESK_BOOTSTRAP_ADMIN_EMAIL="$INTERACTIVE_RESULT"
    interactive_prompt_password "  Admin password"
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD="$INTERACTIVE_RESULT"
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="$INTERACTIVE_RESULT_GENERATED"
    if [ "$INTERACTIVE_RESULT_GENERATED" = "true" ]; then
        SEQDESK_GENERATED_ADMIN_PASSWORD="$INTERACTIVE_RESULT"
    fi

    # Every profile starts with one administrator. Member creation belongs in
    # authenticated onboarding so enrollment policy and invite scope are
    # already active; the installer never creates a generic demo login.
    SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED="0"
    print_info "  Additional accounts are invited after the first administrator signs in."

    print_success "Guided setup captured. Continuing the installation..."
}

# Turn every supported fresh install into the same secure bootstrap operation.
# Guided installs may collect a chosen password; unattended/configured installs
# get a generated one shown exactly once in the final summary after it is
# verified against the created account. Reconfigure never creates an account or
# changes credentials.
ensure_secure_bootstrap_accounts() {
    if is_truthy "$SEQDESK_RECONFIGURE" || is_truthy "$SEQDESK_UPDATE_EXISTING"; then
        return 0
    fi

    SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED="0"
    SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL=""
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD=""
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH=""

    if [ -z "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL" ]; then
        SEQDESK_BOOTSTRAP_ADMIN_EMAIL="admin@example.com"
    fi

    if [ -z "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD" ] && \
        [ -z "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH" ]; then
        local generated_password
        if ! generated_password="$(generate_postgres_password)"; then
            print_error "Cannot generate the initial administrator password: openssl, node and /dev/urandom are unavailable."
            exit 1
        fi
        SEQDESK_BOOTSTRAP_ADMIN_PASSWORD="$generated_password"
        SEQDESK_GENERATED_ADMIN_PASSWORD="$generated_password"
        SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="true"
        print_info "Generated a strong password for the initial administrator; it will be shown once after the account is verified."
    fi

    validate_bootstrap_plaintext_passwords
}

# Kept as a single entry point for callers (and tests) that drive the whole
# wizard in one go. The installer itself runs the two halves around the
# database preflight.
run_interactive_wizard() {
    run_interactive_wizard_database
    run_interactive_wizard_accounts
}

print_usage() {
    cat <<'EOF'
Usage:
  bash /tmp/seqdesk-install.sh --interactive [options]
  npx -y seqdesk@latest [options]
  seqdesk [options]
  curl -fsSL https://seqdesk.org/install.sh | bash -s -- -y [options]  # non-interactive fallback

Options:
  -y, --yes                    Non-interactive mode (accept defaults)
  --interactive                Guided setup wizard: choose the application mode,
                               access, database, storage, workflow runtime, and
                               one secure administrator account
  --verbose                    Print the diagnostic detail that normally goes
                               only to the install log
  --config <path-or-url>       Infrastructure JSON file (local path or https URL)
  --deployment-profile <id>   Operating model: sequencing-center, shared-lab,
                              or research-workbench. Guided installs require a
                              choice; legacy unattended installs warn and use
                              sequencing-center when omitted
  --profile <id>               Hosted install profile id (for example: twincore)
  --profile-code <code>        Access code for --profile
  --setting <id>               Alias for --profile
  --key <code>                 Alias for --profile-code
  --additional-setting <path=value>
                              Local profile/config override (repeatable)
  --additional-settings <path=value...>
                              One or more local profile/config overrides
  --additional-settings-file <path>
                              JSON overrides applied after --profile/--config
  --dir <path>                 Install directory
  --overwrite-existing         With -y, update a valid SeqDesk install in place. A partial or
                               unrelated target is backed up before replacement; its database is untouched
  --version <version>          Release version (default: latest)
  --with-pipelines             Install optional Conda/Nextflow pipeline support
  --without-pipelines          Install the core app only (default)
  --skip-deps                  Deprecated (ignored in distribution installer)
  --access <audience>          local, team-server, or advanced
  --bind-host <host>           App listener address (default: 127.0.0.1)
  --port <port>                App port
  --data-path <path>           Managed scientific-data directory
  --run-dir <path>             Pipeline run directory
  --pipeline-db-dir <path>     Pipeline database asset directory
  --nextauth-url <url>         NEXTAUTH_URL override
  --nextauth-secret <secret>   NEXTAUTH_SECRET override
  --database-url <url>         DATABASE_URL override
  --database-direct-url <url>  DIRECT_URL override for Prisma migrations
  --anthropic-api-key <key>    ANTHROPIC_API_KEY override
  --admin-secret <secret>      ADMIN_SECRET override
  --blob-read-write-token <token>  BLOB_READ_WRITE_TOKEN override
  --order-form-settings <path> Exported order form JSON to apply after seeding
  --study-form-settings <path> Exported study form JSON to apply after seeding
  --use-pm2                    Enable PM2 auto-restart setup
  --no-pm2                     Disable PM2 setup
  --run-doctor                 Run seqdesk doctor after install when available
  --plan                       Resolve, validate, and print a redacted plan only
  --json                       With --plan, emit one machine-readable JSON document
  --reconfigure                Reconfigure an existing install in place
  --reseed-db                  Force DB push + seed (default off for --reconfigure)
  --prepare-postgres           Prepare local PostgreSQL role/database, then exit
  -h, --help                   Show this help

Pipeline environment:
  SEQDESK_EXEC_CONDA_PATH      Existing Conda base to reuse, or an unused path
                               where Miniconda may be installed. This overrides
                               PATH and standard user-prefix discovery.

Examples:
  npx -y seqdesk@latest -y --deployment-profile sequencing-center
  npx -y seqdesk@latest -y --deployment-profile research-workbench
  npx -y seqdesk@latest -y --profile twincore --profile-code "$TWINCORE_SETUP_CODE"
  seqdesk -y --profile dev --profile-code "$SEQDESK_DEV_SETUP_CODE" --additional-settings-file /etc/seqdesk/install-overrides.json
  seqdesk -y --config https://example.org/infrastructure-setup.json
  seqdesk -y --reconfigure --config ./infrastructure-setup.json
  seqdesk -y --reconfigure --reseed-db --config ./infrastructure-setup.json
  # macOS (run Homebrew PostgreSQL as your login user):
  env SEQDESK_DATABASE_URL="postgresql://..." npx -y seqdesk@latest -y --prepare-postgres
  # Linux:
  sudo env SEQDESK_DATABASE_URL="postgresql://..." npx -y seqdesk@latest -y --prepare-postgres
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            -y|--yes)
                SEQDESK_YES="1"
                ;;
            --interactive)
                SEQDESK_INTERACTIVE="1"
                ;;
            --verbose)
                SEQDESK_VERBOSE="1"
                ;;
            --config)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --config"
                    exit 1
                fi
                SEQDESK_CONFIG="$2"
                shift
                ;;
            --deployment-profile|--deployment_profile)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --deployment-profile"
                    exit 1
                fi
                SEQDESK_DEPLOYMENT_PROFILE="$2"
                shift
                ;;
            --profile|--setting)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for $1"
                    exit 1
                fi
                SEQDESK_PROFILE="$2"
                shift
                ;;
            --profile-code|--profile_code|--key)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for $1"
                    exit 1
                fi
                SEQDESK_PROFILE_CODE="$2"
                shift
                ;;
            --additional-setting|--additional_setting)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for $1"
                    exit 1
                fi
                SEQDESK_ADDITIONAL_SETTINGS+=("$2")
                shift
                ;;
            --additional-settings|--additional_settings)
                shift
                if [ $# -eq 0 ] || [[ "$1" == -* ]]; then
                    print_error "Missing value for --additional-settings"
                    exit 1
                fi
                while [ $# -gt 0 ] && [[ "$1" != -* ]]; do
                    SEQDESK_ADDITIONAL_SETTINGS+=("$1")
                    shift
                done
                continue
                ;;
            --additional-settings-file|--additional_settings_file)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for $1"
                    exit 1
                fi
                SEQDESK_ADDITIONAL_SETTINGS_FILE="$2"
                shift
                ;;
            --dir)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --dir"
                    exit 1
                fi
                SEQDESK_DIR="$2"
                shift
                ;;
            --version)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --version"
                    exit 1
                fi
                SEQDESK_VERSION="$2"
                shift
                ;;
            --with-pipelines)
                SEQDESK_WITH_PIPELINES="1"
                ;;
            --without-pipelines)
                SEQDESK_WITH_PIPELINES="0"
                SEQDESK_WITH_CONDA="0"
                ;;
            --skip-deps)
                SEQDESK_SKIP_DEPS="1"
                ;;
            --access|--access-audience)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --access"
                    exit 1
                fi
                SEQDESK_ACCESS_AUDIENCE="$2"
                shift
                ;;
            --bind-host)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --bind-host"
                    exit 1
                fi
                SEQDESK_BIND_HOST="$2"
                shift
                ;;
            --port)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --port"
                    exit 1
                fi
                SEQDESK_PORT="$2"
                shift
                ;;
            --data-path)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --data-path"
                    exit 1
                fi
                SEQDESK_DATA_PATH="$2"
                shift
                ;;
            --run-dir)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --run-dir"
                    exit 1
                fi
                SEQDESK_RUN_DIR="$2"
                shift
                ;;
            --pipeline-db-dir|--pipeline-database-dir)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for $1"
                    exit 1
                fi
                SEQDESK_PIPELINE_DATABASE_DIR="$2"
                shift
                ;;
            --nextauth-url)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --nextauth-url"
                    exit 1
                fi
                SEQDESK_NEXTAUTH_URL="$2"
                shift
                ;;
            --nextauth-secret)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --nextauth-secret"
                    exit 1
                fi
                SEQDESK_NEXTAUTH_SECRET="$2"
                shift
                ;;
            --database-url)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --database-url"
                    exit 1
                fi
                SEQDESK_DATABASE_URL="$2"
                shift
                ;;
            --database-direct-url)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --database-direct-url"
                    exit 1
                fi
                SEQDESK_DATABASE_DIRECT_URL="$2"
                shift
                ;;
            --anthropic-api-key)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --anthropic-api-key"
                    exit 1
                fi
                SEQDESK_ANTHROPIC_API_KEY="$2"
                shift
                ;;
            --admin-secret)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --admin-secret"
                    exit 1
                fi
                SEQDESK_ADMIN_SECRET="$2"
                shift
                ;;
            --blob-read-write-token)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --blob-read-write-token"
                    exit 1
                fi
                SEQDESK_BLOB_READ_WRITE_TOKEN="$2"
                shift
                ;;
            --order-form-settings|--order_form_settings)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --order-form-settings"
                    exit 1
                fi
                SEQDESK_ORDER_FORM_SETTINGS="$2"
                shift
                ;;
            --study-form-settings|--study_form_settings)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --study-form-settings"
                    exit 1
                fi
                SEQDESK_STUDY_FORM_SETTINGS="$2"
                shift
                ;;
            --use-pm2)
                SEQDESK_USE_PM2="1"
                ;;
            --no-pm2)
                SEQDESK_USE_PM2="0"
                ;;
            --run-doctor)
                SEQDESK_RUN_DOCTOR="1"
                ;;
            --plan)
                SEQDESK_PLAN_ONLY="1"
                ;;
            --json)
                SEQDESK_PLAN_JSON="1"
                ;;
            --reconfigure)
                SEQDESK_RECONFIGURE="1"
                ;;
            --overwrite-existing|--overwrite_existing)
                SEQDESK_OVERWRITE_EXISTING="1"
                ;;
            --reseed-db|--reseed_db)
                SEQDESK_RESEED_DB="1"
                ;;
            --prepare-postgres|--bootstrap-postgres)
                SEQDESK_PREPARE_POSTGRES="1"
                ;;
            -h|--help)
                print_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                print_usage
                exit 1
                ;;
        esac
        shift
    done
}

apply_config_value() {
    local target_var="$1"
    local config_var="$2"
    local current_value="${!target_var:-}"
    local config_value="${!config_var:-}"

    if [ -z "$current_value" ] && [ -n "$config_value" ]; then
        printf -v "$target_var" '%s' "$config_value"
    fi
}

has_additional_settings() {
    [ -n "${SEQDESK_ADDITIONAL_SETTINGS_FILE:-}" ] || [ ${#SEQDESK_ADDITIONAL_SETTINGS[@]} -gt 0 ]
}

apply_additional_settings_to_config_path() {
    local config_path="$1"
    local settings_blob=""

    if ! has_additional_settings; then
        return 0
    fi

    if [ ${#SEQDESK_ADDITIONAL_SETTINGS[@]} -gt 0 ]; then
        settings_blob="$(printf '%s\n' "${SEQDESK_ADDITIONAL_SETTINGS[@]}")"
    fi

    if ! SEQDESK_ADDITIONAL_SETTINGS_FILE_PATH="${SEQDESK_ADDITIONAL_SETTINGS_FILE:-}" \
        SEQDESK_ADDITIONAL_SETTINGS_BLOB="$settings_blob" \
        node - "$config_path" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
const allowedRoots = new Set([
  "access",
  "app",
  "auth",
  "bootstrap",
  "deployment",
  "ena",
  "forms",
  "install",
  "moduleSettings",
  "modules",
  "notifications",
  "pipelines",
  "pipelineSmokeTests",
  "privatePipelines",
  "runtime",
  "seedData",
  "sequencingFiles",
  "sequencingTech",
  "site",
  "studies",
  "telemetry",
]);
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonFile(filePath, label) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function validatePathParts(parts, source) {
  if (parts.length === 0) {
    throw new Error(`Invalid additional setting path from ${source}.`);
  }
  if (!allowedRoots.has(parts[0])) {
    throw new Error(
      `Unsupported additional setting root "${parts[0]}" from ${source}.`
    );
  }
  for (const part of parts) {
    if (forbiddenKeys.has(part)) {
      throw new Error(`Forbidden additional setting key "${part}" from ${source}.`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(part)) {
      throw new Error(`Invalid additional setting key "${part}" from ${source}.`);
    }
  }
}

function parsePath(rawPath, source) {
  const path = String(rawPath || "").trim();
  const parts = path.split(".");
  if (
    !path ||
    parts.some((part) => part.length === 0 || part.trim() !== part)
  ) {
    throw new Error(`Invalid additional setting path "${rawPath}" from ${source}.`);
  }
  validatePathParts(parts, source);
  return parts;
}

function setDeepValue(root, parts, value) {
  let current = root;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function mergeValue(root, parts, value, source) {
  validatePathParts(parts, source);
  if (!isRecord(value)) {
    setDeepValue(root, parts, value);
    return;
  }

  let current = root;
  for (const part of parts) {
    if (!isRecord(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (key.includes(".")) {
      setDeepValue(current, parsePath(key, source), childValue);
    } else {
      mergeValue(root, [...parts, key], childValue, source);
    }
  }
}

function applyObjectOverrides(root, overrides, source) {
  for (const [key, value] of Object.entries(overrides)) {
    if (key.includes(".")) {
      setDeepValue(root, parsePath(key, source), value);
    } else {
      mergeValue(root, parsePath(key, source), value, source);
    }
  }
}

const config = parseJsonFile(configPath, "installer config");
const settingsFile = process.env.SEQDESK_ADDITIONAL_SETTINGS_FILE_PATH || "";
if (settingsFile) {
  applyObjectOverrides(
    config,
    parseJsonFile(settingsFile, "additional settings file"),
    settingsFile
  );
}

const inlineSettings = process.env.SEQDESK_ADDITIONAL_SETTINGS_BLOB || "";
for (const line of inlineSettings.split(/\n/).filter(Boolean)) {
  const equalsIndex = line.indexOf("=");
  if (equalsIndex <= 0) {
    throw new Error(`Additional setting must be dot.path=value: ${line}`);
  }
  const key = line.slice(0, equalsIndex);
  const value = line.slice(equalsIndex + 1);
  setDeepValue(config, parsePath(key, "CLI"), value);
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE
    then
        print_error "Failed to apply additional installer settings."
        print_troubleshooting_url
        exit 1
    fi

    print_success "Applied additional installer settings"
}

resolve_install_profile() {
    if [ -z "$SEQDESK_PROFILE" ]; then
        return 0
    fi

    if [ -n "$SEQDESK_CONFIG" ]; then
        print_error "Use either --profile or --config, not both."
        print_troubleshooting_url
        exit 1
    fi

    if [ -z "$SEQDESK_PROFILE_CODE" ]; then
        print_error "--profile-code is required when --profile is used."
        print_troubleshooting_url
        exit 1
    fi

    if ! is_safe_profile_registry_url "$SEQDESK_PROFILE_REGISTRY_URL"; then
        print_error "Hosted profile registry URLs must use HTTPS (plain HTTP is allowed only for localhost)."
        print_troubleshooting_url
        exit 1
    fi

    if ! command_exists curl; then
        print_error "curl is required to resolve hosted install profiles."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#what-the-installer-checks"
        exit 1
    fi

    local profile_url
    local profile_config
    local profile_id_path
    local fetch_detail
    profile_id_path="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$SEQDESK_PROFILE")"
    profile_url="${SEQDESK_PROFILE_REGISTRY_URL%/}/${profile_id_path}/resolve"
    profile_config="$(mktemp)"

    print_info "Resolving hosted install profile: $SEQDESK_PROFILE"
    if ! curl_fetch_to_file "$profile_url" "$profile_config" \
        --max-redirs 0 \
        --proto-redir '=https' \
        -H "Authorization: Bearer ${SEQDESK_PROFILE_CODE}"; then
        rm -f "$profile_config"
        fetch_detail="$(curl_failure_detail)"
        print_error "Failed to resolve hosted install profile '$SEQDESK_PROFILE'. Check the profile id and access code."
        print_kv "URL" "$profile_url"
        if [ -n "$fetch_detail" ]; then
            print_kv "Result" "$fetch_detail"
        fi
        print_network_failure_hints
        print_troubleshooting_url
        exit 1
    fi

    SEQDESK_CONFIG="$profile_config"
    SEQDESK_PROFILE_CONFIG_FILE="$profile_config"
    print_success "Resolved hosted install profile"
}

load_install_config() {
    local config_ref="$1"
    local config_path="$config_ref"
    local temp_json=""
    local temp_env=""
    local fetch_detail=""

    if ! command_exists node; then
        print_error "Node.js is required to parse --config JSON."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-installer-stops-before-downloading-seqdesk"
        exit 1
    fi

    if [[ "$config_ref" =~ ^https?:// ]]; then
        if ! command_exists curl; then
            print_error "curl is required to download config URL: $config_ref"
            print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#what-the-installer-checks"
            exit 1
        fi
        temp_json=$(mktemp)
        if ! curl_fetch_to_file "$config_ref" "$temp_json"; then
            rm -f "$temp_json"
            fetch_detail="$(curl_failure_detail)"
            print_error "Failed to download config: $config_ref"
            if [ -n "$fetch_detail" ]; then
                print_kv "Result" "$fetch_detail"
            fi
            print_network_failure_hints
            print_troubleshooting_url
            exit 1
        fi
        config_path="$temp_json"
    elif [ ! -f "$config_ref" ]; then
        print_error "Config file not found: $config_ref"
        print_troubleshooting_url
        exit 1
    fi

    if has_additional_settings; then
        if [ "$config_path" = "${SEQDESK_PROFILE_CONFIG_FILE:-}" ] || [ -n "$temp_json" ]; then
            apply_additional_settings_to_config_path "$config_path"
        else
            temp_json=$(mktemp)
            cp "$config_path" "$temp_json"
            config_path="$temp_json"
            apply_additional_settings_to_config_path "$config_path"
        fi
    fi

    temp_env=$(mktemp)
    if ! SEQDESK_EXPECTED_PROFILE_ID="${SEQDESK_PROFILE:-}" \
        node - "$config_path" >"$temp_env" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
const raw = fs.readFileSync(configPath, "utf8");
const input = JSON.parse(raw);

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value) {
  return isRecord(value) ? value : undefined;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function toOptionalString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "off"].includes(normalized)) return false;
  return undefined;
}

function toOptionalInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

function toOptionalPort(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("app.port must be an integer between 1 and 65535.");
  }
  return parsed;
}

function escapeShell(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

// `--config` is both an installer input and, for hosted profiles, an envelope
// for settings applied after installation. Keep the stable envelopes closed so
// a typo cannot silently fall back to a default. Deliberately extensible leaves
// (form field definitions, pipeline parameter maps, fixtures, and similar
// payloads) are not traversed here; their owning subsystem validates them.
const configFieldSchemas = [
  {
    path: [],
    keys: [
      "_comment",
      "access",
      "accessAudience",
      "addons",
      "adminSecret",
      "anthropicApiKey",
      "app",
      "appPort",
      "appliedAt",
      "auth",
      "bindHost",
      "blobReadWriteToken",
      "bootstrap",
      "capabilities",
      "clusterOptions",
      "condaBase",
      "condaEnv",
      "condaEnvironment",
      "condaPath",
      "dataBasePath",
      "databaseDirectory",
      "databaseUrl",
      "deployment",
      "deploymentProfile",
      "directUrl",
      "dir",
      "ena",
      "enabled",
      "environment",
      "forms",
      "hostedDatabase",
      "id",
      "install",
      "installDir",
      "installProfile",
      "lastUpdated",
      "metaxpathKey",
      "metaxpathPackageSha256",
      "metaxpathPackageUrl",
      "metaxpathSha256",
      "metaxpathToken",
      "metaxpathUrl",
      "minSeqDeskVersion",
      "minknowStream",
      "moduleSettings",
      "modules",
      "name",
      "nextAuthSecret",
      "nextAuthUrl",
      "nextauthSecret",
      "nextauthUrl",
      "nextflowProfile",
      "nextflowWeblogUrl",
      "notifications",
      "orderFormConfig",
      "orderFormSettings",
      "order_form_settings",
      "pipelineDatabaseDir",
      "pipelineDatabaseDirectory",
      "pipelineEnabled",
      "pipelineRunDir",
      "pipelineSmokeTests",
      "pipelines",
      "pipelinesEnabled",
      "pm2",
      "port",
      "privatePipelines",
      "profile",
      "requiredSecrets",
      "requiresAccessCode",
      "runDirectory",
      "runtime",
      "seedData",
      "seqdeskDir",
      "sequencingDataDir",
      "sequencingDataPath",
      "sequencingFiles",
      "sequencingTech",
      "shortDescription",
      "site",
      "slurmCores",
      "slurmMemory",
      "slurmOptions",
      "slurmQueue",
      "slurmTimeLimit",
      "studies",
      "studyFormConfig",
      "studyFormSettings",
      "study_form_settings",
      "telemetry",
      "testing",
      "updateServer",
      "usePm2",
      "useSlurm",
      "version",
      "weblogSecret",
      "weblogUrl",
    ],
  },
  {
    path: ["access"],
    keys: [
      "allowDeleteSubmittedOrders",
      "allowUserAssemblyDownload",
      "departmentSharing",
      "orderNotesEnabled",
      "postSubmissionInstructions",
    ],
  },
  { path: ["addons"], keys: ["notifications"] },
  { path: ["addons", "notifications"], keys: ["enabled"] },
  {
    path: ["app"],
    keys: [
      "accessAudience",
      "bindHost",
      "databaseUrl",
      "nextAuthSecret",
      "nextAuthUrl",
      "port",
    ],
  },
  {
    path: ["auth"],
    keys: ["allowRegistration", "requireEmailVerification", "sessionTimeout"],
  },
  { path: ["bootstrap"], keys: ["includeDummyData", "users"] },
  { path: ["bootstrap", "users"], keys: ["admin", "researcher"] },
  {
    path: ["bootstrap", "users", "admin"],
    keys: ["email", "facilityName", "firstName", "lastName", "password", "passwordHash"],
  },
  {
    path: ["bootstrap", "users", "researcher"],
    keys: [
      "email",
      "firstName",
      "institution",
      "lastName",
      "password",
      "passwordHash",
      "researcherRole",
      "role",
    ],
  },
  { path: ["deployment"], keys: ["onboardingVersion", "profile"] },
  {
    path: ["ena"],
    keys: [
      "brokerAccount",
      "centerName",
      "enaPassword",
      "enaUsername",
      "ena_password",
      "ena_username",
      "password",
      "testMode",
      "username",
      "webinPassword",
      "webinUsername",
      "webin_password",
      "webin_username",
    ],
  },
  {
    path: ["forms"],
    keys: [
      "order",
      "orderConfig",
      "orderFormSettings",
      "order_form_settings",
      "runAssignment",
      "study",
      "studyConfig",
      "studyFormSettings",
      "study_form_settings",
    ],
  },
  {
    path: ["forms", "order"],
    keys: ["defaultsVersion", "enabledMixsChecklists", "fields", "groups"],
    allowStringValue: true,
  },
  {
    path: ["forms", "study"],
    keys: ["defaultsVersion", "enabledMixsChecklists", "fields", "groups"],
    allowStringValue: true,
  },
  {
    path: ["forms", "runAssignment"],
    keys: ["defaultsVersion", "enabledMixsChecklists", "fields", "groups"],
  },
  {
    path: ["hostedDatabase"],
    keys: [
      "branchId",
      "createdAt",
      "databaseName",
      "deletedAt",
      "endpointId",
      "error",
      "lastTest",
      "operationIds",
      "projectId",
      "projectName",
      "provider",
      "regionId",
      "roleName",
      "status",
      "updatedAt",
    ],
  },
  { path: ["hostedDatabase", "lastTest"], keys: ["at", "message", "status"] },
  {
    path: ["install"],
    keys: ["accessAudience", "bindHost", "dir", "installDir", "pm2", "usePm2"],
  },
  { path: ["installProfile"], keys: ["appliedAt", "id", "name", "version"] },
  {
    path: ["moduleSettings"],
    keys: ["account-validation", "billing-info"],
  },
  {
    path: ["moduleSettings", "account-validation"],
    keys: ["allowedDomains", "enforceValidation"],
  },
  {
    path: ["moduleSettings", "billing-info"],
    keys: [
      "costCenterEnabled",
      "costCenterExample",
      "costCenterPattern",
      "pspEnabled",
      "pspExample",
      "pspMainDigits",
      "pspPrefixRange",
      "pspSuffixRange",
    ],
  },
  { path: ["moduleSettings", "billing-info", "pspPrefixRange"], keys: ["max", "min"] },
  { path: ["moduleSettings", "billing-info", "pspSuffixRange"], keys: ["max", "min"] },
  {
    path: ["notifications"],
    keys: ["enabled", "events", "inApp", "provider", "relayToken", "relayUrl", "userDefaults"],
  },
  { path: ["notifications", "inApp"], keys: ["enabled"] },
  { path: ["notifications", "events"], keys: ["order", "ticket"] },
  {
    path: ["notifications", "events", "order"],
    keys: ["samplesSent", "statusChanged", "submitted"],
  },
  { path: ["notifications", "events", "ticket"], keys: ["created", "reply"] },
  { path: ["notifications", "userDefaults"], keys: ["orders", "support"] },
  { path: ["pipelineSmokeTests"], keys: ["enabled", "tests"] },
  {
    path: ["pipelines"],
    keys: [
      "configs",
      "databaseDirectory",
      "databases",
      "enable",
      "enabled",
      "execution",
      "executionOverrides",
      "mag",
      "pipelineOverrides",
      "pipelineConfigs",
    ],
    // Legacy profiles may put a pipeline id directly under `pipelines`.
    // Preserve those object-valued entries, but still reject near-miss keys.
    allowUnknownObjectKeys: true,
  },
  {
    path: ["pipelines", "execution"],
    keys: [
      "clusterOptions",
      "conda",
      "condaEnv",
      "condaPath",
      "mode",
      "nextflowProfile",
      "overrides",
      "pipelineDatabaseDir",
      "pipelineOverrides",
      "pipelineRunDir",
      "runDirectory",
      "slurm",
      "slurmCores",
      "slurmMemory",
      "slurmOptions",
      "slurmQueue",
      "slurmTimeLimit",
      "useSlurm",
      "weblogSecret",
      "weblogUrl",
    ],
  },
  {
    path: ["pipelines", "execution", "conda"],
    keys: ["cacheDir", "enabled", "environment", "path"],
  },
  {
    path: ["pipelines", "execution", "slurm"],
    keys: ["clusterOptions", "cores", "enabled", "memory", "options", "queue", "timeLimit"],
  },
  {
    path: ["pipelines", "mag"],
    keys: ["config", "enabled", "skipConcoct", "skipProkka", "stubMode", "version"],
  },
  {
    path: ["privatePipelines"],
    keys: ["metaxpath"],
  },
  {
    path: ["privatePipelines", "metaxpath"],
    keys: [
      "autoResolveReleaseAsset",
      "key",
      "packageUrl",
      "ref",
      "releaseTag",
      "repository",
      "sha256",
      "token",
      "url",
    ],
  },
  { path: ["profile"], keys: ["description", "environment", "facility", "name"] },
  {
    path: ["runtime"],
    keys: [
      "adminSecret",
      "anthropicApiKey",
      "blobReadWriteToken",
      "database",
      "databaseUrl",
      "directUrl",
      "nextAuthSecret",
      "nextAuthUrl",
      "updateServer",
      "weblogSecret",
      "weblogUrl",
    ],
  },
  { path: ["runtime", "database"], keys: ["mode"] },
  { path: ["seedData"], keys: ["enabled", "fixtures"] },
  {
    path: ["sequencingFiles"],
    keys: [
      "activeWriteMinAgeMs",
      "allowSingleEnd",
      "allowedExtensions",
      "autoAssign",
      "extensions",
      "ignorePatterns",
      "scanDepth",
      "simulationMode",
      "simulationTemplateDir",
    ],
  },
  { path: ["sequencingTech"], keys: ["config", "mode", "onlyDeviceIds"] },
  {
    path: ["site"],
    keys: [
      "contactEmail",
      "dataBasePath",
      "faviconUrl",
      "helpText",
      "logoUrl",
      "name",
      "primaryColor",
      "secondaryColor",
    ],
  },
  { path: ["telemetry"], keys: ["enabled", "endpoint", "intervalHours"] },
  { path: ["testing"], keys: ["apiBaseUrl", "metaxpath", "publicBaseUrl", "runtimeSmoke"] },
  {
    path: ["testing", "metaxpath"],
    keys: ["enabled", "fixtureId", "orderNumber", "paramsFile"],
  },
  {
    path: ["testing", "runtimeSmoke"],
    keys: [
      "enabled",
      "ensureDummyData",
      "expectDefaultMode",
      "pipelineId",
      "runLocal",
      "runSlurm",
      "timeoutSeconds",
    ],
  },
];

const pipelineExecutionOverrideKeys = [
  "clusterOptions",
  "mode",
  "nextflowProfile",
  "slurm",
  "slurmCores",
  "slurmMemory",
  "slurmOptions",
  "slurmQueue",
  "slurmTimeLimit",
];
const pipelineExecutionOverrideSlurmKeys = [
  "clusterOptions",
  "cores",
  "memory",
  "options",
  "queue",
  "timeLimit",
];
const pipelineExecutionOverrideMapPaths = [
  ["pipelines", "pipelineOverrides"],
  ["pipelines", "executionOverrides"],
  ["pipelines", "execution", "pipelineOverrides"],
  ["pipelines", "execution", "overrides"],
];

function valueAtPath(root, path) {
  let current = root;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function editDistance(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function nearestField(field, allowedFields) {
  let nearest;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of allowedFields) {
    const distance = editDistance(field, candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  const threshold = Math.max(2, Math.min(3, Math.floor(field.length / 3)));
  return nearestDistance <= threshold ? nearest : undefined;
}

function displayConfigPath(path) {
  return path.length > 0 ? path.join(".") : "configuration root";
}

function validateConfigObjectFields(value, path, schema) {
  const allowed = new Set(schema.keys);
  for (const field of Object.keys(value)) {
    if (allowed.has(field)) continue;
    const suggestion = nearestField(field, schema.keys);
    if (schema.allowUnknownObjectKeys && isRecord(value[field]) && !suggestion) {
      continue;
    }
    const fullPath = [...path, field].join(".");
    const hint = suggestion
      ? ` Did you mean "${[...path, suggestion].join(".")}"?`
      : ` Remove it or use a supported field under ${displayConfigPath(path)}.`;
    throw new Error(`Unknown installer config field "${fullPath}".${hint}`);
  }
}

function validatePipelineExecutionOverride(rawOverride, path) {
  if (rawOverride === undefined || rawOverride === null) return;
  if (!isRecord(rawOverride)) {
    throw new Error(`${displayConfigPath(path)} must be a JSON object.`);
  }
  validateConfigObjectFields(rawOverride, path, {
    keys: pipelineExecutionOverrideKeys,
  });

  const slurm = rawOverride.slurm;
  if (slurm === undefined || slurm === null) return;
  const slurmPath = [...path, "slurm"];
  if (!isRecord(slurm)) {
    throw new Error(`${displayConfigPath(slurmPath)} must be a JSON object.`);
  }
  validateConfigObjectFields(slurm, slurmPath, {
    keys: pipelineExecutionOverrideSlurmKeys,
  });
}

function validatePipelineExecutionOverrideMap(root, path) {
  const value = valueAtPath(root, path);
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    throw new Error(`${displayConfigPath(path)} must be a JSON object.`);
  }

  for (const [pipelineId, rawOverride] of Object.entries(value)) {
    validatePipelineExecutionOverride(rawOverride, [...path, pipelineId]);
  }
}

function validateDirectPipelineExecutionOverrides(root) {
  const pipelines = valueAtPath(root, ["pipelines"]);
  if (!isRecord(pipelines)) return;
  const envelopeSchema = configFieldSchemas.find(
    (schema) => schema.path.length === 1 && schema.path[0] === "pipelines"
  );
  const envelopeKeys = new Set(envelopeSchema?.keys || []);

  for (const [pipelineId, rawPipelineConfig] of Object.entries(pipelines)) {
    if (envelopeKeys.has(pipelineId) || !isRecord(rawPipelineConfig)) continue;
    for (const overrideKey of ["execution", "runtime"]) {
      validatePipelineExecutionOverride(rawPipelineConfig[overrideKey], [
        "pipelines",
        pipelineId,
        overrideKey,
      ]);
    }
  }
}

function validateKnownConfigFields(root) {
  for (const schema of configFieldSchemas) {
    const value = valueAtPath(root, schema.path);
    if (value === undefined || value === null) continue;
    if (!isRecord(value)) {
      if (schema.allowStringValue && typeof value === "string") continue;
      throw new Error(`${displayConfigPath(schema.path)} must be a JSON object.`);
    }
    validateConfigObjectFields(value, schema.path, schema);
  }

  for (const path of pipelineExecutionOverrideMapPaths) {
    validatePipelineExecutionOverrideMap(root, path);
  }
  validateDirectPipelineExecutionOverrides(root);
}

if (!isRecord(input)) {
  throw new Error("Config root must be a JSON object.");
}

const root = input;
validateKnownConfigFields(root);
const structuredSections = [
  "addons",
  "access",
  "app",
  "auth",
  "bootstrap",
  "deployment",
  "ena",
  "forms",
  "hostedDatabase",
  "install",
  "minknowStream",
  "modules",
  "moduleSettings",
  "notifications",
  "pipelineSmokeTests",
  "pipelines",
  "privatePipelines",
  "profile",
  "runtime",
  "seedData",
  "sequencingFiles",
  "sequencingTech",
  "site",
  "telemetry",
  "testing",
];
for (const section of structuredSections) {
  if (
    Object.prototype.hasOwnProperty.call(root, section) &&
    root[section] !== undefined &&
    root[section] !== null &&
    !isRecord(root[section])
  ) {
    throw new Error(`${section} must be a JSON object.`);
  }
}
for (const section of ["capabilities", "requiredSecrets", "studies"]) {
  if (
    Object.prototype.hasOwnProperty.call(root, section) &&
    root[section] !== undefined &&
    root[section] !== null &&
    !Array.isArray(root[section])
  ) {
    throw new Error(`${section} must be a JSON array.`);
  }
}

const expectedProfileId = toOptionalString(process.env.SEQDESK_EXPECTED_PROFILE_ID);
if (expectedProfileId) {
  const resolvedProfileId = toOptionalString(root.id);
  if (!resolvedProfileId) {
    throw new Error("Hosted profile resolver returned a profile without an id.");
  }
  if (resolvedProfileId !== expectedProfileId) {
    throw new Error(
      `Hosted profile id mismatch: requested ${expectedProfileId}, resolved ${resolvedProfileId}.`
    );
  }
}

const minSeqDeskVersion = toOptionalString(root.minSeqDeskVersion);
if (
  root.minSeqDeskVersion !== undefined &&
  (!minSeqDeskVersion ||
    !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(minSeqDeskVersion))
) {
  throw new Error("minSeqDeskVersion must be a semantic version such as 1.2.3.");
}

const app = toRecord(root.app);
const deployment = toRecord(root.deployment);
const install = toRecord(root.install);
const site = toRecord(root.site);
const pipelines = toRecord(root.pipelines);
const execution = toRecord(pipelines?.execution);
const conda = toRecord(execution?.conda);
const slurm = toRecord(execution?.slurm);
const runtime = toRecord(root.runtime);
const telemetry = toRecord(root.telemetry);
const notifications = toRecord(root.notifications);
const modules = toRecord(root.modules);
const bootstrap = toRecord(root.bootstrap);
const bootstrapUsers = toRecord(bootstrap?.users);
const bootstrapAdmin = toRecord(bootstrapUsers?.admin);
const bootstrapResearcher = toRecord(bootstrapUsers?.researcher);
const forms = toRecord(root.forms);
const privatePipelines = toRecord(root.privatePipelines);
const metaxpath = toRecord(privatePipelines?.metaxpath);

const featureModules = {};
for (const [moduleId, rawEnabled] of Object.entries(modules || {})) {
  const enabled = toOptionalBoolean(rawEnabled);
  if (enabled === undefined) {
    throw new Error(`modules.${moduleId} must be true or false.`);
  }
  featureModules[moduleId] = enabled;
}

const executionMode = toOptionalString(execution?.mode)?.toLowerCase();
const explicitUseSlurm = toOptionalBoolean(
  firstDefined(root.useSlurm, execution?.useSlurm, slurm?.enabled)
);
let useSlurm = explicitUseSlurm;
if (useSlurm === undefined) {
  if (executionMode === "slurm") {
    useSlurm = true;
  } else if (executionMode === "local" || executionMode === "kubernetes") {
    useSlurm = false;
  }
}

const values = {
  deploymentProfile: toOptionalString(
    firstDefined(root.deploymentProfile, deployment?.profile)
  ),
  accessAudience: toOptionalString(
    firstDefined(root.accessAudience, install?.accessAudience, app?.accessAudience)
  ),
  bindHost: toOptionalString(
    firstDefined(root.bindHost, install?.bindHost, app?.bindHost)
  ),
  installDir: toOptionalString(
    firstDefined(root.installDir, root.seqdeskDir, root.dir, install?.dir, install?.installDir)
  ),
  usePm2: toOptionalBoolean(
    firstDefined(root.usePm2, root.pm2, install?.usePm2, install?.pm2)
  ),
  port: toOptionalPort(firstDefined(root.port, root.appPort, app?.port)),
  minSeqDeskVersion,
  dataPath: toOptionalString(
    firstDefined(
      root.sequencingDataDir,
      root.sequencingDataPath,
      root.dataBasePath,
      site?.dataBasePath
    )
  ),
  runDir: toOptionalString(
    firstDefined(
      root.pipelineRunDir,
      root.runDirectory,
      execution?.runDirectory,
      execution?.pipelineRunDir
    )
  ),
  pipelineDatabaseDir: toOptionalString(
    firstDefined(
      root.pipelineDatabaseDir,
      root.pipelineDatabaseDirectory,
      root.databaseDirectory,
      pipelines?.databaseDirectory,
      execution?.pipelineDatabaseDir
    )
  ),
  nextAuthUrl: toOptionalString(
    firstDefined(
      root.nextAuthUrl,
      root.nextauthUrl,
      app?.nextAuthUrl,
      runtime?.nextAuthUrl
    )
  ),
  nextAuthSecret: toOptionalString(
    firstDefined(
      root.nextAuthSecret,
      root.nextauthSecret,
      app?.nextAuthSecret,
      runtime?.nextAuthSecret
    )
  ),
  databaseUrl: toOptionalString(
    firstDefined(root.databaseUrl, app?.databaseUrl, runtime?.databaseUrl)
  ),
  directUrl: toOptionalString(firstDefined(root.directUrl, runtime?.directUrl)),
  anthropicApiKey: toOptionalString(
    firstDefined(root.anthropicApiKey, runtime?.anthropicApiKey)
  ),
  adminSecret: toOptionalString(
    firstDefined(root.adminSecret, runtime?.adminSecret)
  ),
  blobReadWriteToken: toOptionalString(
    firstDefined(root.blobReadWriteToken, runtime?.blobReadWriteToken)
  ),
  updateServer: toOptionalString(
    firstDefined(root.updateServer, runtime?.updateServer)
  ),
  orderFormSettings: toOptionalString(
    firstDefined(
      root.orderFormSettings,
      root.order_form_settings,
      root.orderFormConfig,
      forms?.orderFormSettings,
      forms?.order_form_settings,
      forms?.order,
      forms?.orderConfig
    )
  ),
  studyFormSettings: toOptionalString(
    firstDefined(
      root.studyFormSettings,
      root.study_form_settings,
      root.studyFormConfig,
      forms?.studyFormSettings,
      forms?.study_form_settings,
      forms?.study,
      forms?.studyConfig
    )
  ),
  useSlurm,
  slurmQueue: toOptionalString(
    firstDefined(root.slurmQueue, execution?.slurmQueue, slurm?.queue)
  ),
  slurmCores: toOptionalInt(
    firstDefined(root.slurmCores, execution?.slurmCores, slurm?.cores)
  ),
  slurmMemory: toOptionalString(
    firstDefined(root.slurmMemory, execution?.slurmMemory, slurm?.memory)
  ),
  slurmTimeLimit: toOptionalInt(
    firstDefined(root.slurmTimeLimit, execution?.slurmTimeLimit, slurm?.timeLimit)
  ),
  slurmOptions: toOptionalString(
    firstDefined(
      root.slurmOptions,
      root.clusterOptions,
      execution?.slurmOptions,
      execution?.clusterOptions,
      slurm?.options,
      slurm?.clusterOptions
    )
  ),
  condaPath: toOptionalString(
    firstDefined(root.condaPath, root.condaBase, execution?.condaPath, conda?.path)
  ),
  condaEnv: toOptionalString(
    firstDefined(
      root.condaEnv,
      root.condaEnvironment,
      execution?.condaEnv,
      conda?.environment
    )
  ),
  nextflowProfile: toOptionalString(
    firstDefined(root.nextflowProfile, execution?.nextflowProfile)
  ),
  weblogUrl: toOptionalString(
    firstDefined(
      root.nextflowWeblogUrl,
      root.weblogUrl,
      execution?.weblogUrl,
      runtime?.weblogUrl
    )
  ),
  weblogSecret: toOptionalString(
    firstDefined(root.weblogSecret, execution?.weblogSecret, runtime?.weblogSecret)
  ),
  metaxpathPackageUrl: toOptionalString(
    firstDefined(
      root.metaxpathPackageUrl,
      root.metaxpathUrl,
      metaxpath?.packageUrl,
      metaxpath?.url
    )
  ),
  metaxpathKey: toOptionalString(
    firstDefined(root.metaxpathKey, root.metaxpathToken, metaxpath?.key, metaxpath?.token)
  ),
  metaxpathSha256: toOptionalString(
    firstDefined(root.metaxpathSha256, root.metaxpathPackageSha256, metaxpath?.sha256)
  ),
  telemetryEnabled: toOptionalBoolean(telemetry?.enabled),
  includeDummyData: toOptionalBoolean(bootstrap?.includeDummyData),
  telemetryEndpoint: toOptionalString(telemetry?.endpoint),
  telemetryIntervalHours: toOptionalInt(telemetry?.intervalHours),
  notificationsEnabled: toOptionalBoolean(notifications?.enabled),
  notificationProvider: toOptionalString(notifications?.provider),
  notificationRelayUrl: toOptionalString(notifications?.relayUrl),
  notificationRelayToken: toOptionalString(notifications?.relayToken),
  adminEmail: toOptionalString(bootstrapAdmin?.email),
  adminPassword: toOptionalString(bootstrapAdmin?.password),
  adminPasswordHash: toOptionalString(bootstrapAdmin?.passwordHash),
  adminFirstName: toOptionalString(bootstrapAdmin?.firstName),
  adminLastName: toOptionalString(bootstrapAdmin?.lastName),
  adminFacilityName: toOptionalString(bootstrapAdmin?.facilityName),
  researcherEmail: toOptionalString(bootstrapResearcher?.email),
  researcherPassword: toOptionalString(bootstrapResearcher?.password),
  researcherPasswordHash: toOptionalString(bootstrapResearcher?.passwordHash),
  researcherFirstName: toOptionalString(bootstrapResearcher?.firstName),
  researcherLastName: toOptionalString(bootstrapResearcher?.lastName),
  researcherInstitution: toOptionalString(bootstrapResearcher?.institution),
  researcherRole: toOptionalString(bootstrapResearcher?.researcherRole || bootstrapResearcher?.role),
};

if (
  Array.isArray(pipelines?.enable) &&
  !pipelines.enable.some(
    (pipelineId) => toOptionalString(pipelineId)?.toLowerCase() === "metaxpath"
  )
) {
  values.metaxpathPackageUrl = undefined;
  values.metaxpathKey = undefined;
  values.metaxpathSha256 = undefined;
}

if (values.runDir === "/") {
  values.runDir = undefined;
}

const explicitPipelines = toOptionalBoolean(
  firstDefined(root.pipelinesEnabled, root.pipelineEnabled, pipelines?.enabled)
);
let withPipelines = explicitPipelines;
if (withPipelines === undefined) {
  const hints = [
    values.runDir,
    values.pipelineDatabaseDir,
    values.useSlurm,
    values.condaPath,
    values.condaEnv,
    values.nextflowProfile,
    values.weblogUrl,
    values.weblogSecret,
    values.metaxpathPackageUrl,
    values.metaxpathKey,
    values.metaxpathSha256,
  ];
  if (hints.some((value) => value !== undefined && value !== "")) {
    withPipelines = true;
  }
}

const out = {};
out.SEQDESK_CFG_FEATURE_MODULES_JSON = JSON.stringify(featureModules);
if (values.deploymentProfile) {
  out.SEQDESK_CFG_DEPLOYMENT_PROFILE = values.deploymentProfile;
}
if (values.accessAudience) out.SEQDESK_CFG_ACCESS_AUDIENCE = values.accessAudience;
if (values.bindHost) out.SEQDESK_CFG_BIND_HOST = values.bindHost;
if (values.installDir) out.SEQDESK_CFG_DIR = values.installDir;
if (values.usePm2 !== undefined) out.SEQDESK_CFG_USE_PM2 = values.usePm2 ? "1" : "0";
if (values.port !== undefined && values.port > 0) out.SEQDESK_CFG_PORT = String(values.port);
if (values.minSeqDeskVersion) {
  out.SEQDESK_CFG_PROFILE_MIN_VERSION = values.minSeqDeskVersion;
}
if (values.dataPath) out.SEQDESK_CFG_DATA_PATH = values.dataPath;
if (values.runDir) out.SEQDESK_CFG_RUN_DIR = values.runDir;
if (values.pipelineDatabaseDir) out.SEQDESK_CFG_PIPELINE_DATABASE_DIR = values.pipelineDatabaseDir;
if (values.nextAuthUrl) out.SEQDESK_CFG_NEXTAUTH_URL = values.nextAuthUrl;
if (values.nextAuthSecret) out.SEQDESK_CFG_NEXTAUTH_SECRET = values.nextAuthSecret;
if (values.databaseUrl) out.SEQDESK_CFG_DATABASE_URL = values.databaseUrl;
if (values.directUrl) out.SEQDESK_CFG_DATABASE_DIRECT_URL = values.directUrl;
if (values.anthropicApiKey) out.SEQDESK_CFG_ANTHROPIC_API_KEY = values.anthropicApiKey;
if (values.adminSecret) out.SEQDESK_CFG_ADMIN_SECRET = values.adminSecret;
if (values.blobReadWriteToken) {
  out.SEQDESK_CFG_BLOB_READ_WRITE_TOKEN = values.blobReadWriteToken;
}
if (values.updateServer) out.SEQDESK_CFG_UPDATE_SERVER = values.updateServer;
if (values.orderFormSettings) {
  out.SEQDESK_CFG_ORDER_FORM_SETTINGS = values.orderFormSettings;
}
if (values.studyFormSettings) {
  out.SEQDESK_CFG_STUDY_FORM_SETTINGS = values.studyFormSettings;
}
if (values.telemetryEnabled !== undefined) {
  out.SEQDESK_CFG_TELEMETRY_ENABLED = values.telemetryEnabled ? "true" : "false";
}
if (values.includeDummyData !== undefined) {
  out.SEQDESK_CFG_BOOTSTRAP_INCLUDE_DUMMY_DATA = values.includeDummyData ? "true" : "false";
}
if (values.telemetryEndpoint) {
  out.SEQDESK_CFG_TELEMETRY_ENDPOINT = values.telemetryEndpoint;
}
if (values.telemetryIntervalHours !== undefined && values.telemetryIntervalHours > 0) {
  out.SEQDESK_CFG_TELEMETRY_INTERVAL_HOURS = String(values.telemetryIntervalHours);
}
if (values.notificationsEnabled !== undefined) {
  out.SEQDESK_CFG_NOTIFICATIONS_ENABLED = values.notificationsEnabled ? "true" : "false";
}
if (values.notificationProvider) {
  out.SEQDESK_CFG_NOTIFICATION_PROVIDER = values.notificationProvider;
}
if (values.notificationRelayUrl) {
  out.SEQDESK_CFG_NOTIFICATION_RELAY_URL = values.notificationRelayUrl;
}
if (values.notificationRelayToken) {
  out.SEQDESK_CFG_NOTIFICATION_RELAY_TOKEN = values.notificationRelayToken;
}
if (withPipelines !== undefined) out.SEQDESK_CFG_WITH_PIPELINES = withPipelines ? "1" : "0";
if (values.useSlurm !== undefined) {
  out.SEQDESK_CFG_EXEC_USE_SLURM = values.useSlurm ? "true" : "false";
}
if (values.slurmQueue) out.SEQDESK_CFG_EXEC_SLURM_QUEUE = values.slurmQueue;
if (values.slurmCores !== undefined && values.slurmCores > 0) {
  out.SEQDESK_CFG_EXEC_SLURM_CORES = String(values.slurmCores);
}
if (values.slurmMemory) out.SEQDESK_CFG_EXEC_SLURM_MEMORY = values.slurmMemory;
if (values.slurmTimeLimit !== undefined && values.slurmTimeLimit > 0) {
  out.SEQDESK_CFG_EXEC_SLURM_TIME_LIMIT = String(values.slurmTimeLimit);
}
if (values.slurmOptions) out.SEQDESK_CFG_EXEC_SLURM_OPTIONS = values.slurmOptions;
if (values.condaPath) out.SEQDESK_CFG_EXEC_CONDA_PATH = values.condaPath;
if (values.condaEnv) out.SEQDESK_CFG_EXEC_CONDA_ENV = values.condaEnv;
if (values.nextflowProfile) {
  out.SEQDESK_CFG_EXEC_NEXTFLOW_PROFILE = values.nextflowProfile;
}
if (values.weblogUrl) out.SEQDESK_CFG_EXEC_WEBLOG_URL = values.weblogUrl;
if (values.weblogSecret) out.SEQDESK_CFG_EXEC_WEBLOG_SECRET = values.weblogSecret;
if (values.metaxpathPackageUrl) {
  out.SEQDESK_CFG_METAXPATH_PACKAGE_URL = values.metaxpathPackageUrl;
}
if (values.metaxpathKey) out.SEQDESK_CFG_METAXPATH_KEY = values.metaxpathKey;
if (values.metaxpathSha256) out.SEQDESK_CFG_METAXPATH_SHA256 = values.metaxpathSha256;
if (values.adminEmail) out.SEQDESK_CFG_BOOTSTRAP_ADMIN_EMAIL = values.adminEmail;
if (values.adminPassword) out.SEQDESK_CFG_BOOTSTRAP_ADMIN_PASSWORD = values.adminPassword;
if (values.adminPasswordHash) out.SEQDESK_CFG_BOOTSTRAP_ADMIN_PASSWORD_HASH = values.adminPasswordHash;
if (values.adminFirstName) out.SEQDESK_CFG_BOOTSTRAP_ADMIN_FIRST_NAME = values.adminFirstName;
if (values.adminLastName) out.SEQDESK_CFG_BOOTSTRAP_ADMIN_LAST_NAME = values.adminLastName;
if (values.adminFacilityName) out.SEQDESK_CFG_BOOTSTRAP_ADMIN_FACILITY_NAME = values.adminFacilityName;
if (values.researcherEmail) out.SEQDESK_CFG_BOOTSTRAP_RESEARCHER_EMAIL = values.researcherEmail;
if (values.researcherPassword) out.SEQDESK_CFG_BOOTSTRAP_RESEARCHER_PASSWORD = values.researcherPassword;
if (values.researcherPasswordHash) out.SEQDESK_CFG_BOOTSTRAP_RESEARCHER_PASSWORD_HASH = values.researcherPasswordHash;
if (values.researcherFirstName) out.SEQDESK_CFG_BOOTSTRAP_RESEARCHER_FIRST_NAME = values.researcherFirstName;
if (values.researcherLastName) out.SEQDESK_CFG_BOOTSTRAP_RESEARCHER_LAST_NAME = values.researcherLastName;
if (values.researcherInstitution) out.SEQDESK_CFG_BOOTSTRAP_RESEARCHER_INSTITUTION = values.researcherInstitution;
if (values.researcherRole) out.SEQDESK_CFG_BOOTSTRAP_RESEARCHER_ROLE = values.researcherRole;

for (const [key, value] of Object.entries(out)) {
  console.log(`${key}="${escapeShell(value)}"`);
}
NODE
    then
        rm -f "$temp_env"
        if [ -n "$temp_json" ]; then
            rm -f "$temp_json"
        fi
        print_error "Failed to parse config JSON: $config_ref"
        print_troubleshooting_url
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$temp_env"
    rm -f "$temp_env"
    if [ -n "$temp_json" ]; then
        rm -f "$temp_json"
    fi

    apply_config_value SEQDESK_DIR SEQDESK_CFG_DIR
    apply_config_value SEQDESK_DEPLOYMENT_PROFILE SEQDESK_CFG_DEPLOYMENT_PROFILE
    apply_config_value SEQDESK_FEATURE_MODULES_JSON SEQDESK_CFG_FEATURE_MODULES_JSON
    apply_config_value SEQDESK_ACCESS_AUDIENCE SEQDESK_CFG_ACCESS_AUDIENCE
    apply_config_value SEQDESK_BIND_HOST SEQDESK_CFG_BIND_HOST
    apply_config_value SEQDESK_USE_PM2 SEQDESK_CFG_USE_PM2
    apply_config_value SEQDESK_PORT SEQDESK_CFG_PORT
    apply_config_value SEQDESK_PROFILE_MIN_VERSION SEQDESK_CFG_PROFILE_MIN_VERSION
    apply_config_value SEQDESK_DATA_PATH SEQDESK_CFG_DATA_PATH
    apply_config_value SEQDESK_RUN_DIR SEQDESK_CFG_RUN_DIR
    apply_config_value SEQDESK_PIPELINE_DATABASE_DIR SEQDESK_CFG_PIPELINE_DATABASE_DIR
    apply_config_value SEQDESK_NEXTAUTH_URL SEQDESK_CFG_NEXTAUTH_URL
    apply_config_value SEQDESK_NEXTAUTH_SECRET SEQDESK_CFG_NEXTAUTH_SECRET
    apply_config_value SEQDESK_DATABASE_URL SEQDESK_CFG_DATABASE_URL
    apply_config_value SEQDESK_DATABASE_DIRECT_URL SEQDESK_CFG_DATABASE_DIRECT_URL
    apply_config_value SEQDESK_ANTHROPIC_API_KEY SEQDESK_CFG_ANTHROPIC_API_KEY
    apply_config_value SEQDESK_ADMIN_SECRET SEQDESK_CFG_ADMIN_SECRET
    apply_config_value SEQDESK_BLOB_READ_WRITE_TOKEN SEQDESK_CFG_BLOB_READ_WRITE_TOKEN
    apply_config_value SEQDESK_UPDATE_SERVER SEQDESK_CFG_UPDATE_SERVER
    apply_config_value SEQDESK_ORDER_FORM_SETTINGS SEQDESK_CFG_ORDER_FORM_SETTINGS
    apply_config_value SEQDESK_STUDY_FORM_SETTINGS SEQDESK_CFG_STUDY_FORM_SETTINGS
    apply_config_value SEQDESK_TELEMETRY_ENABLED SEQDESK_CFG_TELEMETRY_ENABLED
    apply_config_value SEQDESK_TELEMETRY_ENDPOINT SEQDESK_CFG_TELEMETRY_ENDPOINT
    apply_config_value SEQDESK_TELEMETRY_INTERVAL_HOURS SEQDESK_CFG_TELEMETRY_INTERVAL_HOURS
    apply_config_value SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA SEQDESK_CFG_BOOTSTRAP_INCLUDE_DUMMY_DATA
    apply_config_value SEQDESK_NOTIFICATIONS_ENABLED SEQDESK_CFG_NOTIFICATIONS_ENABLED
    apply_config_value SEQDESK_NOTIFICATION_PROVIDER SEQDESK_CFG_NOTIFICATION_PROVIDER
    apply_config_value SEQDESK_NOTIFICATION_RELAY_URL SEQDESK_CFG_NOTIFICATION_RELAY_URL
    apply_config_value SEQDESK_NOTIFICATION_RELAY_TOKEN SEQDESK_CFG_NOTIFICATION_RELAY_TOKEN
    apply_config_value SEQDESK_WITH_PIPELINES SEQDESK_CFG_WITH_PIPELINES

    apply_config_value SEQDESK_EXEC_USE_SLURM SEQDESK_CFG_EXEC_USE_SLURM
    apply_config_value SEQDESK_EXEC_SLURM_QUEUE SEQDESK_CFG_EXEC_SLURM_QUEUE
    apply_config_value SEQDESK_EXEC_SLURM_CORES SEQDESK_CFG_EXEC_SLURM_CORES
    apply_config_value SEQDESK_EXEC_SLURM_MEMORY SEQDESK_CFG_EXEC_SLURM_MEMORY
    apply_config_value SEQDESK_EXEC_SLURM_TIME_LIMIT SEQDESK_CFG_EXEC_SLURM_TIME_LIMIT
    apply_config_value SEQDESK_EXEC_SLURM_OPTIONS SEQDESK_CFG_EXEC_SLURM_OPTIONS
    apply_config_value SEQDESK_EXEC_CONDA_PATH SEQDESK_CFG_EXEC_CONDA_PATH
    apply_config_value SEQDESK_EXEC_CONDA_ENV SEQDESK_CFG_EXEC_CONDA_ENV
    apply_config_value SEQDESK_EXEC_NEXTFLOW_PROFILE SEQDESK_CFG_EXEC_NEXTFLOW_PROFILE
    apply_config_value SEQDESK_EXEC_WEBLOG_URL SEQDESK_CFG_EXEC_WEBLOG_URL
    apply_config_value SEQDESK_EXEC_WEBLOG_SECRET SEQDESK_CFG_EXEC_WEBLOG_SECRET
    apply_config_value SEQDESK_METAXPATH_PACKAGE_URL SEQDESK_CFG_METAXPATH_PACKAGE_URL
    apply_config_value SEQDESK_METAXPATH_KEY SEQDESK_CFG_METAXPATH_KEY
    apply_config_value SEQDESK_METAXPATH_SHA256 SEQDESK_CFG_METAXPATH_SHA256
    apply_config_value SEQDESK_BOOTSTRAP_ADMIN_EMAIL SEQDESK_CFG_BOOTSTRAP_ADMIN_EMAIL
    apply_config_value SEQDESK_BOOTSTRAP_ADMIN_PASSWORD SEQDESK_CFG_BOOTSTRAP_ADMIN_PASSWORD
    apply_config_value SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH SEQDESK_CFG_BOOTSTRAP_ADMIN_PASSWORD_HASH
    apply_config_value SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME SEQDESK_CFG_BOOTSTRAP_ADMIN_FIRST_NAME
    apply_config_value SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME SEQDESK_CFG_BOOTSTRAP_ADMIN_LAST_NAME
    apply_config_value SEQDESK_BOOTSTRAP_ADMIN_FACILITY_NAME SEQDESK_CFG_BOOTSTRAP_ADMIN_FACILITY_NAME
    apply_config_value SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL SEQDESK_CFG_BOOTSTRAP_RESEARCHER_EMAIL
    apply_config_value SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD SEQDESK_CFG_BOOTSTRAP_RESEARCHER_PASSWORD
    apply_config_value SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH SEQDESK_CFG_BOOTSTRAP_RESEARCHER_PASSWORD_HASH
    apply_config_value SEQDESK_BOOTSTRAP_RESEARCHER_FIRST_NAME SEQDESK_CFG_BOOTSTRAP_RESEARCHER_FIRST_NAME
    apply_config_value SEQDESK_BOOTSTRAP_RESEARCHER_LAST_NAME SEQDESK_CFG_BOOTSTRAP_RESEARCHER_LAST_NAME
    apply_config_value SEQDESK_BOOTSTRAP_RESEARCHER_INSTITUTION SEQDESK_CFG_BOOTSTRAP_RESEARCHER_INSTITUTION
    apply_config_value SEQDESK_BOOTSTRAP_RESEARCHER_ROLE SEQDESK_CFG_BOOTSTRAP_RESEARCHER_ROLE

    unset SEQDESK_CFG_DIR SEQDESK_CFG_USE_PM2 SEQDESK_CFG_DEPLOYMENT_PROFILE
    unset SEQDESK_CFG_FEATURE_MODULES_JSON
    unset SEQDESK_CFG_ACCESS_AUDIENCE SEQDESK_CFG_BIND_HOST
    unset SEQDESK_CFG_PORT SEQDESK_CFG_PROFILE_MIN_VERSION
    unset SEQDESK_CFG_DATA_PATH SEQDESK_CFG_RUN_DIR
    unset SEQDESK_CFG_PIPELINE_DATABASE_DIR
    unset SEQDESK_CFG_NEXTAUTH_URL SEQDESK_CFG_NEXTAUTH_SECRET
    unset SEQDESK_CFG_DATABASE_URL SEQDESK_CFG_DATABASE_DIRECT_URL SEQDESK_CFG_WITH_PIPELINES
    unset SEQDESK_CFG_ANTHROPIC_API_KEY SEQDESK_CFG_ADMIN_SECRET
    unset SEQDESK_CFG_BLOB_READ_WRITE_TOKEN
    unset SEQDESK_CFG_UPDATE_SERVER
    unset SEQDESK_CFG_ORDER_FORM_SETTINGS SEQDESK_CFG_STUDY_FORM_SETTINGS
    unset SEQDESK_CFG_TELEMETRY_ENABLED SEQDESK_CFG_TELEMETRY_ENDPOINT
    unset SEQDESK_CFG_TELEMETRY_INTERVAL_HOURS
    unset SEQDESK_CFG_BOOTSTRAP_INCLUDE_DUMMY_DATA
    unset SEQDESK_CFG_NOTIFICATIONS_ENABLED SEQDESK_CFG_NOTIFICATION_PROVIDER
    unset SEQDESK_CFG_NOTIFICATION_RELAY_URL SEQDESK_CFG_NOTIFICATION_RELAY_TOKEN
    unset SEQDESK_CFG_EXEC_USE_SLURM SEQDESK_CFG_EXEC_SLURM_QUEUE
    unset SEQDESK_CFG_EXEC_SLURM_CORES SEQDESK_CFG_EXEC_SLURM_MEMORY
    unset SEQDESK_CFG_EXEC_SLURM_TIME_LIMIT SEQDESK_CFG_EXEC_SLURM_OPTIONS
    unset SEQDESK_CFG_EXEC_CONDA_PATH SEQDESK_CFG_EXEC_CONDA_ENV
    unset SEQDESK_CFG_EXEC_NEXTFLOW_PROFILE SEQDESK_CFG_EXEC_WEBLOG_URL
    unset SEQDESK_CFG_EXEC_WEBLOG_SECRET
    unset SEQDESK_CFG_METAXPATH_PACKAGE_URL SEQDESK_CFG_METAXPATH_KEY
    unset SEQDESK_CFG_METAXPATH_SHA256
    unset SEQDESK_CFG_BOOTSTRAP_ADMIN_EMAIL SEQDESK_CFG_BOOTSTRAP_ADMIN_PASSWORD
    unset SEQDESK_CFG_BOOTSTRAP_ADMIN_PASSWORD_HASH
    unset SEQDESK_CFG_BOOTSTRAP_ADMIN_FIRST_NAME SEQDESK_CFG_BOOTSTRAP_ADMIN_LAST_NAME
    unset SEQDESK_CFG_BOOTSTRAP_ADMIN_FACILITY_NAME
    unset SEQDESK_CFG_BOOTSTRAP_RESEARCHER_EMAIL SEQDESK_CFG_BOOTSTRAP_RESEARCHER_PASSWORD
    unset SEQDESK_CFG_BOOTSTRAP_RESEARCHER_PASSWORD_HASH
    unset SEQDESK_CFG_BOOTSTRAP_RESEARCHER_FIRST_NAME SEQDESK_CFG_BOOTSTRAP_RESEARCHER_LAST_NAME
    unset SEQDESK_CFG_BOOTSTRAP_RESEARCHER_INSTITUTION SEQDESK_CFG_BOOTSTRAP_RESEARCHER_ROLE
}

load_existing_install_values() {
    local install_dir="$1"

    if [ ! -d "$install_dir" ]; then
        return 0
    fi

    if ! command_exists node; then
        print_warning "Node not found; cannot read defaults from existing installation."
        return 0
    fi

    local temp_env
    temp_env=$(mktemp)
    if ! SEQDESK_EXISTING_INSTALL_DIR="$install_dir" node <<'NODE' >"$temp_env"
const fs = require("fs");
const path = require("path");

const installDir = process.env.SEQDESK_EXISTING_INSTALL_DIR;
if (!installDir) {
  process.exit(0);
}

function escapeShell(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

function trimString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Prefer the canonical settings.json, fall back to the legacy name so an
// existing install's runtime config is still detected after the rename.
const configPath = ["settings.json", "seqdesk.config.json"]
  .map((name) => path.join(installDir, name))
  .find((candidate) => fs.existsSync(candidate));

let config = {};
if (configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      config = parsed;
    }
  } catch {
    // Ignore malformed existing config and keep defaults empty.
  }
}

const runtime = config && typeof config.runtime === "object" ? config.runtime : {};
const nextAuthUrl = trimString(runtime.nextAuthUrl);
const nextAuthSecret = trimString(runtime.nextAuthSecret);
const databaseUrl = trimString(runtime.databaseUrl);
const directUrl = trimString(runtime.directUrl);
const app = config && typeof config.app === "object" ? config.app : {};

let port;
if (typeof app.port === "number" && Number.isFinite(app.port)) {
  const intValue = Math.trunc(app.port);
  if (intValue > 0 && intValue <= 65535) {
    port = String(intValue);
  }
} else if (typeof app.port === "string") {
  const parsed = Number(app.port.trim());
  if (Number.isFinite(parsed)) {
    const intValue = Math.trunc(parsed);
    if (intValue > 0 && intValue <= 65535) {
      port = String(intValue);
    }
  }
}
if (!port && nextAuthUrl) {
  try {
    const parsed = new URL(nextAuthUrl);
    if (parsed.port) {
      port = parsed.port;
    }
  } catch {
    // Ignore invalid URL.
  }
}
const dataPath = trimString(config?.site?.dataBasePath);
const deploymentProfile = trimString(config?.deployment?.profile);
const accessAudience = trimString(app?.accessAudience);
let bindHost;
try {
  bindHost = trimString(fs.readFileSync(path.join(installDir, ".seqdesk-bind-host"), "utf8"));
} catch {
  bindHost = undefined;
}
const runDir = trimString(config?.pipelines?.execution?.runDirectory);
const pipelineDatabaseDir = trimString(config?.pipelines?.databaseDirectory);
const condaPath =
  trimString(config?.pipelines?.execution?.conda?.path) ||
  trimString(config?.pipelines?.execution?.condaPath) ||
  trimString(config?.condaPath);

let withPipelines;
if (typeof config?.pipelines?.enabled === "boolean") {
  withPipelines = config.pipelines.enabled ? "1" : "0";
}

const out = {};
if (deploymentProfile) out.SEQDESK_EXISTING_DEPLOYMENT_PROFILE = deploymentProfile;
if (accessAudience) out.SEQDESK_EXISTING_ACCESS_AUDIENCE = accessAudience;
if (bindHost) out.SEQDESK_EXISTING_BIND_HOST = bindHost;
if (port) out.SEQDESK_EXISTING_PORT = port;
if (nextAuthUrl) out.SEQDESK_EXISTING_NEXTAUTH_URL = nextAuthUrl;
if (nextAuthSecret) out.SEQDESK_EXISTING_NEXTAUTH_SECRET = nextAuthSecret;
if (databaseUrl) out.SEQDESK_EXISTING_DATABASE_URL = databaseUrl;
if (directUrl) out.SEQDESK_EXISTING_DATABASE_DIRECT_URL = directUrl;
if (dataPath) out.SEQDESK_EXISTING_DATA_PATH = dataPath;
if (runDir) out.SEQDESK_EXISTING_RUN_DIR = runDir;
if (pipelineDatabaseDir) out.SEQDESK_EXISTING_PIPELINE_DATABASE_DIR = pipelineDatabaseDir;
if (condaPath) out.SEQDESK_EXISTING_CONDA_PATH = condaPath;
if (withPipelines !== undefined) {
  out.SEQDESK_EXISTING_WITH_PIPELINES = withPipelines;
}

for (const [key, value] of Object.entries(out)) {
  console.log(`${key}="${escapeShell(value)}"`);
}
NODE
    then
        rm -f "$temp_env"
        print_warning "Could not read defaults from existing installation at ${install_dir}."
        return 0
    fi

    # shellcheck disable=SC1090
    source "$temp_env"
    rm -f "$temp_env"

    if [ -n "${SEQDESK_DEPLOYMENT_PROFILE:-}" ] && \
        [ -n "${SEQDESK_EXISTING_DEPLOYMENT_PROFILE:-}" ] && \
        [ "$SEQDESK_DEPLOYMENT_PROFILE" != "$SEQDESK_EXISTING_DEPLOYMENT_PROFILE" ]; then
        print_error "This installation uses deployment profile '$SEQDESK_EXISTING_DEPLOYMENT_PROFILE'; '$SEQDESK_DEPLOYMENT_PROFILE' was requested."
        print_info "Update and reconfigure preserve the profile. A profile change requires a future explicit migration command."
        exit 1
    fi

    apply_config_value SEQDESK_PORT SEQDESK_EXISTING_PORT
    apply_config_value SEQDESK_DEPLOYMENT_PROFILE SEQDESK_EXISTING_DEPLOYMENT_PROFILE
    apply_config_value SEQDESK_ACCESS_AUDIENCE SEQDESK_EXISTING_ACCESS_AUDIENCE
    apply_config_value SEQDESK_BIND_HOST SEQDESK_EXISTING_BIND_HOST
    apply_config_value SEQDESK_NEXTAUTH_URL SEQDESK_EXISTING_NEXTAUTH_URL
    apply_config_value SEQDESK_NEXTAUTH_SECRET SEQDESK_EXISTING_NEXTAUTH_SECRET
    apply_config_value SEQDESK_DATABASE_URL SEQDESK_EXISTING_DATABASE_URL
    apply_config_value SEQDESK_DATABASE_DIRECT_URL SEQDESK_EXISTING_DATABASE_DIRECT_URL
    apply_config_value SEQDESK_DATA_PATH SEQDESK_EXISTING_DATA_PATH
    apply_config_value SEQDESK_RUN_DIR SEQDESK_EXISTING_RUN_DIR
    apply_config_value SEQDESK_PIPELINE_DATABASE_DIR SEQDESK_EXISTING_PIPELINE_DATABASE_DIR
    apply_config_value SEQDESK_EXEC_CONDA_PATH SEQDESK_EXISTING_CONDA_PATH
    apply_config_value SEQDESK_WITH_PIPELINES SEQDESK_EXISTING_WITH_PIPELINES

    if { is_truthy "${SEQDESK_RECONFIGURE:-}" || is_truthy "${SEQDESK_UPDATE_EXISTING:-}"; } && \
        [ -n "$SEQDESK_DEPLOYMENT_PROFILE" ]; then
        print_info "Current deployment profile: $(deployment_profile_label "$SEQDESK_DEPLOYMENT_PROFILE") (preserved; read-only during maintenance)"
    fi

    unset SEQDESK_EXISTING_PORT SEQDESK_EXISTING_ACCESS_AUDIENCE SEQDESK_EXISTING_BIND_HOST
    unset SEQDESK_EXISTING_NEXTAUTH_URL SEQDESK_EXISTING_NEXTAUTH_SECRET
    unset SEQDESK_EXISTING_DEPLOYMENT_PROFILE
    unset SEQDESK_EXISTING_DATABASE_URL SEQDESK_EXISTING_DATABASE_DIRECT_URL SEQDESK_EXISTING_DATA_PATH
    unset SEQDESK_EXISTING_RUN_DIR SEQDESK_EXISTING_PIPELINE_DATABASE_DIR SEQDESK_EXISTING_CONDA_PATH
    unset SEQDESK_EXISTING_WITH_PIPELINES
}

redact_database_url() {
    local value="$1"
    if [ -z "$value" ]; then
        echo ""
        return
    fi

    node - "$value" <<'NODE'
const raw = process.argv[2] || "";
try {
  const url = new URL(raw);
  if (url.password) url.password = "********";
  console.log(url.toString());
} catch {
  console.log(raw.replace(/(postgres(?:ql)?:\/\/[^:\s/@]+):([^@\s]+)@/i, "$1:********@"));
}
NODE
}

resolve_parent_dir() {
    local target="$1"
    local parent
    parent="$(dirname "$target")"
    if [[ "$target" != /* ]]; then
        parent="${PWD}/${parent}"
    fi
    if [ -d "$parent" ]; then
        printf '%s' "$parent"
    else
        printf '%s' "$PWD"
    fi
}

resolve_absolute_dir() {
    local target="$1"
    local parent
    local base
    parent="$(dirname "$target")"
    if base="$(cd "$parent" 2>/dev/null && pwd)"; then
        printf '%s/%s' "$base" "$(basename "$target")"
    else
        printf '%s/%s' "$PWD" "$(basename "$target")"
    fi
}

expand_home_relative_path() {
    local target="${1:-}"
    case "$target" in
        "~")
            printf '%s' "$HOME"
            ;;
        "~/"*)
            printf '%s/%s' "${HOME%/}" "${target:2}"
            ;;
        *)
            printf '%s' "$target"
            ;;
    esac
}

format_kb() {
    local kb="${1:-0}"
    local mb=$((kb / 1024))
    if [ "$mb" -ge 1024 ]; then
        printf '%sG' $((mb / 1024))
    else
        printf '%sM' "$mb"
    fi
}

get_disk_info() {
    local target="$1"
    if ! command_exists df; then
        printf 'unknown'
        return 0
    fi

    # `|| line=""` is not decoration: df exits non-zero on a path that does not
    # exist or cannot be stat'ed, pipefail turns that into a failed assignment,
    # and the ERR trap -- inherited into this command substitution by errtrace --
    # then ends the subshell here, so the caller printed an empty string instead
    # of the "unknown" this function exists to produce. Same guard as
    # gating_disk_kb below.
    local line
    line=$(df -Pk "$target" 2>/dev/null | awk 'NR==2') || line=""
    if [ -z "$line" ]; then
        printf 'unknown'
        return 0
    fi

    local avail_kb
    local mount_point
    avail_kb=$(echo "$line" | awk '{print $4}')
    mount_point=$(echo "$line" | awk '{print $6}')
    if ! [[ "$avail_kb" =~ ^[0-9]+$ ]] || [ -z "$mount_point" ]; then
        printf 'unknown'
        return 0
    fi
    printf '%s free on %s' "$(format_kb "$avail_kb")" "$mount_point"
}

is_writable_target() {
    local target="$1"
    local parent
    parent="$(resolve_parent_dir "$target")"
    if [ -d "$target" ]; then
        [ -w "$target" ]
        return $?
    fi
    [ -w "$parent" ]
}

# Exactly what "back up and replace" covers, and what it does not.
#
# The answer moves $SEQDESK_DIR to $SEQDESK_DIR.backup.<timestamp> and nothing
# else, but it reads as a global reset. An operator who took it to mean "start
# clean" got neither a fresh database nor a backup of the old one: the
# PostgreSQL database is a separate object with a separate lifetime, and the new
# install keeps using it with all of its data and user accounts. Say so before
# the question, not afterwards.
print_install_dir_only_scope() {
    echo "  This covers the install directory only:"
    echo "    Backed up   $SEQDESK_DIR  ->  ${SEQDESK_DIR}.backup.<timestamp>"
    echo "    Untouched   the PostgreSQL database, its data and its user accounts"
    echo "  No database is backed up, dropped or reset, and existing accounts keep"
    echo "  their passwords. To start from an empty database, install against a"
    echo "  different one with --database-url."
}

classify_install_target() {
    if [ ! -e "$SEQDESK_DIR" ]; then
        printf '%s' "new"
    elif [ -f "$SEQDESK_DIR/current/package.json" ] || [ -f "$SEQDESK_DIR/package.json" ]; then
        printf '%s' "existing-seqdesk"
    elif [ -d "$SEQDESK_DIR" ] && \
        { [ -d "$SEQDESK_DIR/releases" ] || [ -e "$SEQDESK_DIR/settings.json" ] || [ -e "$SEQDESK_DIR/start.sh" ]; }; then
        printf '%s' "partial-seqdesk"
    elif [ -d "$SEQDESK_DIR" ] && \
        [ -z "$(find "$SEQDESK_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
        printf '%s' "empty-directory"
    else
        printf '%s' "unrelated-existing"
    fi
}

print_existing_install_diagnosis() {
    print_info "No installation changes were made. Diagnose this target with:"
    printf '  npx -y seqdesk@latest doctor --dir %s\n' "$(shell_quote "$SEQDESK_DIR")"
    print_info "If an interrupted installer reported a backup path, preserve both directories before retrying."
}

resolve_install_operation() {
    local classification
    classification="$(classify_install_target)"

    if is_truthy "$SEQDESK_RECONFIGURE"; then
        if [ "$classification" != "existing-seqdesk" ]; then
            print_error "Reconfigure requires a valid existing SeqDesk installation (found: $classification)."
            print_existing_install_diagnosis
            exit 1
        fi
        return 0
    fi

    case "$classification" in
        new)
            return 0
            ;;
        empty-directory)
            SEQDESK_EMPTY_TARGET="true"
            return 0
            ;;
        existing-seqdesk)
            if is_truthy "$SEQDESK_OVERWRITE_EXISTING"; then
                SEQDESK_UPDATE_EXISTING="1"
                return 0
            fi
            if is_truthy "$SEQDESK_YES"; then
                print_error "A SeqDesk installation already exists at $SEQDESK_DIR."
                print_info "Choose --reconfigure, or pass --overwrite-existing to update it in place."
                exit 1
            fi
            print_header "Existing SeqDesk installation"
            echo "  1) Update — install the selected release, preserve profile/configuration/data, and run migrations"
            echo "  2) Reconfigure — keep the installed release and change supported settings"
            echo "  3) Diagnose — make no changes and print the health-check command"
            echo "  4) Cancel"
            local existing_choice
            existing_choice=$(read_input "  Choose [4]: ")
            existing_choice=${existing_choice:-4}
            case "$existing_choice" in
                1|update)
                    SEQDESK_UPDATE_EXISTING="1"
                    SEQDESK_OVERWRITE_EXISTING="1"
                    ;;
                2|reconfigure)
                    SEQDESK_RECONFIGURE="1"
                    ;;
                3|diagnose)
                    print_existing_install_diagnosis
                    exit 0
                    ;;
                *)
                    echo "Installation cancelled."
                    exit 0
                    ;;
            esac
            ;;
        partial-seqdesk)
            if is_truthy "$SEQDESK_OVERWRITE_EXISTING"; then
                print_warning "A partial SeqDesk target will be backed up before a fresh install."
                return 0
            fi
            print_error "A partial or interrupted SeqDesk installation was detected at $SEQDESK_DIR."
            if is_truthy "$SEQDESK_YES"; then
                print_existing_install_diagnosis
                print_info "After diagnosis, pass --overwrite-existing to back it up and start over."
                exit 1
            fi
            echo "  1) Diagnose — make no changes and print the health-check command"
            echo "  2) Recover — preserve the partial directory as a backup and restart setup"
            echo "  3) Cancel"
            local partial_choice
            partial_choice=$(read_input "  Choose [3]: ")
            partial_choice=${partial_choice:-3}
            case "$partial_choice" in
                1|diagnose)
                    print_existing_install_diagnosis
                    exit 0
                    ;;
                2|recover|resume)
                    SEQDESK_OVERWRITE_EXISTING="1"
                    print_warning "The partial target will be preserved as a timestamped backup before setup restarts."
                    ;;
                *)
                    echo "Installation cancelled."
                    exit 0
                    ;;
            esac
            ;;
        unrelated-existing)
            if is_truthy "$SEQDESK_OVERWRITE_EXISTING"; then
                print_warning "The unrelated target will be backed up before replacement: $SEQDESK_DIR"
                print_install_dir_only_scope
                return 0
            fi
            print_error "The target exists but is not a SeqDesk installation: $SEQDESK_DIR"
            print_info "Choose another --dir, or pass --overwrite-existing to back up and replace this directory."
            exit 1
            ;;
    esac
}

resolve_release_metadata_for_plan() {
    if is_truthy "$SEQDESK_RECONFIGURE"; then
        PLAN_RELEASE_VERSION="$(read_installed_seqdesk_version "$SEQDESK_DIR" 2>/dev/null || true)"
        PLAN_RELEASE_VERSION="${PLAN_RELEASE_VERSION:-unknown}"
        PLAN_RELEASE_CHECKSUM=""
        PLAN_RELEASE_SIZE=""
        return 0
    fi

    local version_url="$SEQDESK_API/version"
    local version_info="${SEQDESK_PREFETCHED_VERSION_INFO:-}"
    local version_fields=""
    local version_fields_end=""
    local download_url=""
    if [ -n "$SEQDESK_VERSION" ]; then
        version_url="$SEQDESK_API/version?version=$SEQDESK_VERSION"
    fi
    if [ -z "$version_info" ]; then
        if ! version_info="$(curl -fsS -L \
            --connect-timeout "$SEQDESK_CURL_CONNECT_TIMEOUT" \
            --max-time "$SEQDESK_CURL_MAX_TIME" \
            --retry "$SEQDESK_CURL_RETRIES" \
            --retry-delay 2 \
            "$version_url")"; then
            print_error "Could not resolve release metadata for the installation plan."
            print_kv "URL" "$version_url"
            print_network_failure_hints
            return 1
        fi
        SEQDESK_PREFETCHED_VERSION_INFO="$version_info"
    fi
    if ! version_fields="$(parse_release_version_info "$version_info")"; then
        print_error "Could not parse release metadata for the installation plan."
        return 1
    fi
    IFS=$'\x1f' read -r PLAN_RELEASE_VERSION download_url PLAN_RELEASE_CHECKSUM \
        PLAN_RELEASE_SIZE version_fields_end <<< "$version_fields"
    if [ "$version_fields_end" != "__SEQDESK_VERSION_INFO_END__" ] || \
        [ -z "$PLAN_RELEASE_VERSION" ] || [ -z "$download_url" ]; then
        print_error "Release metadata is incomplete; a version and download URL are required."
        return 1
    fi
    if is_truthy "$SEQDESK_REQUIRE_CHECKSUM" && [ -z "$PLAN_RELEASE_CHECKSUM" ]; then
        print_error "The selected release has no published checksum and SEQDESK_REQUIRE_CHECKSUM is set."
        return 1
    fi
}

install_plan_entry_source() {
    if [ -n "$SEQDESK_PROFILE" ]; then
        printf '%s' "hosted"
    elif [ -n "$SEQDESK_CONFIG" ]; then
        printf '%s' "config"
    elif interactive_wizard_enabled; then
        printf '%s' "answer"
    else
        printf '%s' "cli"
    fi
}

install_plan_available_bytes() {
    # Measure the filesystem that will back a possibly-not-yet-created path.
    # Empty output means the platform could not provide a reliable value.
    local requested_path="$1"
    local existing_path=""
    local free_kb=""
    [ -n "$requested_path" ] || return 0
    existing_path="$(nearest_existing_directory "$requested_path" 2>/dev/null || true)"
    [ -n "$existing_path" ] || return 0
    free_kb="$(gating_disk_kb "$existing_path")"
    if [[ "$free_kb" =~ ^[0-9]+$ ]]; then
        printf '%s' "$((free_kb * 1024))"
    fi
}

build_install_plan_json() {
    local operation="install"
    local database_mode="local"
    local password_ref="generated-at-apply"
    local entry_source
    local executor="local"
    local admin_name="${SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME:-} ${SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME:-}"
    local target_parent=""
    local target_writable="false"
    local target_available_bytes=""
    local managed_data_available_bytes=""
    local run_available_bytes=""
    local cache_available_bytes=""
    local feature_modules_json="${SEQDESK_FEATURE_MODULES_JSON:-}"
    local required_install_bytes=2147483648
    [ -n "$feature_modules_json" ] || feature_modules_json="{}"
    if ! validate_install_plan_profile_compatibility; then
        return 1
    fi
    is_truthy "$SEQDESK_RECONFIGURE" && operation="reconfigure"
    is_truthy "$SEQDESK_UPDATE_EXISTING" && operation="update"
    uses_local_postgres_target || database_mode="existing"
    if is_truthy "$SEQDESK_RECONFIGURE" || is_truthy "$SEQDESK_UPDATE_EXISTING"; then
        password_ref="not-applicable"
    elif [ -n "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH" ]; then
        password_ref="configured-password-hash"
    elif [ -n "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD" ] && \
        [ "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED" != "true" ]; then
        password_ref="protected-operator-input"
    fi
    is_truthy "${SEQDESK_EXEC_USE_SLURM:-}" && executor="slurm"
    entry_source="$(install_plan_entry_source)"
    PLAN_TARGET_CLASSIFICATION="$(classify_install_target)"
    target_parent="$(resolve_parent_dir "$SEQDESK_DIR")"
    is_writable_target "$SEQDESK_DIR" && target_writable="true"
    target_available_bytes="$(install_plan_available_bytes "$target_parent")"
    managed_data_available_bytes="$(install_plan_available_bytes "$SEQDESK_DATA_PATH")"
    run_available_bytes="$(install_plan_available_bytes "$SEQDESK_RUN_DIR")"
    cache_available_bytes="$(install_plan_available_bytes "$SEQDESK_PIPELINE_DATABASE_DIR")"
    if [[ "$PLAN_RELEASE_SIZE" =~ ^[0-9]+$ ]] && [ "$PLAN_RELEASE_SIZE" -gt 0 ]; then
        local release_reserve_bytes=$((PLAN_RELEASE_SIZE * 3))
        if [ "$release_reserve_bytes" -gt "$required_install_bytes" ]; then
            required_install_bytes="$release_reserve_bytes"
        fi
    fi

    SEQDESK_PLAN_OPERATION="$operation" \
    SEQDESK_DIR="$SEQDESK_DIR" \
    SEQDESK_VERSION="$SEQDESK_VERSION" \
    SEQDESK_DEPLOYMENT_PROFILE="$SEQDESK_DEPLOYMENT_PROFILE" \
    SEQDESK_ACCESS_AUDIENCE="$SEQDESK_ACCESS_AUDIENCE" \
    SEQDESK_NEXTAUTH_URL="$SEQDESK_NEXTAUTH_URL" \
    SEQDESK_BIND_HOST="$SEQDESK_BIND_HOST" \
    SEQDESK_PORT="$SEQDESK_PORT" \
    SEQDESK_DATA_PATH="$SEQDESK_DATA_PATH" \
    SEQDESK_RUN_DIR="$SEQDESK_RUN_DIR" \
    SEQDESK_PIPELINE_DATABASE_DIR="$SEQDESK_PIPELINE_DATABASE_DIR" \
    SEQDESK_TELEMETRY_ENABLED="$SEQDESK_TELEMETRY_ENABLED" \
    SEQDESK_PLAN_EXAMPLE_DATA="$SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA" \
    SEQDESK_PLAN_EXAMPLE_DATA_SOURCE="${SEQDESK_OPTIONAL_EXAMPLE_DATA_SOURCE:-default}" \
    SEQDESK_PLAN_TELEMETRY_SOURCE="${SEQDESK_OPTIONAL_TELEMETRY_SOURCE:-default}" \
    SEQDESK_BOOTSTRAP_ADMIN_EMAIL="$SEQDESK_BOOTSTRAP_ADMIN_EMAIL" \
    SEQDESK_PLAN_RELEASE_VERSION="${PLAN_RELEASE_VERSION:-${SEQDESK_VERSION:-latest}}" \
    SEQDESK_PLAN_RELEASE_SOURCE="${SEQDESK_API%/}/version" \
    SEQDESK_PLAN_RELEASE_CHECKSUM="$PLAN_RELEASE_CHECKSUM" \
    SEQDESK_PLAN_RELEASE_SIZE="$PLAN_RELEASE_SIZE" \
    SEQDESK_PLAN_TARGET_WRITABLE="$target_writable" \
    SEQDESK_PLAN_TARGET_AVAILABLE_BYTES="$target_available_bytes" \
    SEQDESK_PLAN_MANAGED_DATA_AVAILABLE_BYTES="$managed_data_available_bytes" \
    SEQDESK_PLAN_RUN_AVAILABLE_BYTES="$run_available_bytes" \
    SEQDESK_PLAN_CACHE_AVAILABLE_BYTES="$cache_available_bytes" \
    SEQDESK_PLAN_REQUIRED_INSTALL_BYTES="$required_install_bytes" \
    SEQDESK_PLAN_TARGET_CLASSIFICATION="$PLAN_TARGET_CLASSIFICATION" \
    SEQDESK_PLAN_DATABASE_MODE="$database_mode" \
    SEQDESK_PLAN_DATABASE_RUNTIME_REF="$([ -n "$SEQDESK_DATABASE_URL" ] && printf '%s' 'protected-input:database-url' || printf '%s' 'generated-local')" \
    SEQDESK_PLAN_DATABASE_DIRECT_REF="$([ -n "$SEQDESK_DATABASE_DIRECT_URL" ] && printf '%s' 'protected-input:database-direct-url' || printf '%s' '')" \
    SEQDESK_PLAN_PASSWORD_REF="$password_ref" \
    SEQDESK_PLAN_ADMIN_NAME="$admin_name" \
    SEQDESK_PLAN_ENTRY_SOURCE="$entry_source" \
    SEQDESK_PLAN_EXECUTOR="$executor" \
    SEQDESK_PLAN_PIPELINES="$PIPELINES_ENABLED" \
    SEQDESK_PLAN_FEATURE_MODULES="$feature_modules_json" \
    SEQDESK_PLAN_USE_PM2="$SEQDESK_USE_PM2" \
    node <<'NODE'
const truthy = (value) => ["1", "true", "yes", "y", "on"].includes(String(value || "").toLowerCase());
const optional = (value) => value || undefined;
const optionalBytes = (value) => {
  if (value === "" || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
const size = Number(process.env.SEQDESK_PLAN_RELEASE_SIZE || "");
const profile = process.env.SEQDESK_DEPLOYMENT_PROFILE;
const featureModules = JSON.parse(process.env.SEQDESK_PLAN_FEATURE_MODULES || "{}");
const pipelines = truthy(process.env.SEQDESK_PLAN_PIPELINES);
const usePm2 = truthy(process.env.SEQDESK_PLAN_USE_PM2);
const entrySource = process.env.SEQDESK_PLAN_ENTRY_SOURCE || "default";
const accessAudience = process.env.SEQDESK_ACCESS_AUDIENCE;
const enrollmentPolicy =
  profile === "sequencing-center" &&
  (!accessAudience || accessAudience === "local")
    ? "self-registration"
    : "invite-only";
const warnings = [];
if (profile === "shared-lab" || profile === "research-workbench") {
  warnings.push(`${profile} is a preview until its exact packaged first-use journey passes the release gate.`);
}
if (profile === "research-workbench" && !pipelines) {
  warnings.push("Workbench data import is available, but analyses remain operationally incomplete until workflow execution is configured.");
}
if (accessAudience === "team-server") {
  warnings.push("Production readiness still requires an HTTPS reverse proxy, firewall policy, backups, and monitoring.");
}
if (process.env.SEQDESK_PLAN_TARGET_CLASSIFICATION === "unrelated-existing") {
  warnings.push("The target contains unrelated files and cannot be replaced without an explicit backup/overwrite choice.");
}
if (process.env.SEQDESK_PLAN_TARGET_CLASSIFICATION === "partial-seqdesk") {
  warnings.push("A partial SeqDesk installation was detected; diagnose or resume it before a fresh replacement.");
}

const plan = {
  schemaVersion: 1,
  operation: process.env.SEQDESK_PLAN_OPERATION,
  target: {
    directory: process.env.SEQDESK_DIR,
    classification: process.env.SEQDESK_PLAN_TARGET_CLASSIFICATION,
  },
  release: {
    version: process.env.SEQDESK_PLAN_RELEASE_VERSION,
    source: process.env.SEQDESK_PLAN_RELEASE_SOURCE,
    checksum: optional(process.env.SEQDESK_PLAN_RELEASE_CHECKSUM),
    estimatedDownloadBytes: Number.isFinite(size) && size > 0 ? size : undefined,
  },
  preflight: {
    targetWritable: truthy(process.env.SEQDESK_PLAN_TARGET_WRITABLE),
    installationAvailableBytes: optionalBytes(process.env.SEQDESK_PLAN_TARGET_AVAILABLE_BYTES),
    installationRequiredBytes: Number(process.env.SEQDESK_PLAN_REQUIRED_INSTALL_BYTES),
    storageAvailableBytes: {
      managedData: optionalBytes(process.env.SEQDESK_PLAN_MANAGED_DATA_AVAILABLE_BYTES),
      pipelineRuns: optionalBytes(process.env.SEQDESK_PLAN_RUN_AVAILABLE_BYTES),
      pipelineCache: optionalBytes(process.env.SEQDESK_PLAN_CACHE_AVAILABLE_BYTES),
    },
  },
  deployment: { profile, featureModules },
  access: {
    audience: accessAudience,
    browserUrl: process.env.SEQDESK_NEXTAUTH_URL,
    bindHost: process.env.SEQDESK_BIND_HOST,
    port: Number(process.env.SEQDESK_PORT),
    localHealthUrl: `http://127.0.0.1:${process.env.SEQDESK_PORT}`,
  },
  database: {
    mode: process.env.SEQDESK_PLAN_DATABASE_MODE,
    runtimeUrlRef: process.env.SEQDESK_PLAN_DATABASE_RUNTIME_REF,
    directUrlRef: optional(process.env.SEQDESK_PLAN_DATABASE_DIRECT_REF),
  },
  storage: {
    managedDataRoot: optional(process.env.SEQDESK_DATA_PATH),
    runRoot: optional(process.env.SEQDESK_RUN_DIR),
    cacheRoot: optional(process.env.SEQDESK_PIPELINE_DATABASE_DIR),
  },
  execution: {
    prepareNow: pipelines,
    executor: pipelines ? process.env.SEQDESK_PLAN_EXECUTOR : undefined,
    starterPackages: [],
    runSmokeTest: false,
    runtimeDownload: {
      status: pipelines ? "resolved-at-apply" : "not-required",
    },
  },
  service: {
    manager: usePm2 ? "pm2" : "manual",
    startNow: usePm2,
    startOnBootRequested: usePm2,
  },
  enrollment: {
    policy: enrollmentPolicy,
  },
  bootstrap: {
    adminEmail: process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL || "admin@example.com",
    adminName: process.env.SEQDESK_PLAN_ADMIN_NAME.trim(),
    passwordRef: process.env.SEQDESK_PLAN_PASSWORD_REF,
  },
  optional: {
    exampleData: truthy(process.env.SEQDESK_PLAN_EXAMPLE_DATA),
    telemetry: truthy(process.env.SEQDESK_TELEMETRY_ENABLED),
  },
  sources: {
    "deployment.profile": entrySource,
    "deployment.featureModules": Object.keys(featureModules).length > 0 ? entrySource : "default",
    access: entrySource,
    database: entrySource,
    storage: entrySource,
    execution: entrySource,
    service: entrySource,
    enrollment: "default",
    bootstrap: entrySource,
    "optional.exampleData": process.env.SEQDESK_PLAN_EXAMPLE_DATA_SOURCE,
    "optional.telemetry": process.env.SEQDESK_PLAN_TELEMETRY_SOURCE,
    release: process.env.SEQDESK_VERSION ? "cli" : "default",
  },
  lockedPaths: [],
  warnings,
};

process.stdout.write(JSON.stringify(plan, null, 2));
NODE
}

render_install_plan_human() {
    SEQDESK_INSTALL_PLAN_JSON="$1" node <<'NODE'
const plan = JSON.parse(process.env.SEQDESK_INSTALL_PLAN_JSON);
const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value ?? "not configured"}`);
const formatBytes = (bytes) => {
  if (bytes === undefined || bytes === null) return "unknown";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
};
const profileSummary = {
  "sequencing-center": "requesters submit sequencing work; facility staff process and deliver it",
  "shared-lab": "one lab shares sequencing and analysis work; administrators also configure SeqDesk",
  "research-workbench": "researchers import or upload data and run analyses in private workspaces",
};
const sourceLabels = {
  default: "built-in default",
  answer: "guided answer",
  cli: "command line",
  config: "configuration file",
  hosted: "hosted profile",
};
console.log("\nInstallation plan");
line("Operation", plan.operation);
line("Target", `${plan.target.directory} (${plan.target.classification})`);
line("Release", `v${plan.release.version}${plan.release.checksum ? ", checksum published" : ", no checksum published"}`);
line("Release download", plan.release.estimatedDownloadBytes ? formatBytes(plan.release.estimatedDownloadBytes) : "size not published");
line("Install disk reserve", `${formatBytes(plan.preflight.installationRequiredBytes)} required; ${formatBytes(plan.preflight.installationAvailableBytes)} available`);
line("Target writable", plan.preflight.targetWritable ? "yes" : "no");
line("Deployment profile", plan.deployment.profile);
line("Profile behavior", profileSummary[plan.deployment.profile]);
const configuredModules = Object.entries(plan.deployment.featureModules || {});
const enabledModules = configuredModules
  .filter(([, enabled]) => enabled)
  .map(([moduleId]) => moduleId);
const disabledModules = configuredModules
  .filter(([, enabled]) => !enabled)
  .map(([moduleId]) => moduleId);
line(
  "Requested enabled modules",
  enabledModules.length > 0 ? enabledModules.join(", ") : "none selected by installer"
);
if (disabledModules.length > 0) line("Requested disabled modules", disabledModules.join(", "));
if (configuredModules.length > 0) {
  line(
    "Module toggle scope",
    "per-module requests; an existing global feature-module disable remains authoritative"
  );
}
line("Enrollment", plan.enrollment.policy);
line("Access", plan.access.audience);
line("Browser URL", plan.access.browserUrl);
line("Bind host", plan.access.bindHost);
line("Local health URL", plan.access.localHealthUrl);
line("Database", `${plan.database.mode} (${plan.database.runtimeUrlRef})`);
line("Managed data", plan.storage.managedDataRoot ? `${plan.storage.managedDataRoot} (${formatBytes(plan.preflight.storageAvailableBytes.managedData)} free)` : undefined);
line("Pipeline runs", plan.storage.runRoot ? `${plan.storage.runRoot} (${formatBytes(plan.preflight.storageAvailableBytes.pipelineRuns)} free)` : undefined);
line("Pipeline cache", plan.storage.cacheRoot ? `${plan.storage.cacheRoot} (${formatBytes(plan.preflight.storageAvailableBytes.pipelineCache)} free)` : undefined);
line("Workflow execution", plan.execution.prepareNow ? plan.execution.executor : "deferred");
line(
  "Workflow downloads",
  plan.execution.runtimeDownload.status === "not-required"
    ? "none"
    : plan.execution.runtimeDownload.status === "estimated"
      ? formatBytes(plan.execution.runtimeDownload.estimatedBytes)
      : "size resolved by Conda during installation; not published"
);
line("Service", plan.service.manager === "pm2" ? "PM2; start now and request boot startup" : "manual start");
line("Initial administrator", plan.bootstrap.adminEmail);
line("Password", plan.bootstrap.passwordRef);
line("Optional example data", plan.optional.exampleData ? "enabled" : "disabled");
line("Telemetry", plan.optional.telemetry ? "enabled" : "disabled");
console.log("\nValue sources");
for (const source of ["answer", "cli", "config", "hosted", "default"]) {
  const paths = Object.entries(plan.sources)
    .filter(([, value]) => value === source)
    .map(([path]) => path);
  if (paths.length > 0) line(sourceLabels[source], paths.join(", "));
}
line("Locked values", plan.lockedPaths.length > 0 ? plan.lockedPaths.join(", ") : "none");
if (plan.warnings.length > 0) console.log("\nWarnings");
for (const warning of plan.warnings) console.log(`  WARNING: ${warning}`);
NODE
}

emit_install_plan() {
    local plan_json
    if ! plan_json="$(build_install_plan_json)"; then
        return 1
    fi
    if is_truthy "$SEQDESK_PLAN_JSON"; then
        if [ -n "${SEQDESK_PLAN_STDOUT_FD:-}" ]; then
            printf '%s\n' "$plan_json" >&4
        else
            printf '%s\n' "$plan_json"
        fi
    else
        render_install_plan_human "$plan_json"
    fi
}

gating_disk_kb() {
    # Print raw free kilobytes on the filesystem backing $1, or empty if unknown.
    local target="$1"
    if ! command_exists df; then
        return 0
    fi
    local line avail_kb
    line=$(df -Pk "$target" 2>/dev/null | awk 'NR==2') || line=""
    if [ -z "$line" ]; then
        return 0
    fi
    avail_kb=$(echo "$line" | awk '{print $4}')
    if [[ "$avail_kb" =~ ^[0-9]+$ ]]; then
        printf '%s' "$avail_kb"
    fi
}

gating_preflight() {
    # Fail BEFORE anything destructive (download/backup mv/extract) if the
    # target parent is not writable or free disk is below the required floor.
    # $1 = tarball size in bytes (may be empty/0 when unknown).
    local tarball_bytes="${1:-0}"
    if ! [[ "$tarball_bytes" =~ ^[0-9]+$ ]]; then
        tarball_bytes=0
    fi

    local parent_dir
    parent_dir="$(resolve_parent_dir "$SEQDESK_DIR")"

    if ! is_writable_target "$SEQDESK_DIR"; then
        print_error "Cannot install to $SEQDESK_DIR: target is not writable."
        print_info "Parent directory: $parent_dir"
        print_info "Fix permissions, choose a different --dir, or run with sufficient privileges, then re-run."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-target-exists-is-not-writable-or-has-too-little-space"
        exit 1
    fi

    # Required free space floor: max(3x tarball, 2GB). 2GB == 2097152 KB.
    local floor_kb=2097152
    local required_kb=$floor_kb
    if [ "$tarball_bytes" -gt 0 ]; then
        local tarball_kb=$(( tarball_bytes / 1024 ))
        local triple_kb=$(( tarball_kb * 3 ))
        if [ "$triple_kb" -gt "$required_kb" ]; then
            required_kb=$triple_kb
        fi
    fi

    local free_kb
    free_kb="$(gating_disk_kb "$parent_dir")"
    if [ -z "$free_kb" ]; then
        print_warning "Could not determine free disk space on $parent_dir; skipping disk gate."
        return 0
    fi

    if [ "$free_kb" -lt "$required_kb" ]; then
        print_error "Not enough free disk space to install safely."
        print_kv "Location" "$parent_dir"
        print_kv "Available" "$(format_kb "$free_kb")"
        print_kv "Required" "$(format_kb "$required_kb")"
        print_info "Free up space or choose a --dir on a larger filesystem, then re-run."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-target-exists-is-not-writable-or-has-too-little-space"
        exit 1
    fi
}

print_preflight_summary() {
    local target_status="new"
    if [ -d "$SEQDESK_DIR" ]; then
        target_status="exists"
    fi

    local writable="no"
    if is_writable_target "$SEQDESK_DIR"; then
        writable="yes"
    fi

    local parent_dir
    parent_dir="$(resolve_parent_dir "$SEQDESK_DIR")"

    local conda_status
    if [ "$PIPELINES_ENABLED" != "true" ]; then
        conda_status="not needed"
    else
        conda_status="$(conda_preflight_status)"
    fi

    local nextflow_status
    if command_exists nextflow; then
        nextflow_status="found"
    elif [ "$PIPELINES_ENABLED" = "true" ]; then
        nextflow_status="provided by conda env (will be installed)"
    else
        nextflow_status="not needed"
    fi

    local pipelines_status="pending"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        pipelines_status="enabled"
    elif [ "$PIPELINES_ENABLED" = "false" ]; then
        pipelines_status="disabled"
    fi

    print_header "Preflight summary"
    print_kv "Target directory" "$SEQDESK_DIR ($target_status)"
    print_kv "Writable" "$writable"
    print_kv "Disk available" "$(get_disk_info "$parent_dir")"
    print_kv "Node.js" "v$NODE_VERSION"
    print_kv "npm" "$NPM_VERSION"
    if [ -n "${MACOS_POSTGRES_SOCKET_DIR:-}" ]; then
        print_kv "PostgreSQL" "Unix socket ${MACOS_POSTGRES_SOCKET_DIR}:5432 (reused)"
    fi
    print_kv "Conda" "$conda_status"
    print_kv "Nextflow" "$nextflow_status"
    print_kv "Pipelines" "$pipelines_status"
}

print_config_summary() {
    local plan_json
    if ! plan_json="$(build_install_plan_json)"; then
        return 1
    fi
    render_install_plan_human "$plan_json"
}

save_sanitized_install_plan() {
    local plan_json="$1"
    local destination="$2"
    destination="$(expand_home_relative_path "$destination")"

    SEQDESK_INSTALL_PLAN_JSON="$plan_json" \
    SEQDESK_INSTALL_PLAN_DESTINATION="$destination" \
    node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const plan = JSON.parse(process.env.SEQDESK_INSTALL_PLAN_JSON);
const destination = path.resolve(process.env.SEQDESK_INSTALL_PLAN_DESTINATION);
const parent = path.dirname(destination);
if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
  throw new Error(`Parent directory does not exist: ${parent}`);
}

// "wx" prevents an accidental overwrite; 0600 keeps even the redacted
// topology/account identifiers private from other local users.
const file = fs.openSync(destination, "wx", 0o600);
try {
  fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
} finally {
  fs.closeSync(file);
}
process.stdout.write(destination);
NODE
}

reset_guided_plan_answers() {
    # Back means "start the explained choices again", not "edit the JSON in
    # place". Only guided-answer state is cleared; install target, release,
    # logging and other command-level controls stay intact.
    SEQDESK_DEPLOYMENT_PROFILE=""
    SEQDESK_ACCESS_AUDIENCE=""
    SEQDESK_BIND_HOST=""
    SEQDESK_PORT=""
    SEQDESK_NEXTAUTH_URL=""
    SEQDESK_DATABASE_URL=""
    SEQDESK_DATABASE_DIRECT_URL=""
    MACOS_POSTGRES_SOCKET_DIR=""
    SEQDESK_PRIVATE_POSTGRES="false"
    SEQDESK_WITH_PIPELINES=""
    PIPELINES_ENABLED="false"
    SEQDESK_EXEC_USE_SLURM=""
    SEQDESK_DATA_PATH=""
    SEQDESK_RUN_DIR=""
    SEQDESK_PIPELINE_DATABASE_DIR=""
    SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME=""
    SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME=""
    SEQDESK_BOOTSTRAP_ADMIN_EMAIL=""
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD=""
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH=""
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="false"
    SEQDESK_BOOTSTRAP_ADMIN_VERIFIED="false"
    SEQDESK_GENERATED_ADMIN_PASSWORD=""
    SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED="0"
    SEQDESK_USE_PM2=""
    SEQDESK_TELEMETRY_ENABLED=""
    SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA=""
    SEQDESK_OPTIONAL_EXAMPLE_DATA_SOURCE=""
    SEQDESK_OPTIONAL_TELEMETRY_SOURCE=""
}

rebuild_guided_plan_after_back() {
    reset_guided_plan_answers
    run_interactive_wizard_database
    validate_deployment_profile
    normalize_access_topology || return 1

    SEQDESK_PREFLIGHT_READ_ONLY="true"
    if ! preflight_local_postgres; then
        SEQDESK_PREFLIGHT_READ_ONLY="false"
        return 1
    fi
    SEQDESK_PREFLIGHT_READ_ONLY="false"

    run_interactive_wizard_accounts
    ensure_secure_bootstrap_accounts
    resolve_pipeline_enablement
    resolve_service_mode_for_plan
    resolve_optional_content_for_plan

    if [ "$PIPELINES_ENABLED" = "true" ] && {
        [ "$CONDA_RESOLUTION" = "invalid-configured" ] ||
        [ "$CONDA_RESOLUTION" = "invalid-defaults" ];
    }; then
        print_unusable_conda_prefix_error
        return 1
    fi

    print_preflight_summary
    resolve_release_metadata_for_plan
}

confirm_config() {
    if is_truthy "$SEQDESK_YES"; then
        return 0
    fi

    local plan_json="${1:-}"
    if [ -z "$plan_json" ] && ! plan_json="$(build_install_plan_json)"; then
        return 1
    fi

    if interactive_wizard_enabled; then
        local action destination saved_path
        while true; do
            echo ""
            echo "  1) Install this plan"
            echo "  2) Back — restart the guided choices"
            echo "  3) Save a sanitized JSON copy, then return here"
            echo "  4) Cancel without changing the system"
            action=$(read_input "  Choose [1]: ")
            action=${action:-1}
            case "$action" in
                1|install|continue)
                    return 0
                    ;;
                2|back|change)
                    print_header "Change guided choices"
                    if ! rebuild_guided_plan_after_back; then
                        print_warning "The revised choices did not pass preflight; review the messages above and try again."
                        continue
                    fi
                    if ! plan_json="$(build_install_plan_json)"; then
                        print_warning "The revised choices are incompatible; review the messages above and choose again."
                        continue
                    fi
                    render_install_plan_human "$plan_json"
                    ;;
                3|save)
                    destination=$(read_input "  Save as [./seqdesk-install-plan.json]: ")
                    destination=${destination:-./seqdesk-install-plan.json}
                    if saved_path="$(save_sanitized_install_plan "$plan_json" "$destination" 2>/dev/null)"; then
                        print_success "Sanitized plan saved to $saved_path"
                        print_info "The file contains no passwords, tokens, or database connection URLs."
                    else
                        print_warning "Could not save the plan to $destination. The parent must exist and an existing file will not be overwritten."
                    fi
                    ;;
                4|cancel|quit|q)
                    print_info "Installation cancelled before any application, database, or service changes."
                    exit 0
                    ;;
                *)
                    print_error "  Choose 1, 2, 3, or 4."
                    ;;
            esac
        done
    fi

    local reply
    reply=$(read_input "Continue with these settings? (Y/n): ")
    reply=${reply:-Y}
    case "$reply" in
        n|N|no|NO)
            print_info "Installation cancelled before any application, database, or service changes."
            exit 0
            ;;
    esac
}

print_node_install_instructions() {
    print_warning "Automatic system package installation is disabled."
    print_info "Install a supported Node.js release (${NODE_SUPPORT_LABEL}), then re-run this installer."
    case "$OS:$DISTRO" in
        macos:macos)
            echo "  brew install node@24"
            echo '  export PATH="$(brew --prefix node@24)/bin:$PATH"'
            ;;
        linux:debian)
            echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
            echo "  sudo apt-get install -y nodejs"
            ;;
        linux:redhat)
            echo "  curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -"
            if command_exists dnf; then
                echo "  sudo dnf install -y nodejs"
            else
                echo "  sudo yum install -y nodejs"
            fi
            ;;
        *)
            echo "  https://nodejs.org"
            ;;
    esac
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-installer-stops-before-downloading-seqdesk"
}

map_unknown_distro() {
    # Map an unknown Linux distro to debian/redhat via /etc/os-release so
    # existing install hints still fire. Echoes the mapped distro, or
    # "unknown" if it cannot be classified. set -u safe.
    local osr="/etc/os-release"
    if [ ! -r "$osr" ]; then
        echo "unknown"
        return 0
    fi
    # A missing key is the normal case, not an error: Arch, Alpine, Gentoo,
    # NixOS and Void ship no ID_LIKE at all. grep then exits 1, pipefail
    # propagates it, and errtrace runs the ERR trap inside this command
    # substitution -- which ends the subshell, so DISTRO=$(map_unknown_distro)
    # returned non-zero and the install died on exactly the hosts this
    # graceful-degradation path was written for. Absorb the miss instead.
    local id="" id_like=""
    id=$(grep -E '^ID=' "$osr" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"' | tr '[:upper:]' '[:lower:]') || id=""
    id_like=$(grep -E '^ID_LIKE=' "$osr" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"' | tr '[:upper:]' '[:lower:]') || id_like=""
    local token=""
    for token in $id $id_like; do
        case "$token" in
            ubuntu|debian|raspbian)
                echo "debian"
                return 0
                ;;
            rhel|centos|rocky|almalinux|fedora|amzn)
                echo "redhat"
                return 0
                ;;
        esac
    done
    echo "unknown"
    return 0
}

print_required_tool_install_instructions() {
    print_info "Install the missing tools, then re-run this installer."
    case "$OS:$DISTRO" in
        macos:macos)
            echo "  xcode-select --install   # provides curl, tar, shasum"
            echo "  # or via Homebrew:"
            echo "  brew install curl coreutils"
            ;;
        linux:debian)
            echo "  sudo apt-get install -y curl tar coreutils"
            ;;
        linux:redhat)
            if command_exists dnf; then
                echo "  sudo dnf install -y curl tar coreutils"
            else
                echo "  sudo yum install -y curl tar coreutils"
            fi
            ;;
        *)
            echo "  Install: curl, tar, and sha256sum (coreutils) or shasum"
            ;;
    esac
    print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#what-the-installer-checks"
}

is_nfs_prisma_busy_unlink_failure() {
    if [ "$SEQDESK_LOG_ENABLED" != "true" ] || [ ! -f "$SEQDESK_LOG" ]; then
        return 1
    fi

    grep -Eq "EBUSY|resource busy or locked" "$SEQDESK_LOG" &&
        grep -Eiq "unlink .*node_modules[/\\\\]\\.prisma[/\\\\]client[/\\\\]\\.nfs" "$SEQDESK_LOG"
}

install_runtime_node_modules() {
    if [ -x "./node_modules/.bin/next" ] && [ -x "./node_modules/.bin/prisma" ]; then
        print_info "Runtime Node dependencies already available."
        return 0
    fi

    if [ -f package-lock.json ]; then
        if ! run_with_spinner "Runtime Node dependencies" npm ci --omit=dev --no-audit --no-fund; then
            if is_nfs_prisma_busy_unlink_failure; then
                print_warning "npm ci could not remove an NFS-held Prisma client artifact; retrying with npm install."
                run_with_spinner "Runtime Node dependencies retry" npm install --omit=dev --no-audit --no-fund
            else
                return 1
            fi
        fi
    else
        print_warning "package-lock.json not found, falling back to npm install --omit=dev."
        run_with_spinner "Runtime Node dependencies" npm install --omit=dev --no-audit --no-fund
    fi

    if [ ! -x "./node_modules/.bin/next" ]; then
        print_error "next CLI is missing after dependency install (node_modules/.bin/next)."
        print_error "Run 'npm install --omit=dev' manually in $SEQDESK_DIR and retry."
        print_troubleshooting_url
        exit 1
    fi
    if [ ! -x "./node_modules/.bin/prisma" ]; then
        print_error "Prisma CLI is missing after dependency install (node_modules/.bin/prisma)."
        print_error "Run 'npm ci --omit=dev' manually in $SEQDESK_DIR and retry."
        print_troubleshooting_url
        exit 1
    fi
}

# A SeqDesk-managed PostgreSQL is deliberately not registered as a launchd or
# systemd service, so nothing brings it back after a reboot. The app's own start
# wrapper does it instead: pm2 resurrects the app, the app starts its database.
# Emitted only when the installer actually provisioned a private instance.
emit_private_postgres_start_snippet() {
    [ "${SEQDESK_PRIVATE_POSTGRES:-false}" = "true" ] || return 0

    local data_dir log_file pg_ctl_bin
    data_dir="$(private_postgres_data_dir)"
    log_file="$(private_postgres_log_file)"
    pg_ctl_bin="$(find_postgres_binary pg_ctl 2>/dev/null || true)"
    [ -n "$pg_ctl_bin" ] || return 0

    printf '\n# SeqDesk manages this PostgreSQL instance; make sure it is running.\n'
    printf 'SEQDESK_PG_CTL=%q\n' "$pg_ctl_bin"
    printf 'SEQDESK_PG_DATA=%q\n' "$data_dir"
    printf 'SEQDESK_PG_LOG=%q\n' "$log_file"
    cat <<'EOF'
if [ ! -x "$SEQDESK_PG_CTL" ]; then
    SEQDESK_PG_CTL="$(command -v pg_ctl 2>/dev/null || true)"
fi
if [ -n "$SEQDESK_PG_CTL" ] && [ -s "$SEQDESK_PG_DATA/PG_VERSION" ]; then
    # env -u: an exported PGPORT/PGHOST in the operator's (or pm2's) environment
    # would move the socket this instance creates away from the one the
    # DATABASE_URL names. The cluster is addressed by data directory only.
    if ! env -u PGPORT -u PGHOST -u PGDATA LC_ALL=C LANG=C "$SEQDESK_PG_CTL" -D "$SEQDESK_PG_DATA" status >/dev/null 2>&1; then
        if ! env -u PGPORT -u PGHOST -u PGDATA LC_ALL=C LANG=C "$SEQDESK_PG_CTL" -D "$SEQDESK_PG_DATA" \
            -l "$SEQDESK_PG_LOG" -w start >/dev/null 2>&1; then
            echo "[seqdesk] warning: could not start PostgreSQL in $SEQDESK_PG_DATA" >&2
            echo "[seqdesk] see $SEQDESK_PG_LOG" >&2
        fi
    fi
fi
EOF
}

write_root_start_wrapper() {
    mkdir -p "$SEQDESK_DIR"
    local persisted_bind_host
    persisted_bind_host="$(bind_host)"
    printf '%s\n' "$persisted_bind_host" > "$SEQDESK_DIR/.seqdesk-bind-host"
    chmod 600 "$SEQDESK_DIR/.seqdesk-bind-host"
    {
        cat <<'EOF'
#!/usr/bin/env bash
set -e
EOF
        printf 'if [[ -z "${SEQDESK_BIND_HOST:-}" ]]; then export SEQDESK_BIND_HOST=%q; fi\n' "$persisted_bind_host"
        emit_private_postgres_start_snippet
        cat <<'EOF'
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/current"
exec ./start.sh "$@"
EOF
    } > "$SEQDESK_DIR/start.sh"
    chmod +x "$SEQDESK_DIR/start.sh"
}

sync_release_shared_paths() {
    local release_dir="$1"

    mkdir -p "$SEQDESK_DIR/data" "$SEQDESK_DIR/pipelines" "$SEQDESK_DIR/pipeline_runs"

    # Resolve the shared runtime config filename: prefer an existing canonical
    # settings.json, then a legacy seqdesk.config.json (so upgrades keep ONE
    # file), otherwise create the canonical settings.json. The per-release
    # symlink and the writer (which runs in current/ and writes THROUGH this
    # symlink) MUST agree on this name or the live config would split in two.
    local shared_config_name="settings.json"
    for f in settings.json seqdesk.config.json; do
        if [ -e "$SEQDESK_DIR/$f" ]; then shared_config_name="$f"; break; fi
    done

    if [ ! -e "$SEQDESK_DIR/$shared_config_name" ]; then
        for f in settings.json seqdesk.config.json; do
            if [ -f "$release_dir/$f" ]; then
                cp "$release_dir/$f" "$SEQDESK_DIR/$shared_config_name"
                break
            fi
        done
    fi

    if [ -d "$release_dir/data" ]; then
        cp -R "$release_dir/data/." "$SEQDESK_DIR/data/"
    fi

    if [ -d "$release_dir/pipelines" ]; then
        cp -R "$release_dir/pipelines/." "$SEQDESK_DIR/pipelines/"
    fi

    rm -f "$release_dir/settings.json" "$release_dir/seqdesk.config.json"
    ln -s "../../$shared_config_name" "$release_dir/$shared_config_name"

    rm -rf "$release_dir/data" "$release_dir/pipelines" "$release_dir/pipeline_runs"
    ln -s "../../data" "$release_dir/data"
    ln -s "../../pipelines" "$release_dir/pipelines"
    ln -s "../../pipeline_runs" "$release_dir/pipeline_runs"
}

activate_current_release() {
    local version="$1"
    local next_link="$SEQDESK_DIR/.current-next-$$"

    rm -f "$next_link"
    ln -s "releases/$version" "$next_link"
    mv -f "$next_link" "$SEQDESK_DIR/current"
}

link_root_release_metadata() {
    if [ ! -e "$SEQDESK_DIR/current" ]; then
        return 0
    fi

    local item
    for item in package.json package-lock.json; do
        if [ -e "$SEQDESK_DIR/current/${item}" ]; then
            rm -f "$SEQDESK_DIR/${item}"
            ln -s "current/${item}" "$SEQDESK_DIR/${item}"
        fi
    done
}

install_user_cli() {
    local release_launcher="$SEQDESK_DIR/current/scripts/seqdesk-launcher.js"
    local previous_command=""
    previous_command="$(command -v seqdesk 2>/dev/null || true)"
    if [ ! -f "$release_launcher" ]; then
        release_launcher="$SEQDESK_DIR/scripts/seqdesk-launcher.js"
    fi
    if [ ! -f "$release_launcher" ]; then
        print_warning "This release does not contain the user CLI launcher; skipping the local seqdesk command."
        return 0
    fi

    if [ -z "${HOME:-}" ]; then
        print_warning "HOME is not set; cannot create a user-level seqdesk command."
        return 0
    fi

    local config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
    local pointer_file="${SEQDESK_DEFAULT_INSTALL_FILE:-$config_home/seqdesk/default-install}"
    local pointer_dir
    pointer_dir="$(dirname "$pointer_file")"
    if ! mkdir -p "$pointer_dir"; then
        print_warning "Could not create SeqDesk CLI config directory: $pointer_dir"
        return 0
    fi

    local pointer_tmp
    if ! pointer_tmp="$(mktemp "${pointer_file}.tmp.XXXXXX")"; then
        print_warning "Could not create the SeqDesk default-install pointer."
        return 0
    fi
    if ! printf '%s\n' "$SEQDESK_DIR" > "$pointer_tmp" || ! chmod 600 "$pointer_tmp" || ! mv -f "$pointer_tmp" "$pointer_file"; then
        rm -f "$pointer_tmp"
        print_warning "Could not update the SeqDesk default-install pointer: $pointer_file"
        return 0
    fi

    local bin_dir="${SEQDESK_CLI_BIN_DIR:-$HOME/.local/bin}"
    local wrapper_path="$bin_dir/seqdesk"
    if ! mkdir -p "$bin_dir"; then
        print_warning "Could not create the user CLI directory: $bin_dir"
        return 0
    fi

    if { [ -e "$wrapper_path" ] || [ -L "$wrapper_path" ]; } &&
       ! { [ -f "$wrapper_path" ] && grep -q '^# SeqDesk managed user CLI$' "$wrapper_path" 2>/dev/null; }; then
        print_warning "Kept the existing command at $wrapper_path because it is not managed by the SeqDesk installer."
        return 0
    fi

    local wrapper_tmp
    if ! wrapper_tmp="$(mktemp "${wrapper_path}.tmp.XXXXXX")"; then
        print_warning "Could not create the user-level seqdesk command."
        return 0
    fi

    if ! cat > "$wrapper_tmp" <<'SEQDESK_USER_CLI'
#!/usr/bin/env bash
# SeqDesk managed user CLI
set -euo pipefail

expand_user_path() {
    local value="$1"
    case "$value" in
        "~") printf '%s\n' "${HOME:-}" ;;
        "~/"*) printf '%s/%s\n' "${HOME:-}" "${value#\~/}" ;;
        /*) printf '%s\n' "$value" ;;
        *) printf '%s/%s\n' "$PWD" "${value#./}" ;;
    esac
}

launcher_in() {
    local install_dir="$1"
    if [ -f "$install_dir/current/scripts/seqdesk-launcher.js" ]; then
        printf '%s\n' "$install_dir/current/scripts/seqdesk-launcher.js"
        return 0
    fi
    if [ -f "$install_dir/scripts/seqdesk-launcher.js" ]; then
        printf '%s\n' "$install_dir/scripts/seqdesk-launcher.js"
        return 0
    fi
    return 1
}

selected_dir=""
expect_dir="false"
for token in "$@"; do
    if [ "$expect_dir" = "true" ]; then
        selected_dir="$token"
        break
    fi
    case "$token" in
        --dir|-d) expect_dir="true" ;;
        --dir=*) selected_dir="${token#--dir=}"; break ;;
    esac
done

if [ -z "$selected_dir" ] && [ -n "${SEQDESK_DIR:-}" ]; then
    selected_dir="$SEQDESK_DIR"
fi

if [ -z "$selected_dir" ]; then
    config_home="${XDG_CONFIG_HOME:-${HOME:-}/.config}"
    pointer_file="${SEQDESK_DEFAULT_INSTALL_FILE:-$config_home/seqdesk/default-install}"
    if [ -r "$pointer_file" ]; then
        IFS= read -r selected_dir < "$pointer_file" || true
        selected_dir="${selected_dir%$'\r'}"
    fi
fi

launcher=""
if [ -n "$selected_dir" ]; then
    selected_dir="$(expand_user_path "$selected_dir")"
    launcher="$(launcher_in "$selected_dir" 2>/dev/null || true)"
fi

if [ -z "$launcher" ]; then
    probe="$PWD"
    while :; do
        if launcher="$(launcher_in "$probe" 2>/dev/null)"; then
            break
        fi
        parent="$(dirname "$probe")"
        [ "$parent" != "$probe" ] || break
        probe="$parent"
    done
fi

if [ -z "$launcher" ] && [ -n "${HOME:-}" ]; then
    launcher="$(launcher_in "$HOME/seqdesk" 2>/dev/null || true)"
fi

if [ -z "$launcher" ]; then
    echo "[seqdesk] Installed CLI launcher not found. Re-run the SeqDesk installer or pass --dir /path/to/seqdesk." >&2
    exit 1
fi
if ! command -v node >/dev/null 2>&1; then
    echo "[seqdesk] Node.js is required to run the SeqDesk CLI." >&2
    exit 1
fi

exec node "$launcher" "$@"
SEQDESK_USER_CLI
    then
        rm -f "$wrapper_tmp"
        print_warning "Could not write the user-level seqdesk command."
        return 0
    fi

    if ! chmod 755 "$wrapper_tmp" || ! mv -f "$wrapper_tmp" "$wrapper_path"; then
        rm -f "$wrapper_tmp"
        print_warning "Could not activate the user-level seqdesk command at $wrapper_path"
        return 0
    fi

    SEQDESK_USER_CLI_PATH="$wrapper_path"
    SEQDESK_USER_CLI_BIN_DIR="$bin_dir"
    case ":${PATH:-}:" in
        *":$bin_dir:"*) SEQDESK_USER_CLI_NEEDS_PATH="false" ;;
        *) SEQDESK_USER_CLI_NEEDS_PATH="true" ;;
    esac
    print_success "Installed user CLI: $wrapper_path"
    if [ -n "$previous_command" ] && [ "$previous_command" != "$wrapper_path" ]; then
        SEQDESK_USER_CLI_PREVIOUS_PATH="$previous_command"
        print_warning "This shell may still cache the previous seqdesk command at $previous_command."
        echo "  Refresh command lookup before using the new CLI:"
        echo "    Zsh:  rehash"
        echo "    Bash: hash -r"
        printf '  Until then, use the exact path: %s\n' "$(shell_quote "$wrapper_path")"
    fi
}

run_wizard() {
    if ! command_exists node; then
        return 1
    fi
    if [ ! -f scripts/install-wizard.mjs ]; then
        return 1
    fi
    if [ -z "$SEQDESK_YES" ] && { [ ! -t 0 ] || [ ! -t 1 ]; }; then
        return 1
    fi
    local wizard_out
    wizard_out=$(mktemp)
    SEQDESK_WIZARD_OUT="$wizard_out" \
    SEQDESK_WIZARD_PIPELINES_ENABLED="$PIPELINES_ENABLED" \
    SEQDESK_WIZARD_DEPLOYMENT_PROFILE="$SEQDESK_DEPLOYMENT_PROFILE" \
    SEQDESK_WIZARD_DEFAULT_PORT="${SEQDESK_PORT:-8000}" \
    SEQDESK_YES="${SEQDESK_YES:-}" \
    SEQDESK_DATA_PATH="${SEQDESK_DATA_PATH:-}" \
    SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-}" \
    SEQDESK_PORT="${SEQDESK_PORT:-}" \
    SEQDESK_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}" \
    SEQDESK_DATABASE_URL="${SEQDESK_DATABASE_URL:-}" \
    SEQDESK_DATABASE_DIRECT_URL="${SEQDESK_DATABASE_DIRECT_URL:-}" \
    node scripts/install-wizard.mjs
    local status=$?
    if [ $status -ne 0 ]; then
        rm -f "$wizard_out"
        return $status
    fi
    # shellcheck disable=SC1090
    source "$wizard_out"
    rm -f "$wizard_out"
    return 0
}

ensure_seed_dependency() {
    local module_name="$1"

    if ! command_exists node; then
        return 0
    fi

    if node -e "require.resolve('${module_name}')" >/dev/null 2>&1; then
        return 0
    fi

    print_warning "Missing dependency '${module_name}' required for seeding."
    if ! command_exists npm; then
        print_warning "npm not available; skipping install of ${module_name}"
        return 1
    fi

    if run_with_spinner "Dependency ${module_name}" npm install --no-save "${module_name}"; then
        return 0
    fi

    print_warning "Could not install ${module_name}; seed may fail."
    return 1
}

install_private_metaxpath_if_configured() {
    local has_metaxpath_config="false"
    if [ -n "${SEQDESK_METAXPATH_PACKAGE_URL:-}" ] || [ -n "${SEQDESK_METAXPATH_KEY:-}" ] || [ -n "${SEQDESK_METAXPATH_SHA256:-}" ]; then
        has_metaxpath_config="true"
    fi

    if [ "$has_metaxpath_config" != "true" ]; then
        return 0
    fi

    if [ "$PIPELINES_ENABLED" != "true" ]; then
        print_warning "MetaxPath package settings were provided, but pipelines are disabled. Skipping private MetaxPath install."
        return 0
    fi

    if [ -z "${SEQDESK_METAXPATH_PACKAGE_URL:-}" ] || [ -z "${SEQDESK_METAXPATH_KEY:-}" ]; then
        print_error "MetaxPath install requires both metaxpathPackageUrl and metaxpathKey in config (or matching SEQDESK_METAXPATH_* env vars)."
        exit 1
    fi

    if [ ! -x "./scripts/install-private-metaxpath.sh" ]; then
        print_error "Missing scripts/install-private-metaxpath.sh; cannot install private MetaxPath package."
        exit 1
    fi

    local metaxpath_args=(
        --url "${SEQDESK_METAXPATH_PACKAGE_URL}"
        --dir "$(pwd)"
    )
    if [ -n "${SEQDESK_METAXPATH_SHA256:-}" ]; then
        metaxpath_args+=(--sha256 "${SEQDESK_METAXPATH_SHA256}")
    fi

    if ! METAXPATH_PACKAGE_TOKEN="${SEQDESK_METAXPATH_KEY}" \
        run_with_spinner "Private MetaxPath pipeline package" \
        ./scripts/install-private-metaxpath.sh "${metaxpath_args[@]}"; then
        # run_with_spinner routes the install script's output to $SEQDESK_LOG and only
        # prints the log *path*, so the real cause (auth/token, version floor, sha256
        # mismatch, download error) is otherwise invisible — especially in CI where the
        # log file is never surfaced. Echo its tail here so the failure is diagnosable.
        # Token-safe: neither script runs `set -x`, and the token is only ever a curl -H
        # header (curl -fsSL never echoes headers), so it never appears in the log.
        if [ "${SEQDESK_LOG_ENABLED:-}" = "true" ] && [ -n "${SEQDESK_LOG:-}" ] && [ -f "${SEQDESK_LOG}" ]; then
            print_warning "MetaxPath install log (tail) — diagnosing the failure:"
            tail -n 40 "$SEQDESK_LOG" 2>/dev/null | sed 's/^/    metaxpath| /' || true
        fi
        # MetaxPath is an optional private add-on pipeline. By default a failure is
        # fatal (real installs that configured it want to know). When
        # SEQDESK_METAXPATH_OPTIONAL is set (e.g. the CI canary), warn and continue so
        # the rest of the profile — other pipelines, example datasets — still installs.
        if [ "${SEQDESK_METAXPATH_OPTIONAL:-}" = "1" ] || [ "${SEQDESK_METAXPATH_OPTIONAL:-}" = "true" ]; then
            print_warning "Private MetaxPath package install failed; continuing (SEQDESK_METAXPATH_OPTIONAL set). MetaxPath will be unavailable until a compatible package is installed; the rest of the profile (pipelines, example datasets) still applies."
        else
            exit 1
        fi
    fi
}

write_config() {
    local pipelines_enabled="$1"
    local data_path="$2"
    local run_dir="$3"

    if ! command_exists node; then
        print_warning "Node not found; skipping config update"
        return 0
    fi

    SEQDESK_INSTALL_DATA_PATH="$data_path" \
    SEQDESK_INSTALL_DEPLOYMENT_PROFILE="${SEQDESK_DEPLOYMENT_PROFILE:-}" \
    SEQDESK_INSTALL_ONBOARDING_VERSION="${SEQDESK_ONBOARDING_VERSION:-}" \
    SEQDESK_INSTALL_ACCESS_AUDIENCE="${SEQDESK_ACCESS_AUDIENCE:-}" \
    SEQDESK_INSTALL_RUN_DIR="$run_dir" \
    SEQDESK_INSTALL_PIPELINE_DATABASE_DIR="${SEQDESK_PIPELINE_DATABASE_DIR:-}" \
    SEQDESK_INSTALL_PIPELINES_ENABLED="$pipelines_enabled" \
    SEQDESK_INSTALL_EXEC_USE_SLURM="${SEQDESK_EXEC_USE_SLURM:-}" \
    SEQDESK_INSTALL_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}" \
    SEQDESK_INSTALL_NEXTAUTH_SECRET="${SEQDESK_NEXTAUTH_SECRET:-}" \
    SEQDESK_INSTALL_DATABASE_URL="${SEQDESK_DATABASE_URL:-}" \
    SEQDESK_INSTALL_DATABASE_DIRECT_URL="${SEQDESK_DATABASE_DIRECT_URL:-}" \
    SEQDESK_INSTALL_ANTHROPIC_API_KEY="${SEQDESK_ANTHROPIC_API_KEY:-}" \
    SEQDESK_INSTALL_ADMIN_SECRET="${SEQDESK_ADMIN_SECRET:-}" \
    SEQDESK_INSTALL_BLOB_READ_WRITE_TOKEN="${SEQDESK_BLOB_READ_WRITE_TOKEN:-}" \
    SEQDESK_INSTALL_UPDATE_SERVER="${SEQDESK_UPDATE_SERVER:-}" \
    SEQDESK_INSTALL_TELEMETRY_ENABLED="${SEQDESK_TELEMETRY_ENABLED:-}" \
    SEQDESK_INSTALL_TELEMETRY_ENDPOINT="${SEQDESK_TELEMETRY_ENDPOINT:-}" \
    SEQDESK_INSTALL_TELEMETRY_INTERVAL_HOURS="${SEQDESK_TELEMETRY_INTERVAL_HOURS:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_INCLUDE_DUMMY_DATA="${SEQDESK_BOOTSTRAP_INCLUDE_DUMMY_DATA:-}" \
    SEQDESK_INSTALL_NOTIFICATIONS_ENABLED="${SEQDESK_NOTIFICATIONS_ENABLED:-}" \
    SEQDESK_INSTALL_NOTIFICATION_PROVIDER="${SEQDESK_NOTIFICATION_PROVIDER:-}" \
    SEQDESK_INSTALL_NOTIFICATION_RELAY_URL="${SEQDESK_NOTIFICATION_RELAY_URL:-}" \
    SEQDESK_INSTALL_NOTIFICATION_RELAY_TOKEN="${SEQDESK_NOTIFICATION_RELAY_TOKEN:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_ADMIN_EMAIL="${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_ADMIN_PASSWORD="${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_ADMIN_PASSWORD_HASH="${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_ADMIN_FIRST_NAME="${SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_ADMIN_LAST_NAME="${SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_ADMIN_FACILITY_NAME="${SEQDESK_BOOTSTRAP_ADMIN_FACILITY_NAME:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_EMAIL="${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_PASSWORD="${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_PASSWORD_HASH="${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_FIRST_NAME="${SEQDESK_BOOTSTRAP_RESEARCHER_FIRST_NAME:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_LAST_NAME="${SEQDESK_BOOTSTRAP_RESEARCHER_LAST_NAME:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_INSTITUTION="${SEQDESK_BOOTSTRAP_RESEARCHER_INSTITUTION:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_ROLE="${SEQDESK_BOOTSTRAP_RESEARCHER_ROLE:-}" \
    SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_ENABLED="${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" \
    SEQDESK_INSTALL_PROFILE_CONFIG_FILE="${SEQDESK_PROFILE_CONFIG_FILE:-}" \
    SEQDESK_INSTALL_PORT="${SEQDESK_PORT:-}" \
    node <<'NODE'
const fs = require('fs');

const dataPath = process.env.SEQDESK_INSTALL_DATA_PATH || '';
const deploymentProfile = process.env.SEQDESK_INSTALL_DEPLOYMENT_PROFILE || '';
const onboardingVersionRaw = process.env.SEQDESK_INSTALL_ONBOARDING_VERSION || '';
const accessAudience = process.env.SEQDESK_INSTALL_ACCESS_AUDIENCE || '';
const runDir = process.env.SEQDESK_INSTALL_RUN_DIR || '';
const pipelineDatabaseDir = process.env.SEQDESK_INSTALL_PIPELINE_DATABASE_DIR || '';
const pipelinesEnabled = process.env.SEQDESK_INSTALL_PIPELINES_ENABLED || '';
const executionUseSlurmRaw = process.env.SEQDESK_INSTALL_EXEC_USE_SLURM || '';
const nextAuthUrl = process.env.SEQDESK_INSTALL_NEXTAUTH_URL || '';
const nextAuthSecret = process.env.SEQDESK_INSTALL_NEXTAUTH_SECRET || '';
const databaseUrl = process.env.SEQDESK_INSTALL_DATABASE_URL || '';
const directUrl = process.env.SEQDESK_INSTALL_DATABASE_DIRECT_URL || '';
const anthropicApiKey = process.env.SEQDESK_INSTALL_ANTHROPIC_API_KEY || '';
const adminSecret = process.env.SEQDESK_INSTALL_ADMIN_SECRET || '';
const blobReadWriteToken = process.env.SEQDESK_INSTALL_BLOB_READ_WRITE_TOKEN || '';
const updateServer = process.env.SEQDESK_INSTALL_UPDATE_SERVER || '';
const telemetryEnabledRaw = process.env.SEQDESK_INSTALL_TELEMETRY_ENABLED || '';
const telemetryEndpoint = process.env.SEQDESK_INSTALL_TELEMETRY_ENDPOINT || '';
const telemetryIntervalHoursRaw = process.env.SEQDESK_INSTALL_TELEMETRY_INTERVAL_HOURS || '';
const includeDummyDataRaw = process.env.SEQDESK_INSTALL_BOOTSTRAP_INCLUDE_DUMMY_DATA || '';
const notificationsEnabledRaw = process.env.SEQDESK_INSTALL_NOTIFICATIONS_ENABLED || '';
const notificationProvider = process.env.SEQDESK_INSTALL_NOTIFICATION_PROVIDER || '';
const notificationRelayUrl = process.env.SEQDESK_INSTALL_NOTIFICATION_RELAY_URL || '';
const notificationRelayToken = process.env.SEQDESK_INSTALL_NOTIFICATION_RELAY_TOKEN || '';
const profileConfigFile = process.env.SEQDESK_INSTALL_PROFILE_CONFIG_FILE || '';
const appPortRaw = process.env.SEQDESK_INSTALL_PORT || '';
const researcherEnabledRaw = process.env.SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_ENABLED || '';
const bootstrapEnv = {
  admin: {
    email: process.env.SEQDESK_INSTALL_BOOTSTRAP_ADMIN_EMAIL || '',
    password: process.env.SEQDESK_INSTALL_BOOTSTRAP_ADMIN_PASSWORD || '',
    passwordHash: process.env.SEQDESK_INSTALL_BOOTSTRAP_ADMIN_PASSWORD_HASH || '',
    firstName: process.env.SEQDESK_INSTALL_BOOTSTRAP_ADMIN_FIRST_NAME || '',
    lastName: process.env.SEQDESK_INSTALL_BOOTSTRAP_ADMIN_LAST_NAME || '',
    facilityName: process.env.SEQDESK_INSTALL_BOOTSTRAP_ADMIN_FACILITY_NAME || '',
  },
  researcher: {
    email: process.env.SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_EMAIL || '',
    password: process.env.SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_PASSWORD || '',
    passwordHash: process.env.SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_PASSWORD_HASH || '',
    firstName: process.env.SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_FIRST_NAME || '',
    lastName: process.env.SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_LAST_NAME || '',
    institution: process.env.SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_INSTITUTION || '',
    researcherRole: process.env.SEQDESK_INSTALL_BOOTSTRAP_RESEARCHER_ROLE || '',
  },
};

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`ERROR: Failed to parse ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function toOptionalString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalPort(value) {
  const text = toOptionalString(value);
  if (!text) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return undefined;
  const intValue = Math.trunc(parsed);
  if (intValue <= 0 || intValue > 65535) return undefined;
  return intValue;
}

function toOptionalBoolean(value) {
  const text = toOptionalString(value);
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function toOptionalPositiveInt(value) {
  const text = toOptionalString(value);
  if (!text) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return undefined;
  const intValue = Math.trunc(parsed);
  return intValue > 0 ? intValue : undefined;
}

function hasAnyValue(record) {
  return Object.values(record).some((value) => toOptionalString(value) !== undefined);
}

function hashBootstrapPassword(password) {
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error("Bootstrap plaintext password exceeds bcrypt's 72-byte UTF-8 limit");
  }
  const { hashSync } = require('bcryptjs');
  return hashSync(password, 12);
}

function buildBootstrapUserConfig(input) {
  if (!hasAnyValue(input)) return undefined;
  const user = {};
  for (const key of ['email', 'firstName', 'lastName', 'facilityName', 'institution', 'researcherRole']) {
    const value = toOptionalString(input[key]);
    if (value) user[key] = value;
  }
  const configuredHash = toOptionalString(input.passwordHash);
  const rawPassword = toOptionalString(input.password);
  if (configuredHash) {
    user.passwordHash = configuredHash;
  } else if (rawPassword) {
    user.passwordHash = hashBootstrapPassword(rawPassword);
  }
  return Object.keys(user).length > 0 ? user : undefined;
}

function buildInstallProfileConfig(filePath) {
  const profilePath = toOptionalString(filePath);
  if (!profilePath || !fs.existsSync(profilePath)) return undefined;
  const parsed = readJson(profilePath);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const profile = parsed.profile && typeof parsed.profile === 'object' && !Array.isArray(parsed.profile)
    ? parsed.profile
    : {};
  const safeProfile = {};
  const id = toOptionalString(parsed.id);
  const name = toOptionalString(profile.name) || toOptionalString(parsed.name);
  const version = toOptionalString(parsed.version);
  if (id) safeProfile.id = id;
  if (name) safeProfile.name = name;
  if (version) safeProfile.version = version;
  if (Object.keys(safeProfile).length === 0) return undefined;
  safeProfile.appliedAt = new Date().toISOString();
  return safeProfile;
}

// Preferred runtime config filename order. "settings.json" is the canonical
// name; older names stay as fallbacks so existing installs keep a SINGLE file.
// In a dist install current/<name> is a symlink to ../../<name>, so writing the
// resolved (existing) name writes through that symlink to the shared file.
const CONFIG_FILE_NAMES = ['settings.json', 'seqdesk.config.json'];
const configTarget = CONFIG_FILE_NAMES.find((name) => fs.existsSync(name)) || 'settings.json';

const config = readJson(configTarget) || {};

if (deploymentProfile) {
  config.deployment = config.deployment && typeof config.deployment === 'object'
    ? config.deployment
    : {};
  config.deployment.profile = deploymentProfile;
}
const onboardingVersion = toOptionalPositiveInt(onboardingVersionRaw);
if (onboardingVersion !== undefined) {
  config.deployment = config.deployment && typeof config.deployment === 'object'
    ? config.deployment
    : {};
  config.deployment.onboardingVersion = onboardingVersion;
}

const installProfile = buildInstallProfileConfig(profileConfigFile);
if (installProfile) {
  config.installProfile = installProfile;
}

config.site = config.site || {};
if (dataPath) config.site.dataBasePath = dataPath;

config.pipelines = config.pipelines || {};
if (pipelinesEnabled) config.pipelines.enabled = pipelinesEnabled === 'true';
if (pipelineDatabaseDir) config.pipelines.databaseDirectory = pipelineDatabaseDir;

const executionUseSlurm = toOptionalBoolean(executionUseSlurmRaw);
if (runDir || executionUseSlurm !== undefined) {
  config.pipelines.execution = config.pipelines.execution || {};
  if (executionUseSlurm !== undefined) {
    config.pipelines.execution.mode = executionUseSlurm ? 'slurm' : 'local';
  }
  if (runDir) config.pipelines.execution.runDirectory = runDir;
}

const appPort = toOptionalPort(appPortRaw);
if (appPort !== undefined || accessAudience) {
  config.app = config.app && typeof config.app === 'object' ? config.app : {};
  if (appPort !== undefined) config.app.port = appPort;
  if (accessAudience) config.app.accessAudience = accessAudience;
}

const runtime = config.runtime && typeof config.runtime === 'object' ? config.runtime : {};
if (nextAuthUrl) runtime.nextAuthUrl = nextAuthUrl;
if (databaseUrl) runtime.databaseUrl = databaseUrl;
if (directUrl) runtime.directUrl = directUrl;
if (nextAuthSecret) runtime.nextAuthSecret = nextAuthSecret;
if (anthropicApiKey) runtime.anthropicApiKey = anthropicApiKey;
if (adminSecret) runtime.adminSecret = adminSecret;
if (blobReadWriteToken) runtime.blobReadWriteToken = blobReadWriteToken;
if (updateServer) runtime.updateServer = updateServer;
if (Object.keys(runtime).length > 0) {
  config.runtime = runtime;
}

const telemetryEnabled = toOptionalBoolean(telemetryEnabledRaw);
const telemetryIntervalHours = toOptionalPositiveInt(telemetryIntervalHoursRaw);
if (telemetryEnabled !== undefined || telemetryEndpoint || telemetryIntervalHours !== undefined) {
  config.telemetry = config.telemetry && typeof config.telemetry === 'object' ? config.telemetry : {};
  if (telemetryEnabled !== undefined) config.telemetry.enabled = telemetryEnabled;
  if (telemetryEndpoint) config.telemetry.endpoint = telemetryEndpoint;
  if (telemetryIntervalHours !== undefined) config.telemetry.intervalHours = telemetryIntervalHours;
}

const notificationsEnabled = toOptionalBoolean(notificationsEnabledRaw);
if (
  notificationsEnabled !== undefined ||
  notificationProvider ||
  notificationRelayUrl ||
  notificationRelayToken
) {
  config.notifications = config.notifications && typeof config.notifications === 'object' ? config.notifications : {};
  if (notificationsEnabled !== undefined) config.notifications.enabled = notificationsEnabled;
  if (notificationProvider) config.notifications.provider = notificationProvider;
  if (notificationRelayUrl) config.notifications.relayUrl = notificationRelayUrl;
  if (notificationRelayToken) config.notifications.relayToken = notificationRelayToken;
}

const adminBootstrap = buildBootstrapUserConfig(bootstrapEnv.admin);
const researcherBootstrap = buildBootstrapUserConfig(bootstrapEnv.researcher);
const researcherEnabled = toOptionalBoolean(researcherEnabledRaw);
const includeDummyData = toOptionalBoolean(includeDummyDataRaw);
if (adminBootstrap || researcherBootstrap || researcherEnabled === false || includeDummyData !== undefined) {
  config.bootstrap = config.bootstrap && typeof config.bootstrap === 'object' ? config.bootstrap : {};
  if (adminBootstrap || researcherBootstrap || researcherEnabled !== undefined) {
    const users = config.bootstrap.users && typeof config.bootstrap.users === 'object'
      ? config.bootstrap.users
      : {};
    if (adminBootstrap) users.admin = adminBootstrap;
    if (researcherEnabled === false) {
      users.researcher = false;
    } else if (researcherBootstrap) {
      users.researcher = researcherBootstrap;
    } else if (researcherEnabled === true && users.researcher === false) {
      delete users.researcher;
    }
    config.bootstrap.users = users;
  }
  if (includeDummyData !== undefined) {
    config.bootstrap.includeDummyData = includeDummyData;
  }
}

fs.writeFileSync(configTarget, JSON.stringify(config, null, 2));
NODE

    local written_config_name="settings.json"
    for f in settings.json seqdesk.config.json; do
        if [ -e "$f" ]; then written_config_name="$f"; break; fi
    done
    if ! chmod 600 "$written_config_name" 2>/dev/null; then
        print_warning "Could not restrict $written_config_name to owner-only access. Review its permissions before starting SeqDesk."
    fi
    print_kv "$written_config_name" "written"
}

clear_bootstrap_plaintext_passwords() {
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD=""
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD=""
}

has_infrastructure_overrides() {
    [ -n "$SEQDESK_DATA_PATH" ] || \
    [ -n "$SEQDESK_RUN_DIR" ] || \
    [ -n "$SEQDESK_PIPELINE_DATABASE_DIR" ] || \
    [ -n "$SEQDESK_EXEC_USE_SLURM" ] || \
    [ -n "$SEQDESK_EXEC_SLURM_QUEUE" ] || \
    [ -n "$SEQDESK_EXEC_SLURM_CORES" ] || \
    [ -n "$SEQDESK_EXEC_SLURM_MEMORY" ] || \
    [ -n "$SEQDESK_EXEC_SLURM_TIME_LIMIT" ] || \
    [ -n "$SEQDESK_EXEC_SLURM_OPTIONS" ] || \
    [ -n "$SEQDESK_EXEC_CONDA_PATH" ] || \
    [ -n "$SEQDESK_EXEC_CONDA_ENV" ] || \
    [ -n "$SEQDESK_EXEC_NEXTFLOW_PROFILE" ] || \
    [ -n "$SEQDESK_EXEC_WEBLOG_URL" ] || \
    [ -n "$SEQDESK_EXEC_WEBLOG_SECRET" ]
}

apply_infrastructure_settings() {
    if ! has_infrastructure_overrides; then
        return 0
    fi

    if ! command_exists node; then
        print_warning "Node not found; skipping infrastructure settings import"
        return 0
    fi

    SEQDESK_INFRA_DATA_PATH="$SEQDESK_DATA_PATH" \
    SEQDESK_INFRA_RUN_DIR="$SEQDESK_RUN_DIR" \
    SEQDESK_INFRA_PIPELINE_DATABASE_DIR="$SEQDESK_PIPELINE_DATABASE_DIR" \
    SEQDESK_INFRA_USE_SLURM="$SEQDESK_EXEC_USE_SLURM" \
    SEQDESK_INFRA_SLURM_QUEUE="$SEQDESK_EXEC_SLURM_QUEUE" \
    SEQDESK_INFRA_SLURM_CORES="$SEQDESK_EXEC_SLURM_CORES" \
    SEQDESK_INFRA_SLURM_MEMORY="$SEQDESK_EXEC_SLURM_MEMORY" \
    SEQDESK_INFRA_SLURM_TIME_LIMIT="$SEQDESK_EXEC_SLURM_TIME_LIMIT" \
    SEQDESK_INFRA_SLURM_OPTIONS="$SEQDESK_EXEC_SLURM_OPTIONS" \
    SEQDESK_INFRA_CONDA_PATH="$SEQDESK_EXEC_CONDA_PATH" \
    SEQDESK_INFRA_CONDA_ENV="$SEQDESK_EXEC_CONDA_ENV" \
    SEQDESK_INFRA_NEXTFLOW_PROFILE="$SEQDESK_EXEC_NEXTFLOW_PROFILE" \
    SEQDESK_INFRA_WEBLOG_URL="$SEQDESK_EXEC_WEBLOG_URL" \
    SEQDESK_INFRA_WEBLOG_SECRET="$SEQDESK_EXEC_WEBLOG_SECRET" \
    node <<'NODE'
const fs = require("fs");

function parseEnvBool(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function parseEnvInt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const intValue = Math.trunc(parsed);
  return intValue > 0 ? intValue : undefined;
}

function trimOrUndefined(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function loadDatabaseConfigFromConfig() {
  try {
    const configFile = ["settings.json", "seqdesk.config.json"].find((name) => fs.existsSync(name));
    if (!configFile) return {};
    const raw = fs.readFileSync(configFile, "utf8");
    const parsed = JSON.parse(raw);
    const runtime = parsed && typeof parsed === "object" ? parsed.runtime : undefined;
    if (!runtime || typeof runtime !== "object") return {};
    return {
      databaseUrl: trimOrUndefined(runtime.databaseUrl),
      directUrl: trimOrUndefined(runtime.directUrl),
    };
  } catch {
    return {};
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    const loaded = loadDatabaseConfigFromConfig();
    process.env.DATABASE_URL = loaded.databaseUrl;
    process.env.DIRECT_URL = loaded.directUrl || loaded.databaseUrl;
  }

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const defaults = {
      useSlurm: false,
      slurmQueue: "cpu",
      slurmCores: 4,
      slurmMemory: "64GB",
      slurmTimeLimit: 12,
      slurmOptions: "",
      runtimeMode: "conda",
      condaPath: "",
      condaEnv: "seqdesk-pipelines",
      nextflowProfile: "",
      pipelineRunDir: "/data/pipeline_runs",
      pipelineDatabaseDir: "",
      weblogUrl: "",
      weblogSecret: "",
    };

    const currentSettings = await prisma.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true, dataBasePath: true },
    });

    let extra = {};
    if (currentSettings?.extraSettings) {
      try {
        const parsed = JSON.parse(currentSettings.extraSettings);
        if (parsed && typeof parsed === "object") {
          extra = parsed;
        }
      } catch {
        extra = {};
      }
    }

    const nextExecution = {
      ...defaults,
      ...(extra.pipelineExecution || {}),
      runtimeMode: "conda",
    };

    const dataPath = trimOrUndefined(process.env.SEQDESK_INFRA_DATA_PATH);
    const runDir = trimOrUndefined(process.env.SEQDESK_INFRA_RUN_DIR);
    const pipelineDatabaseDir = trimOrUndefined(process.env.SEQDESK_INFRA_PIPELINE_DATABASE_DIR);
    const useSlurm = parseEnvBool(process.env.SEQDESK_INFRA_USE_SLURM);
    const slurmQueue = trimOrUndefined(process.env.SEQDESK_INFRA_SLURM_QUEUE);
    const slurmCores = parseEnvInt(process.env.SEQDESK_INFRA_SLURM_CORES);
    const slurmMemory = trimOrUndefined(process.env.SEQDESK_INFRA_SLURM_MEMORY);
    const slurmTimeLimit = parseEnvInt(process.env.SEQDESK_INFRA_SLURM_TIME_LIMIT);
    const slurmOptions = trimOrUndefined(process.env.SEQDESK_INFRA_SLURM_OPTIONS);
    const condaPath = trimOrUndefined(process.env.SEQDESK_INFRA_CONDA_PATH);
    const condaEnv = trimOrUndefined(process.env.SEQDESK_INFRA_CONDA_ENV);
    const nextflowProfile = trimOrUndefined(process.env.SEQDESK_INFRA_NEXTFLOW_PROFILE);
    const weblogUrl = trimOrUndefined(process.env.SEQDESK_INFRA_WEBLOG_URL);
    const weblogSecret = trimOrUndefined(process.env.SEQDESK_INFRA_WEBLOG_SECRET);

    if (runDir && runDir !== "/") {
      nextExecution.pipelineRunDir = runDir;
    }
    if (pipelineDatabaseDir) {
      nextExecution.pipelineDatabaseDir = pipelineDatabaseDir;
    }
    if (useSlurm !== undefined) {
      nextExecution.useSlurm = useSlurm;
    }
    if (slurmQueue) {
      nextExecution.slurmQueue = slurmQueue;
    }
    if (slurmCores !== undefined) {
      nextExecution.slurmCores = slurmCores;
    }
    if (slurmMemory) {
      nextExecution.slurmMemory = slurmMemory;
    }
    if (slurmTimeLimit !== undefined) {
      nextExecution.slurmTimeLimit = slurmTimeLimit;
    }
    if (slurmOptions !== undefined) {
      nextExecution.slurmOptions = slurmOptions;
    }
    if (condaPath !== undefined) {
      nextExecution.condaPath = condaPath;
    }
    if (condaEnv !== undefined) {
      nextExecution.condaEnv = condaEnv;
    }
    if (nextflowProfile !== undefined) {
      nextExecution.nextflowProfile = nextflowProfile;
    }
    if (weblogUrl !== undefined) {
      nextExecution.weblogUrl = weblogUrl;
    }
    if (weblogSecret !== undefined) {
      nextExecution.weblogSecret = weblogSecret;
    }

    extra.pipelineExecution = nextExecution;

    const updateData = {
      extraSettings: JSON.stringify(extra),
    };
    if (dataPath) {
      updateData.dataBasePath = dataPath;
    }

    await prisma.siteSettings.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: {
        id: "singleton",
        ...updateData,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("ERROR: Failed to apply infrastructure settings:", error?.message || error);
  process.exit(1);
});
NODE
}

install_operation_label() {
    if is_truthy "${SEQDESK_RECONFIGURE:-}"; then
        printf '%s' "reconfigure"
    elif is_truthy "${SEQDESK_UPDATE_EXISTING:-}"; then
        printf '%s' "update"
    else
        printf '%s' "install"
    fi
}

release_install_lock() {
    if [ "$INSTALL_LOCK_HELD" != "true" ] || [ -z "$INSTALL_LOCK_DIR" ]; then
        return 0
    fi
    rm -f "$INSTALL_LOCK_DIR/pid" "$INSTALL_LOCK_DIR/started-at" 2>/dev/null || true
    rmdir "$INSTALL_LOCK_DIR" 2>/dev/null || true
    INSTALL_LOCK_HELD="false"
}

acquire_install_lock() {
    INSTALL_LOCK_DIR="${SEQDESK_DIR}.install.lock"
    local existing_pid=""

    if mkdir "$INSTALL_LOCK_DIR" 2>/dev/null; then
        INSTALL_LOCK_HELD="true"
    elif [ -f "$INSTALL_LOCK_DIR/pid" ]; then
        IFS= read -r existing_pid < "$INSTALL_LOCK_DIR/pid" || true
        if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
            print_error "Another SeqDesk install operation is already running for $SEQDESK_DIR (process $existing_pid)."
            return 1
        fi
        print_warning "Removing a stale installer lock for $SEQDESK_DIR."
        rm -f "$INSTALL_LOCK_DIR/pid" "$INSTALL_LOCK_DIR/started-at" 2>/dev/null || true
        rmdir "$INSTALL_LOCK_DIR" 2>/dev/null || true
        if mkdir "$INSTALL_LOCK_DIR" 2>/dev/null; then
            INSTALL_LOCK_HELD="true"
        fi
    fi

    if [ "$INSTALL_LOCK_HELD" != "true" ]; then
        print_error "Could not acquire the installer lock: $INSTALL_LOCK_DIR"
        print_info "If no installer is running, inspect that directory and preserve it before removing a stale lock."
        return 1
    fi

    printf '%s\n' "$$" > "$INSTALL_LOCK_DIR/pid"
    printf '%s\n' "$INSTALL_STARTED_AT" > "$INSTALL_LOCK_DIR/started-at"
    chmod 600 "$INSTALL_LOCK_DIR/pid" "$INSTALL_LOCK_DIR/started-at" 2>/dev/null || true
}

write_install_checkpoint() {
    local phase="$1"
    local detail="${2:-}"
    INSTALL_PHASE="$phase"
    INSTALL_CHECKPOINT_PATH="${SEQDESK_DIR}.install-state.json"

    SEQDESK_CHECKPOINT_PATH="$INSTALL_CHECKPOINT_PATH" \
    SEQDESK_CHECKPOINT_PHASE="$phase" \
    SEQDESK_CHECKPOINT_DETAIL="$detail" \
    SEQDESK_CHECKPOINT_OPERATION="$(install_operation_label)" \
    SEQDESK_CHECKPOINT_TARGET="$SEQDESK_DIR" \
    SEQDESK_CHECKPOINT_VERSION="${LATEST_VERSION:-${SEQDESK_VERSION:-latest}}" \
    SEQDESK_CHECKPOINT_PROFILE="${SEQDESK_DEPLOYMENT_PROFILE:-}" \
    node <<'NODE'
const fs = require("fs");
const checkpointPath = process.env.SEQDESK_CHECKPOINT_PATH;
const tempPath = `${checkpointPath}.${process.pid}.tmp`;
const checkpoint = {
  schemaVersion: 1,
  operation: process.env.SEQDESK_CHECKPOINT_OPERATION,
  phase: process.env.SEQDESK_CHECKPOINT_PHASE,
  detail: process.env.SEQDESK_CHECKPOINT_DETAIL || undefined,
  targetDirectory: process.env.SEQDESK_CHECKPOINT_TARGET,
  releaseVersion: process.env.SEQDESK_CHECKPOINT_VERSION,
  deploymentProfile: process.env.SEQDESK_CHECKPOINT_PROFILE || undefined,
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(tempPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(tempPath, checkpointPath);
NODE
}

complete_install_checkpoint() {
    if [ -n "$INSTALL_CHECKPOINT_PATH" ]; then
        rm -f "$INSTALL_CHECKPOINT_PATH" 2>/dev/null || true
    fi
    release_install_lock
}

on_error() {
    local exit_code=$?
    # Captured before anything else runs: BASH_COMMAND is overwritten as soon as
    # this handler calls a function, so reading it further down reported a line
    # from inside print_warning instead of the command that actually failed.
    local failed_command="${BASH_COMMAND:-}"
    local failed_at
    local elapsed
    local local_restore_link
    local restore_current_path
    set +e

    # errtrace also propagates this trap into subshells: command substitutions,
    # pipeline elements, and the backgrounded job run_with_progress_status uses
    # for the spinner. Only the top-level shell owns the failure epilogue and the
    # restore -- a subshell must fail quietly, or the epilogue is either captured
    # into a variable as if it were command output or printed twice (once by the
    # spinner's child, once by the real failure that follows it).
    if [ "${BASH_SUBSHELL:-0}" -ne 0 ]; then
        exit "$exit_code"
    fi

    failed_at=$(date +%s)
    elapsed=$((failed_at - INSTALL_START_TS))
    cleanup_miniconda_temp_files
    if [ -n "${SEQDESK_PROFILE_CONFIG_FILE:-}" ] && [ -f "$SEQDESK_PROFILE_CONFIG_FILE" ]; then
        rm -f "$SEQDESK_PROFILE_CONFIG_FILE"
    fi

    # Restore-on-failure: if we moved an existing install aside but the new
    # install never activated a working 'current', put the backup back so the
    # user is not left without a working install.
    if [ -n "${RESTORE_BACKUP_PATH:-}" ] && [ -d "$RESTORE_BACKUP_PATH" ]; then
        if [ ! -e "$SEQDESK_DIR/current" ]; then
            echo ""
            print_warning "Restoring previous install from backup (new install did not activate)."
            if [ ! -e "$SEQDESK_DIR" ] && mv "$RESTORE_BACKUP_PATH" "$SEQDESK_DIR" 2>/dev/null; then
                print_success "Restored previous install: $SEQDESK_DIR"
            else
                print_error "Could not automatically restore the previous install."
                print_warning "Your previous install is preserved at: $RESTORE_BACKUP_PATH"
                print_warning "To restore it manually, remove the failed target and run:"
                print_info "  rm -rf $(shell_quote "$SEQDESK_DIR") && mv $(shell_quote "$RESTORE_BACKUP_PATH") $(shell_quote "$SEQDESK_DIR")"
            fi
        else
            print_warning "Previous install backed up at: $RESTORE_BACKUP_PATH"
        fi
    fi

    # A versioned update switches only the current symlink. If a later apply
    # step fails, restore the previously active release atomically. Database
    # migrations are forward-only, so the failure text below still directs the
    # operator to the log/recovery path rather than claiming a database rollback.
    restore_current_path="${RESTORE_CURRENT_LINK_TARGET:-}"
    if [ -n "$restore_current_path" ] && [[ "$restore_current_path" != /* ]]; then
        restore_current_path="$SEQDESK_DIR/$restore_current_path"
    fi
    if [ -n "${RESTORE_CURRENT_LINK_TARGET:-}" ] && [ -d "$restore_current_path" ]; then
        local_restore_link="$SEQDESK_DIR/.current-restore-$$"
        rm -f "$local_restore_link" 2>/dev/null || true
        if ln -s "$RESTORE_CURRENT_LINK_TARGET" "$local_restore_link" 2>/dev/null && \
            mv -f "$local_restore_link" "$SEQDESK_DIR/current" 2>/dev/null; then
            print_warning "Restored the previously active application release: $RESTORE_CURRENT_LINK_TARGET"
            print_warning "Any database migrations already applied were not rolled back."
        else
            rm -f "$local_restore_link" 2>/dev/null || true
            print_error "Could not restore the previous current release link ($RESTORE_CURRENT_LINK_TARGET)."
        fi
    fi

    if [ -n "${INSTALL_CHECKPOINT_PATH:-}" ] && [ -f "$INSTALL_CHECKPOINT_PATH" ]; then
        print_warning "Recovery checkpoint preserved at: $INSTALL_CHECKPOINT_PATH"
        print_info "It contains no passwords or database connection strings. Re-run the installer with the same --dir after correcting the reported problem."
    fi
    release_install_lock

    echo ""
    print_error "Install failed after $(format_elapsed "$elapsed")."
    print_info "Command: ${failed_command}"
    print_info "Exit code: ${exit_code}"
    if [ "$SEQDESK_LOG_ENABLED" = "true" ]; then
        print_info "Log: $SEQDESK_LOG"
    else
        print_info "Tip: re-run with SEQDESK_LOG=/tmp/seqdesk-install.log"
    fi
    print_info "Common fixes: check network access, Node.js prerequisites, and disk space."
    print_troubleshooting_url
    exit $exit_code
}

cleanup_installer_temp_files() {
    if [ -n "${TEMP_FILE:-}" ] && [ -f "$TEMP_FILE" ]; then
        rm -f "$TEMP_FILE"
    fi
    if [ -n "${SEQDESK_PROFILE_CONFIG_FILE:-}" ] && [ -f "$SEQDESK_PROFILE_CONFIG_FILE" ]; then
        rm -f "$SEQDESK_PROFILE_CONFIG_FILE"
    fi
    release_install_lock
}

print_login_summary() {
    local unchanged_accounts=""
    local unchanged_noun="that account"
    local unchanged_governs="the password it already had still governs"
    # The address named in the reset-password example below: the first account
    # this install left alone, so the command can be copied as printed.
    local unchanged_reset_email=""

    print_header "Login"

    if is_truthy "$SEQDESK_RECONFIGURE" || is_truthy "$SEQDESK_UPDATE_EXISTING"; then
        echo "  Existing user accounts and passwords are unchanged."
    elif [ "${SEQDESK_BOOTSTRAP_ADMIN_EXISTED:-false}" = "true" ] || \
        [ "${SEQDESK_BOOTSTRAP_RESEARCHER_EXISTED:-false}" = "true" ]; then
        # This database already had one or both bootstrap accounts, so the seed
        # left them exactly as they were. Printing a password here — generated,
        # profile-supplied or the documented default — would name a credential
        # that does not open this installation.
        if [ "${SEQDESK_BOOTSTRAP_ADMIN_EXISTED:-false}" = "true" ]; then
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com} / existing password (unchanged)"
        elif [ "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED:-false}" = "true" ] && \
            [ "${SEQDESK_BOOTSTRAP_ADMIN_VERIFIED:-false}" = "true" ]; then
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}"
            print_secret_kv "Admin password" "${SEQDESK_GENERATED_ADMIN_PASSWORD}"
        elif [ "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED:-false}" = "true" ]; then
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com} / creation not verified"
            print_warning "The generated administrator password is not shown because its account was not verified."
        elif [ -n "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ] && \
            [ "${SEQDESK_BOOTSTRAP_ADMIN_VERIFIED:-false}" = "true" ]; then
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL} / configured password"
        elif [ -n "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL} / creation not verified"
            print_warning "Administrator account creation was not verified; use the local reset command after startup."
        else
            print_kv "Admin" "not configured by this install"
        fi
        if [ "${SEQDESK_BOOTSTRAP_RESEARCHER_EXISTED:-false}" = "true" ]; then
            print_kv "Researcher" "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-user@example.com} / existing password (unchanged)"
        elif [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
            print_kv "Additional members" "invite after login"
        elif [ "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED:-false}" = "true" ]; then
            print_kv "Researcher" "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-user@example.com}"
            print_secret_kv "Researcher password" "${SEQDESK_GENERATED_RESEARCHER_PASSWORD}"
        elif [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" ]; then
            print_kv "Researcher" "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL} / configured password"
        else
            print_kv "Additional members" "invite after login"
        fi
        # Name the accounts the sentence is about. With one of the two adopted
        # and the other freshly created, an unqualified "no password was
        # generated, stored or changed for them" contradicted the generated
        # password printed three lines above it.
        if [ "${SEQDESK_BOOTSTRAP_ADMIN_EXISTED:-false}" = "true" ]; then
            unchanged_accounts="${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}"
            unchanged_reset_email="$unchanged_accounts"
        fi
        if [ "${SEQDESK_BOOTSTRAP_RESEARCHER_EXISTED:-false}" = "true" ]; then
            if [ -n "$unchanged_accounts" ]; then
                unchanged_accounts="$unchanged_accounts, ${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-user@example.com}"
                unchanged_noun="those accounts"
                unchanged_governs="the passwords they already had still govern"
            else
                unchanged_accounts="${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-user@example.com}"
                unchanged_reset_email="$unchanged_accounts"
            fi
        fi
        echo "  This install attached to a database that already had SeqDesk accounts."
        echo "  Left unchanged: $unchanged_accounts"
        echo "  No password was generated, stored or changed for $unchanged_noun;"
        echo "  $unchanged_governs."
        echo "  To set a new one for a single account, without editing the database by hand:"
        echo "    npx -y seqdesk@latest reset-password ${unchanged_reset_email:-admin@example.com} --dir $(shell_quote "$SEQDESK_DIR")"
        if { [ "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED:-false}" = "true" ] && \
            [ "${SEQDESK_BOOTSTRAP_ADMIN_VERIFIED:-false}" = "true" ]; } || \
            [ "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED:-false}" = "true" ]; then
            echo "  Save each generated password shown above — it is not stored anywhere else."
        fi
    elif [ -n "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH:-}" ] || [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
        # A password the installer generated is shown exactly once, here, next to the
        # URL it is used on — and via print_secret_kv, so it is not written to the
        # install log. A password the operator chose is never echoed back.
        if [ "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED:-false}" = "true" ] && \
            [ "${SEQDESK_BOOTSTRAP_ADMIN_VERIFIED:-false}" = "true" ]; then
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}"
            print_secret_kv "Admin password" "${SEQDESK_GENERATED_ADMIN_PASSWORD}"
        elif [ "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED:-false}" = "true" ]; then
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com} / creation not verified"
            print_warning "The generated administrator password is not shown because its account was not verified."
            echo "  Start SeqDesk after resolving the database/seed issue, then use the local"
            echo "  reset command below to choose a known password."
        elif [ "${SEQDESK_BOOTSTRAP_ADMIN_VERIFIED:-false}" = "true" ]; then
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com} / configured profile password"
        else
            print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com} / creation not verified"
            print_warning "Administrator account creation was not verified."
            echo "  Start SeqDesk after resolving the database/seed issue, then use the local"
            echo "  reset command below to choose a known password."
        fi
        if [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
            print_kv "Additional members" "invite after login"
        elif [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" ]; then
            if [ "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED:-false}" = "true" ]; then
                print_kv "Researcher" "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL}"
                print_secret_kv "Researcher password" "${SEQDESK_GENERATED_RESEARCHER_PASSWORD}"
            else
                print_kv "Researcher" "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL} / configured profile password"
            fi
        else
            print_kv "Additional members" "invite after login"
        fi
        if { [ "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED:-false}" = "true" ] && \
            [ "${SEQDESK_BOOTSTRAP_ADMIN_VERIFIED:-false}" = "true" ]; } || \
            [ "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED:-false}" = "true" ]; then
            echo "  Save each generated password shown above — it is not stored anywhere else."
        fi
        echo "  To replace the administrator password later from this server:"
        echo "    npx -y seqdesk@latest reset-password ${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com} --dir $(shell_quote "$SEQDESK_DIR")"
    else
        print_warning "No bootstrap administrator credentials were configured."
        echo "  Re-run the guided installer locally to create secure administrator access."
    fi

    # Everything above assumes the database was inspected. When it could not be,
    # an account that was already there keeps its own password, and the seed does
    # not touch it. Said here because this block is what the reader actually acts
    # on; the warning at probe time has long scrolled away by now.
    if [ "$SEQDESK_DB_PROBE_FAILED" = "true" ] && [ "$SEQDESK_DB_ADOPTED" != "true" ]; then
        echo "  Unverified: this install could not check whether the database already had"
        echo "  SeqDesk accounts. If it did, they were left unchanged. Use the credentials"
        echo "  that database was set up with, or the local reset command above."
    fi

    # Prevent a second call in the same shell from disclosing a generated
    # credential again. Normal installs exit shortly after this summary, but
    # the single-use property should not depend on that control flow.
    SEQDESK_GENERATED_ADMIN_PASSWORD=""
    SEQDESK_GENERATED_RESEARCHER_PASSWORD=""
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="false"
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="false"
}

print_success_footer() {
    # The last thing on screen is the one thing the reader has to do next. Everything
    # above is reference; this is the instruction. Under PM2 the app is already
    # running, so it is a link to open — otherwise it is the command to start it.
    echo ""
    if [ "$PM2_CONFIGURED" != "true" ]; then
        printf '%b  INSTALLED — MANUAL START REQUIRED  SeqDesk v%s%b\n' "$YELLOW$BOLD" "$INSTALLED_VERSION" "$NC"
    else
        case "${SEQDESK_VERIFICATION_STATUS:-not-run}" in
            passed)
                printf '%b  INSTALLED — BASE SERVICE CHECK PASSED  SeqDesk v%s%b\n' "$GREEN$BOLD" "$INSTALLED_VERSION" "$NC"
                ;;
            failed)
                printf '%b  INSTALLED — BASE SERVICE CHECK NEEDS ATTENTION  SeqDesk v%s%b\n' "$YELLOW$BOLD" "$INSTALLED_VERSION" "$NC"
                ;;
            unavailable)
                printf '%b  INSTALLED — BASE SERVICE CHECK UNAVAILABLE  SeqDesk v%s%b\n' "$YELLOW$BOLD" "$INSTALLED_VERSION" "$NC"
                ;;
            *)
                printf '%b  INSTALLED — BASE SERVICE CHECK NOT RUN  SeqDesk v%s%b\n' "$YELLOW$BOLD" "$INSTALLED_VERSION" "$NC"
                ;;
        esac
    fi
    case "${SEQDESK_VERIFICATION_STATUS:-not-run}" in
        passed) print_kv "Base service check" "passed" ;;
        failed) print_kv "Base service check" "needs attention; review doctor output above" ;;
        unavailable) print_kv "Base service check" "unavailable; run doctor after repairing the local CLI" ;;
        skipped) print_kv "Base service check" "skipped by explicit operator choice" ;;
        *)
            if [ "$PM2_CONFIGURED" = "true" ]; then
                print_kv "Base service check" "not run"
            else
                print_kv "Base service check" "not run; start the application first"
            fi
            ;;
    esac
    echo ""
    if [ "$PM2_CONFIGURED" = "true" ]; then
        echo "  Open SeqDesk:"
        printf '  %b%s%b\n' "$CYAN$BOLD" "$(browser_app_url)" "$NC"
    else
        echo "  Start SeqDesk:"
        printf '  %b%s/start.sh%b\n' "$CYAN$BOLD" "$SEQDESK_DIR" "$NC"
        echo ""
        echo "  then open:"
        printf '  %b%s%b\n' "$CYAN$BOLD" "$(browser_app_url)" "$NC"
    fi
    if is_truthy "$SEQDESK_UPDATE_EXISTING" || is_truthy "$SEQDESK_RECONFIGURE"; then
        echo "  Profile readiness: review the administrator checklist after login; maintenance may add new checks."
    elif [ "$SEQDESK_DEPLOYMENT_PROFILE" = "research-workbench" ] && \
        [ "$PIPELINES_ENABLED" != "true" ]; then
        echo "  Profile readiness: pending — configure workflow execution and complete the administrator checklist."
    else
        echo "  Profile readiness: pending — sign in as the administrator and complete the first-login checklist."
    fi
    echo "  The base service check does not replace profile storage, runtime, or first-use verification."
    echo ""
}

print_next_steps() {
    local pipeline_cli=""
    local storage_example="$(dirname "$SEQDESK_DIR")/$(basename "$SEQDESK_DIR")-data"

    print_header "What's next"

    if [ "$PM2_CONFIGURED" = "true" ]; then
        echo "  1. Open $(browser_app_url) and log in with the admin account shown above."
    else
        echo "  1. Start $SEQDESK_DIR/start.sh, then open $(browser_app_url) and log in as admin."
    fi

    if [ "$SEQDESK_DEPLOYMENT_PROFILE" = "research-workbench" ]; then
        if [ "$PIPELINES_ENABLED" = "true" ]; then
            echo "  2. In Admin settings, verify managed data storage and the selected pipeline runtime."
        else
            echo "  2. In Admin settings, verify managed data storage and configure a pipeline runtime."
        fi
        echo "  3. Invite Workbench members, then open Workbench Data to upload files or configure an importer."
        echo "  4. Install at least one pipeline and complete a small test run before production use."
        echo "     Guide: https://seqdesk.org/docs"
        echo "  5. Before production, configure HTTPS, backups, monitoring, and retention."
        echo ""
        echo "  Use the Browser URL for login. Use the Local health URL for curl/doctor checks."
        echo ""
        return 0
    fi

    if [ "$SEQDESK_DEPLOYMENT_PROFILE" = "shared-lab" ]; then
        if [ "$PIPELINES_ENABLED" = "true" ]; then
            echo "  2. Verify shared sequencing storage and the selected pipeline runtime in Admin settings."
        else
            echo "  2. Verify shared sequencing storage; pipeline runtime setup was deferred."
        fi
        echo "  3. Configure lab-member access; keep system configuration limited to administrators."
        echo "  4. Complete one shared project from samples through a pipeline result."
        echo "     Guide: https://seqdesk.org/docs"
        echo "  5. Before production, configure HTTPS, backups, monitoring, and retention."
        echo ""
        echo "  Use the Browser URL for login. Use the Local health URL for curl/doctor checks."
        echo ""
        return 0
    fi

    if [ "$SEQDESK_ACCESS_AUDIENCE" = "team-server" ]; then
        echo "  Team access starts invite-only. Invite researchers after the administrator signs in."
    else
        echo "  Local evaluation allows researcher self-registration; administrator invitations also work."
    fi

    if [ -n "${SEQDESK_USER_CLI_PATH:-}" ] && [ -x "$SEQDESK_USER_CLI_PATH" ]; then
        pipeline_cli="$SEQDESK_USER_CLI_PATH"
        if [ -n "${SEQDESK_DATA_PATH:-}" ]; then
            echo "  2. Data Storage is configured. Verify it from the server shell:"
            printf '       %s storage status\n' "$(shell_quote "$pipeline_cli")"
        else
            echo "  2. Configure Data Storage from the server shell:"
            printf '       %s storage configure %s\n' \
                "$(shell_quote "$pipeline_cli")" \
                "$(shell_quote "$storage_example")"
            printf '       %s storage status\n' "$(shell_quote "$pipeline_cli")"
            echo "     Use your existing sequencing directory instead, if applicable."
            echo "     Alternative: Admin > Data Storage."
        fi
        echo "     Guide: https://seqdesk.org/docs/administration/data-storage"
        echo "  3. Optional for evaluation/testing: after Data Storage is configured and writable,"
        echo "     load the deterministic example dataset:"
        printf '       %s demo-data install\n' "$(shell_quote "$pipeline_cli")"
        echo "     Creates example orders, studies, samples, metadata, and synthetic FASTQ files."
        echo "     Alternative: Admin > Settings > Demo data."
        echo "     Guide: https://seqdesk.org/docs/getting-started/example-data"
        echo "  4. Optional: discover supported order- and study-level pipelines:"
        printf '       %s pipelines list\n' "$(shell_quote "$pipeline_cli")"
        echo "     Safe first install (also provisions a missing runtime):"
        printf '       %s pipelines install simulate-reads --runtime\n' \
            "$(shell_quote "$pipeline_cli")"
        echo "     SeqDesk enables a pipeline only after its readiness checks pass."
    else
        echo "  2. Configure Data Storage under Admin > Data Storage."
        echo "     Guide: https://seqdesk.org/docs/administration/data-storage"
        echo "  3. Optional for evaluation/testing: after Data Storage is configured and writable,"
        echo "     load the example dataset under"
        echo "     Admin > Settings > Demo data. It includes synthetic FASTQ files."
        echo "     Guide: https://seqdesk.org/docs/getting-started/example-data"
        echo "  4. Optional pipelines: the local SeqDesk CLI is not available."
        echo "     Review the CLI warning above and update or reinstall SeqDesk first."
    fi
    echo "     Guide: https://seqdesk.org/docs/pipelines/installing-pipelines"
    echo "  5. Before production, follow https://seqdesk.org/docs"
    echo ""
    echo "  Use the Browser URL for login. Use the Local health URL for curl/doctor checks."
    echo ""
}

# Test hook: when sourced with SEQDESK_INSTALL_LIB_ONLY=1, load the function
# and variable definitions above but do NOT run the installer. Lets the wizard
# and other helpers be unit-tested in isolation (scripts/ci/test-interactive-wizard.sh).
if [ -n "${SEQDESK_INSTALL_LIB_ONLY:-}" ]; then
    return 0 2>/dev/null || exit 0
fi

parse_args "$@"

# Running the installer directly in a terminal is the beginner entry point.
# Treat it as guided unless the operator selected automation/configuration or a
# maintenance operation explicitly.
if ! is_truthy "$SEQDESK_PLAN_ONLY" && ! is_truthy "$SEQDESK_YES" && \
    ! is_truthy "$SEQDESK_INTERACTIVE" && [ -z "$SEQDESK_CONFIG" ] && \
    [ -z "$SEQDESK_PROFILE" ] && ! is_truthy "$SEQDESK_RECONFIGURE" && \
    ! is_truthy "$SEQDESK_PREPARE_POSTGRES" && [ -t 0 ] && [ -t 1 ]; then
    SEQDESK_INTERACTIVE="1"
fi

if is_truthy "$SEQDESK_PLAN_JSON" && ! is_truthy "$SEQDESK_PLAN_ONLY"; then
    print_error "--json is supported with --plan only."
    exit 1
fi

# Keep JSON stdout machine-clean while normal diagnostics remain visible on
# stderr. Plan mode intentionally does not create an install log.
if is_truthy "$SEQDESK_PLAN_ONLY" && is_truthy "$SEQDESK_PLAN_JSON"; then
    exec 4>&1
    SEQDESK_PLAN_STDOUT_FD="4"
    exec 1>&2
fi

trap on_error ERR
trap cleanup_installer_temp_files EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if is_truthy "$SEQDESK_PLAN_ONLY"; then
    exec 3>&1 || true
else
    configure_install_log
fi

if [ -z "$SEQDESK_YES" ] && [ ! -t 0 ] && [ ! -t 1 ] && \
    { ! is_truthy "$SEQDESK_PLAN_ONLY" || is_truthy "$SEQDESK_INTERACTIVE"; }; then
    print_error "No interactive TTY detected. Use -y (or SEQDESK_YES=1) for automated installs."
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-direct-shell-fallback-needs-explicit-input"
    exit 1
fi

# Banner
echo ""
printf '%bSeqDesk install%b\n' "$BOLD" "$NC"
print_kv "Version" "${SEQDESK_VERSION:-latest}"
if [ -n "$SEQDESK_PROFILE" ]; then
    print_kv "Profile" "$SEQDESK_PROFILE"
fi
if has_additional_settings; then
    print_kv "Local overrides" "configured"
fi
if is_truthy "$SEQDESK_RECONFIGURE"; then
    print_kv "Mode" "reconfigure"
fi
if is_truthy "$SEQDESK_PREPARE_POSTGRES"; then
    print_kv "Mode" "prepare-postgres"
fi
print_kv "Started" "$INSTALL_STARTED_AT"
print_kv "Log" "$SEQDESK_LOG"

# Orientation for first-time interactive installs. Deliberately two lines: the
# earlier version listed prerequisites before checking any of them, so it was
# read as a wall of text at exactly the moment the reader had nothing to decide.
# Every requirement here is verified a few lines below, and a missing one is
# explained then — when it is actionable.
if ! is_truthy "$SEQDESK_YES" && ! is_truthy "$SEQDESK_RECONFIGURE" && ! is_truthy "$SEQDESK_PREPARE_POSTGRES"; then
    echo ""
    echo "  Installing to ${SEQDESK_DIR:-./seqdesk}. Nothing is changed until the summary is confirmed."
    echo "  Needs Node.js ${NODE_SUPPORT_LABEL:-22.13.0+ or 24.x} and a PostgreSQL database; SeqDesk installs its own if you have none."
    echo "  Prerequisites: https://seqdesk.org/docs/installation/prerequisites"
fi

# System detection
print_step "Detect system"

OS="unknown"
ARCH=$(uname -m)
DISTRO="unknown"
ENV_UNTESTED_REASONS=""

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    if [ -f /etc/debian_version ]; then
        DISTRO="debian"
    elif [ -f /etc/redhat-release ]; then
        DISTRO="redhat"
    fi
    if [ "$DISTRO" = "unknown" ]; then
        DISTRO=$(map_unknown_distro)
        if [ "$DISTRO" = "unknown" ]; then
            print_warning "Untested Linux distribution detected. SeqDesk is tested on Debian/Ubuntu and RHEL/Fedora; proceeding at your own risk."
            ENV_UNTESTED_REASONS="${ENV_UNTESTED_REASONS:+$ENV_UNTESTED_REASONS, }unrecognized Linux distribution"
        fi
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    DISTRO="macos"
else
    print_error "Unsupported operating system: $OSTYPE"
    print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#required"
    exit 1
fi

case "$ARCH" in
    x86_64|amd64|aarch64|arm64)
        ;;
    *)
        print_warning "Untested CPU architecture: $ARCH. Release artifacts and native modules are validated on x86_64 and arm64 only; proceeding at your own risk."
        ENV_UNTESTED_REASONS="${ENV_UNTESTED_REASONS:+$ENV_UNTESTED_REASONS, }untested architecture ($ARCH)"
        ;;
esac

print_success "OS: $OS ($DISTRO)"
print_success "Architecture: $ARCH"

if [ -n "$ENV_UNTESTED_REASONS" ]; then
    print_kv "Environment" "UNTESTED (reasons: $ENV_UNTESTED_REASONS) — proceeding at your own risk"
fi

# Dependencies
print_step "Check dependencies"

node_install_reason=""
if ! command_exists node; then
    node_install_reason="missing"
else
    NODE_VERSION=$(node -v | sed 's/v//')
    if ! node_meets_minimum_version; then
        node_install_reason="outdated"
    fi
fi

if is_truthy "$SEQDESK_SKIP_DEPS"; then
    print_warning "--skip-deps is deprecated for the distribution installer and is ignored."
fi

if [ -n "$node_install_reason" ]; then
    if [ "$node_install_reason" = "missing" ]; then
        print_error "A supported Node.js release ($NODE_SUPPORT_LABEL) is required but was not found."
    else
        print_error "Node.js $NODE_SUPPORT_LABEL is required (found v$NODE_VERSION)."
    fi
    print_node_install_instructions
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
if ! node_meets_minimum_version; then
    print_error "Node.js $NODE_SUPPORT_LABEL is required (found v$NODE_VERSION)"
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-installer-stops-before-downloading-seqdesk"
    exit 1
fi
print_success "Node.js $NODE_VERSION"

if ! command_exists npm; then
    print_error "npm is required but not installed."
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-installer-stops-before-downloading-seqdesk"
    exit 1
fi
NPM_VERSION=$(npm -v)
print_success "npm $NPM_VERSION"

# Required tools for downloading, extracting, and verifying the release tarball.
# Missing curl previously surfaced as a misleading "Could not connect to
# SeqDesk server"; check upfront and fail with an honest, actionable message.
missing_tools=()
if ! command_exists curl; then
    missing_tools+=("curl (download release tarball)")
fi
if ! command_exists tar; then
    missing_tools+=("tar (extract release tarball)")
fi
if ! command_exists sha256sum && ! command_exists shasum; then
    missing_tools+=("sha256sum or shasum (verify release checksum)")
fi

if [ "${#missing_tools[@]}" -gt 0 ]; then
    print_error "Required tools are missing:"
    for tool in "${missing_tools[@]}"; do
        print_error "  - $tool"
    done
    print_required_tool_install_instructions
    exit 1
fi

print_success "curl, tar, and checksum tools available"

resolve_install_profile

if has_additional_settings && [ -z "$SEQDESK_CONFIG" ]; then
    print_error "Additional installer settings require --profile or --config."
    print_troubleshooting_url
    exit 1
fi

if [ -n "$SEQDESK_CONFIG" ]; then
    if [ -n "$SEQDESK_PROFILE_CONFIG_FILE" ]; then
        print_info "Loading installer config from hosted profile"
    else
        print_info "Loading installer config: $SEQDESK_CONFIG"
    fi
    load_install_config "$SEQDESK_CONFIG"
    print_success "Loaded installer config"
fi

if [ -z "$SEQDESK_DIR" ]; then
    SEQDESK_DIR="./seqdesk"
fi
SEQDESK_DIR="${SEQDESK_DIR/#\~/$HOME}"
SEQDESK_DIR="$(resolve_absolute_dir "$SEQDESK_DIR")"

if ! is_truthy "$SEQDESK_PLAN_ONLY"; then
    resolve_install_operation
fi

if is_truthy "$SEQDESK_RECONFIGURE" && [ ! -d "$SEQDESK_DIR" ]; then
    print_error "Reconfigure mode requires an existing installation directory: $SEQDESK_DIR"
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-target-exists-is-not-writable-or-has-too-little-space"
    exit 1
fi

if { is_truthy "$SEQDESK_RECONFIGURE" || is_truthy "$SEQDESK_UPDATE_EXISTING" || is_truthy "$SEQDESK_PREPARE_POSTGRES"; } && [ -d "$SEQDESK_DIR" ]; then
    if is_truthy "$SEQDESK_RECONFIGURE"; then
        print_info "Reconfigure mode: loading defaults from existing installation"
    elif is_truthy "$SEQDESK_UPDATE_EXISTING"; then
        print_info "Update mode: preserving defaults from the existing installation"
    elif is_truthy "$SEQDESK_PREPARE_POSTGRES"; then
        print_info "PostgreSQL setup mode: loading defaults from existing installation"
    fi
    load_existing_install_values "$SEQDESK_DIR"
fi

# Non-interactive, hosted, and reconfigure flows have selected all of their
# inputs by this point. Guided setup deliberately waits for its explained choice.
if ! interactive_wizard_enabled; then
    validate_deployment_profile
fi

SEQDESK_DATA_PATH="$(expand_home_relative_path "$SEQDESK_DATA_PATH")"
SEQDESK_RUN_DIR="$(expand_home_relative_path "$SEQDESK_RUN_DIR")"
SEQDESK_PIPELINE_DATABASE_DIR="$(expand_home_relative_path "$SEQDESK_PIPELINE_DATABASE_DIR")"

preflight_profile_minimum_version

if is_truthy "$SEQDESK_PREPARE_POSTGRES"; then
    prepare_postgres_and_exit
fi

resolve_conda_runtime

# Guided setup wizard (opt-in via --interactive), first half. Runs after
# dependency checks so Node is available for the database reachability test.
# Only the database question is asked here, because the answer decides what the
# preflight below has to do.
run_interactive_wizard_database
validate_deployment_profile
if ! is_truthy "$SEQDESK_RECONFIGURE" && ! is_truthy "$SEQDESK_UPDATE_EXISTING" && \
    [ -z "$SEQDESK_ONBOARDING_VERSION" ]; then
    SEQDESK_ONBOARDING_VERSION="1"
fi
if ! normalize_access_topology; then
    exit 1
fi

# Run the database discovery ladder without starting services, installing
# packages, or creating a cluster. This preserves the useful fail-fast checks
# while keeping the host unchanged until the complete plan is confirmed.
SEQDESK_PREFLIGHT_READ_ONLY="true"
if ! preflight_local_postgres; then
    exit 1
fi
SEQDESK_PREFLIGHT_READ_ONLY="false"

# Second half of the wizard: storage, workflow support, and the one bootstrap
# administrator. An absent local database has been established as preparable;
# an existing database endpoint has already been probed.
run_interactive_wizard_accounts
ensure_secure_bootstrap_accounts

# Pipeline support
print_step "Configure pipeline support"

resolve_pipeline_enablement

# Guided answers have already passed the same validator in
# prompt_profile_storage. Configured/unattended installs receive the matching
# safe defaults and validation here so both routes converge before review.
if ! interactive_wizard_enabled; then
    if ! normalize_storage_layout; then
        exit 1
    fi
fi

HAS_CONDA="false"
if [ "$CONDA_RESOLUTION" = "found" ]; then
    HAS_CONDA="true"
fi

if [ "$PIPELINES_ENABLED" = "true" ]; then
    print_info "Pipeline support enabled"
    print_conda_resolution_notice
else
    print_info "Pipeline support disabled (default for a smaller core installation)"
    print_info "Use --with-pipelines to install Conda and Nextflow support."
fi

# Service lifecycle is part of the reviewed plan. No configuration question is
# allowed after the operator confirms and the apply stages begin.
resolve_service_mode_for_plan
resolve_optional_content_for_plan

print_preflight_summary

if [ "$PIPELINES_ENABLED" = "true" ] && {
    [ "$CONDA_RESOLUTION" = "invalid-configured" ] ||
    [ "$CONDA_RESOLUTION" = "invalid-defaults" ];
}; then
    print_unusable_conda_prefix_error
    exit 1
fi

if ! resolve_release_metadata_for_plan; then
    exit 1
fi

if is_truthy "$SEQDESK_PLAN_ONLY"; then
    if ! emit_install_plan; then
        clear_bootstrap_plaintext_passwords
        exit 1
    fi
    clear_bootstrap_plaintext_passwords
    exit 0
fi

# This is the single product-configuration confirmation. Everything above is
# read-only discovery or ephemeral input handling; service/package/filesystem
# changes start below. The late in-release wizard is skipped for this path.
if ! review_plan_json="$(build_install_plan_json)"; then
    clear_bootstrap_plaintext_passwords
    exit 1
fi
render_install_plan_human "$review_plan_json"
if ! confirm_config "$review_plan_json"; then
    clear_bootstrap_plaintext_passwords
    exit 1
fi
unset review_plan_json
if ! acquire_install_lock; then
    exit 1
fi
write_install_checkpoint "confirmed" "Configuration reviewed; apply may begin"

# Apply the selected PostgreSQL choice only after confirmation. A healthy
# existing server remains untouched; otherwise the normal provisioning ladder
# can now start/adopt a service or create SeqDesk's private cluster.
if ! preflight_local_postgres; then
    exit 1
fi
write_install_checkpoint "database-ready" "Database target prepared and reachable"

if [ "$PIPELINES_ENABLED" = "true" ] && [ "$HAS_CONDA" != "true" ]; then
    print_header "Install Miniconda"

    # An explicitly named installer wins over platform detection, so a site (or a
    # reproducibility appendix) can pin an exact Miniconda build and serve it
    # from SEQDESK_MINICONDA_BASE_URL. The default remains the rolling
    # "-latest-" build; see the note on SEQDESK_MINICONDA_BASE_URL above.
    if [ -n "$SEQDESK_MINICONDA_INSTALLER" ]; then
        CONDA_INSTALLER="$SEQDESK_MINICONDA_INSTALLER"
        print_info "Using pinned Miniconda installer: $CONDA_INSTALLER"
    elif ! CONDA_INSTALLER=$(select_miniconda_installer "$OS" "$ARCH"); then
        print_error "No supported Miniconda installer is available for $OS/$ARCH."
        print_info "Install Conda manually or re-run without pipeline support."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#optional-pipeline-prerequisites"
        exit 1
    fi

    MINICONDA_TEMP_DIR="${TMPDIR:-/tmp}"
    MINICONDA_TEMP_DIR="${MINICONDA_TEMP_DIR%/}"
    MINICONDA_INSTALLER_FILE="$(mktemp "$MINICONDA_TEMP_DIR/seqdesk-miniconda.XXXXXX")"
    MINICONDA_OUTPUT_FILE="$(mktemp "$MINICONDA_TEMP_DIR/seqdesk-miniconda-output.XXXXXX")"
    run_with_spinner "Download Miniconda" \
        curl_download_unbounded_to_file "${SEQDESK_MINICONDA_BASE_URL%/}/$CONDA_INSTALLER" \
        "$MINICONDA_INSTALLER_FILE"

    install_miniconda_with_diagnostics "$MINICONDA_INSTALLER_FILE" "$CONDA_INSTALL_BASE"

    CONDA_INIT_BIN=""
    CONDA_INIT_BIN="$(find_usable_conda_in_prefix "$CONDA_INSTALL_BASE" || true)"
    if [ -z "$CONDA_INIT_BIN" ]; then
        print_error "Miniconda install completed but conda binary was not found under $CONDA_INSTALL_BASE."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#optional-pipeline-prerequisites"
        exit 1
    fi

    CURRENT_SHELL="$(basename "${SHELL:-}")"
    # Both shells are always initialised, with the operator's own shell first.
    # The list must never be empty: bash 3.2 (still the system bash on macOS)
    # treats "${array[@]}" on an empty array as an unbound variable under
    # `set -u` and aborts -- which happened whenever $SHELL was neither bash nor
    # zsh (fish, ksh, tcsh), immediately after Miniconda had been written to disk.
    INIT_SHELLS=(bash zsh)
    if [ "$CURRENT_SHELL" = "zsh" ]; then
        INIT_SHELLS=(zsh bash)
    fi
    for init_shell in "${INIT_SHELLS[@]}"; do
        "$CONDA_INIT_BIN" init "$init_shell" 2>/dev/null || true
    done

    export PATH="$CONDA_INSTALL_BASE/bin:$PATH"
    SEQDESK_EXEC_CONDA_PATH="$CONDA_INSTALL_BASE"
    CONDA_BIN_FROM_PATH="$CONDA_INIT_BIN"
    CONDA_DISCOVERY_SOURCE="installed"
    CONDA_RESOLUTION="found"
    HAS_CONDA="true"

    print_success "Miniconda installed to $CONDA_INSTALL_BASE"
    case "$CURRENT_SHELL" in
        zsh)
            print_warning "Please restart your shell or run: source ~/.zshrc"
            ;;
        bash)
            print_warning "Please restart your shell or run: source ~/.bashrc"
            ;;
        *)
            print_warning "Please restart your shell. If needed, run: $CONDA_INIT_BIN init \"$CURRENT_SHELL\""
            ;;
    esac
fi

# Download
print_step "Download SeqDesk"

LATEST_VERSION=""
if is_truthy "$SEQDESK_RECONFIGURE"; then
    RELEASE_INTEGRITY="not applicable (reconfigure; the installed release is kept)"
    print_info "Reconfigure mode enabled; skipping release download."
else
    VERSION_URL="$SEQDESK_API/version"
    if [ -n "$SEQDESK_VERSION" ]; then
        VERSION_URL="$SEQDESK_API/version?version=$SEQDESK_VERSION"
    fi
    # Via a file rather than a command substitution so the HTTP status and curl
    # exit code survive for the error message. The previous
    # `2>/dev/null || true` form threw both away, leaving a reviewer behind an
    # institute proxy with "Could not connect to SeqDesk server" and no clue.
    VERSION_INFO=""
    VERSION_FETCH_DETAIL=""
    if [ -n "$SEQDESK_PREFETCHED_VERSION_INFO" ]; then
        VERSION_INFO="$SEQDESK_PREFETCHED_VERSION_INFO"
    else
        VERSION_INFO_FILE=$(mktemp)
        if curl_fetch_to_file "$VERSION_URL" "$VERSION_INFO_FILE"; then
            VERSION_INFO=$(cat "$VERSION_INFO_FILE")
        fi
        VERSION_FETCH_DETAIL="$(curl_failure_detail)"
        rm -f "$VERSION_INFO_FILE"
    fi

    if [ -z "$VERSION_INFO" ]; then
        print_error "Could not fetch release metadata from the SeqDesk server."
        print_kv "URL" "$VERSION_URL"
        if [ -n "$VERSION_FETCH_DETAIL" ]; then
            print_kv "Result" "$VERSION_FETCH_DETAIL"
        else
            print_kv "Result" "empty response"
        fi
        print_network_failure_hints
        print_troubleshooting_url
        exit 1
    fi

    if ! VERSION_FIELDS=$(parse_release_version_info "$VERSION_INFO"); then
        print_error "Could not parse version info"
        print_troubleshooting_url
        exit 1
    fi
    IFS=$'\x1f' read -r LATEST_VERSION DOWNLOAD_URL CHECKSUM FILE_SIZE VERSION_FIELDS_END <<< "$VERSION_FIELDS"

    if [ "${VERSION_FIELDS_END:-}" != "__SEQDESK_VERSION_INFO_END__" ]; then
        print_error "Could not parse version info"
        print_troubleshooting_url
        exit 1
    fi

    if [ -z "$LATEST_VERSION" ] || [ -z "$DOWNLOAD_URL" ]; then
        print_error "Could not fetch version info"
        print_troubleshooting_url
        exit 1
    fi

    print_success "Latest version: $LATEST_VERSION"

    if [ -n "$SEQDESK_PROFILE_MIN_VERSION" ] && \
        ! version_at_least "$LATEST_VERSION" "$SEQDESK_PROFILE_MIN_VERSION"; then
        if [ -n "$SEQDESK_PROFILE" ]; then
            print_error "Hosted profile '$SEQDESK_PROFILE' requires SeqDesk ${SEQDESK_PROFILE_MIN_VERSION} or newer, but the selected release is ${LATEST_VERSION}."
        else
            print_error "Installer config requires SeqDesk ${SEQDESK_PROFILE_MIN_VERSION} or newer, but the selected release is ${LATEST_VERSION}."
        fi
        print_info "Choose a newer SeqDesk release or lower minSeqDeskVersion in the installer config."
        print_troubleshooting_url
        exit 1
    fi

    TEMP_FILE=$(mktemp)

    if [ -n "$FILE_SIZE" ] && [ "$FILE_SIZE" -gt 0 ]; then
        SIZE_MB=$((FILE_SIZE / 1024 / 1024))
        print_info "File size: ${SIZE_MB}MB"
    fi

    # GATING preflight: fail fast before downloading/backing up/extracting if
    # the target is not writable or free disk is below max(3x tarball, 2GB).
    gating_preflight "${FILE_SIZE:-0}"

    if ! run_with_spinner "Release package download" \
        curl_download_to_file "$DOWNLOAD_URL" "$TEMP_FILE"; then
        print_error "Could not download the release package."
        print_kv "URL" "$DOWNLOAD_URL"
        print_network_failure_hints
        print_troubleshooting_url
        exit 1
    fi

    if [ -n "$CHECKSUM" ]; then
        EXPECTED_CHECKSUM="$CHECKSUM"
        if [[ "$EXPECTED_CHECKSUM" == sha256:* ]]; then
            EXPECTED_CHECKSUM="${EXPECTED_CHECKSUM#sha256:}"
        fi
        if command -v sha256sum &> /dev/null; then
            ACTUAL_CHECKSUM=$(sha256sum "$TEMP_FILE" | cut -d' ' -f1)
        else
            ACTUAL_CHECKSUM=$(shasum -a 256 "$TEMP_FILE" | cut -d' ' -f1)
        fi

        if [ "$ACTUAL_CHECKSUM" = "$EXPECTED_CHECKSUM" ]; then
            RELEASE_INTEGRITY="sha256 verified"
            print_success "Checksum verified"
        else
            print_error "Checksum mismatch"
            print_error "Expected: $CHECKSUM"
            print_error "Got:      $ACTUAL_CHECKSUM"
            rm -f "$TEMP_FILE"
            print_troubleshooting_url
            exit 1
        fi
    else
        # The checksum field is optional in the release metadata, and its absence
        # used to be completely silent: the install finished with a green SUCCESS
        # footer having verified nothing at all. Say so, in the same place the
        # verified case is reported, and let a reviewer or a regulated site turn
        # it into a hard stop with SEQDESK_REQUIRE_CHECKSUM=1.
        RELEASE_INTEGRITY="NOT VERIFIED (no checksum published for v$LATEST_VERSION)"
        if is_truthy "$SEQDESK_REQUIRE_CHECKSUM"; then
            print_error "No checksum published for v$LATEST_VERSION and SEQDESK_REQUIRE_CHECKSUM is set."
            print_error "Refusing to install an unverified release package."
            rm -f "$TEMP_FILE"
            print_troubleshooting_url
            exit 1
        fi
        print_warning "No checksum published for v$LATEST_VERSION -- the download was NOT verified."
        print_warning "The release metadata from $SEQDESK_API carried no 'checksum' field."
        print_info "To make this a hard failure instead, re-run with SEQDESK_REQUIRE_CHECKSUM=1."
    fi
fi

write_install_checkpoint "release-ready" "Release metadata resolved and package download verified when a checksum was available"

# Extract
print_step "Extract package"

APP_DIR=""
if is_truthy "$SEQDESK_RECONFIGURE"; then
    if [ ! -d "$SEQDESK_DIR" ]; then
        print_error "Reconfigure mode requires an existing installation directory: $SEQDESK_DIR"
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-target-exists-is-not-writable-or-has-too-little-space"
        exit 1
    fi
    print_success "Using existing installation: $SEQDESK_DIR"
    if [ -e "$SEQDESK_DIR/current" ]; then
        APP_DIR="$SEQDESK_DIR/current"
    else
        APP_DIR="$SEQDESK_DIR"
    fi
    # A private PostgreSQL provisioned during THIS reconfigure is deliberately
    # not registered with launchd or systemd: start.sh is the only thing that
    # brings it up. Reconfigure never rewrote start.sh, so after the next reboot
    # pm2 resurrected the app while the database stayed down -- ECONNREFUSED
    # with nothing on screen to connect it to. Rewrite the wrapper, but only
    # when there is a private cluster to add, and only for the releases/current
    # layout the wrapper is written for: a legacy flat install has no "current"
    # directory for it to cd into and would be broken by a rewrite.
    if [ "${SEQDESK_PRIVATE_POSTGRES:-false}" = "true" ]; then
        if [ -e "$SEQDESK_DIR/current" ]; then
            write_root_start_wrapper
            print_info "Updated $SEQDESK_DIR/start.sh so it starts the SeqDesk PostgreSQL instance."
        else
            print_warning "This install predates the releases/current layout; $SEQDESK_DIR/start.sh was left unchanged."
            print_info "Start the SeqDesk PostgreSQL instance yourself before the app, or reinstall to adopt the current layout."
        fi
    fi
elif is_truthy "$SEQDESK_UPDATE_EXISTING"; then
    # Versioned updates stay inside the existing installation root. Shared
    # configuration, data, installed pipelines and previous releases therefore
    # remain in place; only a newly extracted release and the atomic `current`
    # link are changed. This matches the in-app updater's release layout.
    if [ -L "$SEQDESK_DIR/current" ]; then
        RESTORE_CURRENT_LINK_TARGET="$(readlink "$SEQDESK_DIR/current" 2>/dev/null || true)"
    else
        print_warning "This is a legacy flat installation; old application files remain in place, but automatic link rollback is unavailable for this first update."
    fi

    RELEASE_DIR="$SEQDESK_DIR/releases/$LATEST_VERSION"
    if [ -e "$RELEASE_DIR" ]; then
        current_target="$(readlink "$SEQDESK_DIR/current" 2>/dev/null || true)"
        if [ "$current_target" = "releases/$LATEST_VERSION" ]; then
            print_info "SeqDesk v$LATEST_VERSION is already active; reusing the installed release."
            rm -f "$TEMP_FILE"
            APP_DIR="$SEQDESK_DIR/current"
            RESTORE_CURRENT_LINK_TARGET=""
        else
            print_error "Release directory already exists but is not active: $RELEASE_DIR"
            print_info "Run the update repair/diagnostic flow before retrying; the installer will not overwrite a staged or previous release."
            exit 1
        fi
    else
        mkdir -p "$RELEASE_DIR"
        run_with_spinner "Package extraction" tar -xzf "$TEMP_FILE" -C "$RELEASE_DIR" --strip-components=1
        rm "$TEMP_FILE"
        sync_release_shared_paths "$RELEASE_DIR"
        write_root_start_wrapper
        activate_current_release "$LATEST_VERSION"
        link_root_release_metadata
        APP_DIR="$SEQDESK_DIR/current"
        print_success "Activated SeqDesk v$LATEST_VERSION; shared configuration and data were preserved."
    fi
else
    if [ -e "$SEQDESK_DIR" ] && [ "$SEQDESK_EMPTY_TARGET" != "true" ]; then
        if ! is_truthy "$SEQDESK_OVERWRITE_EXISTING"; then
            print_error "Target path changed after preflight and now exists: $SEQDESK_DIR"
            rm -f "$TEMP_FILE"
            print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-target-exists-is-not-writable-or-has-too-little-space"
            exit 1
        fi
        # Before moving the existing install aside, fail fast if a configured
        # database host:port is known but unreachable. Skip cleanly when no
        # host/port is derivable (e.g. local default URL not yet assigned).
        db_probe_target=""
        if command_exists node && command_exists timeout; then
            db_probe_url="$SEQDESK_DATABASE_DIRECT_URL"
            if [ -z "$db_probe_url" ]; then
                db_probe_url="$SEQDESK_DATABASE_URL"
            fi
            if [ -n "$db_probe_url" ]; then
                db_probe_target="$(postgres_url_host_port "$db_probe_url" 2>/dev/null || true)"
            fi
        fi
        if [ -n "$db_probe_target" ]; then
            db_probe_host="${db_probe_target%%$'\t'*}"
            db_probe_port="${db_probe_target##*$'\t'}"
            # Strip IPv6 brackets so the host matches the loopback set below and
            # forms a valid /dev/tcp path (bash rejects "/dev/tcp/[::1]/port").
            db_probe_host="${db_probe_host#[}"
            db_probe_host="${db_probe_host%]}"
            if [ -n "$db_probe_host" ] && [ -n "$db_probe_port" ]; then
                case "$db_probe_host" in
                    127.0.0.1|localhost|::1)
                        # Loopback DB is provisioned/started by the installer
                        # later; do not abort if it is not up yet.
                        :
                        ;;
                    *)
                        if db_tcp_reachable "$db_probe_host" "$db_probe_port"; then
                            print_success "Database reachable at ${db_probe_host}:${db_probe_port}"
                        else
                            print_error "Database is not reachable at ${db_probe_host}:${db_probe_port}."
                            print_info "Refusing to move the existing install aside until the database is reachable."
                            print_postgres_setup_instructions
                            exit 1
                        fi
                        ;;
                esac
            fi
        fi
        unset db_probe_target db_probe_url db_probe_host db_probe_port 2>/dev/null || true

        existing_backup_path="${SEQDESK_DIR}.backup.$(date +%Y%m%d%H%M%S)"
        while [ -e "$existing_backup_path" ]; do
            existing_backup_path="${SEQDESK_DIR}.backup.$(date +%Y%m%d%H%M%S).$$.${RANDOM}"
        done
        mv "$SEQDESK_DIR" "$existing_backup_path"
        RESTORE_BACKUP_PATH="$existing_backup_path"
        INSTALL_PHASE="backup_moved"
        print_success "Moved existing install directory to $existing_backup_path"
        print_info "The PostgreSQL database was not moved, copied or reset; this install reuses it."
    elif [ "$SEQDESK_EMPTY_TARGET" = "true" ]; then
        print_success "Using existing empty target directory: $SEQDESK_DIR"
    fi

    RELEASE_DIR="$SEQDESK_DIR/releases/$LATEST_VERSION"
    mkdir -p "$RELEASE_DIR"
    run_with_spinner "Package extraction" tar -xzf "$TEMP_FILE" -C "$RELEASE_DIR" --strip-components=1
    rm "$TEMP_FILE"
    sync_release_shared_paths "$RELEASE_DIR"
    write_root_start_wrapper
    activate_current_release "$LATEST_VERSION"
    link_root_release_metadata
    APP_DIR="$SEQDESK_DIR/current"
    # New release is activated and 'current' resolves; a later failure must not
    # restore the old backup over the freshly installed tree.
    INSTALL_PHASE="release_activated"
    RESTORE_BACKUP_PATH=""
fi

cd "$APP_DIR"
write_install_checkpoint "release-activated" "Application release prepared and selected"

INSTALLED_VERSION="$LATEST_VERSION"
if command_exists node && [ -f package.json ]; then
    DETECTED_VERSION=$(node -p "try{const pkg=require('./package.json'); pkg.version||''}catch(e){''}" 2>/dev/null || true)
    if [ -n "$DETECTED_VERSION" ]; then
        INSTALLED_VERSION="$DETECTED_VERSION"
    fi
fi
if [ -z "$INSTALLED_VERSION" ]; then
    INSTALLED_VERSION="${SEQDESK_VERSION:-unknown}"
fi
if is_truthy "$SEQDESK_RECONFIGURE" && [ -n "$SEQDESK_PROFILE_MIN_VERSION" ] && \
    ! version_at_least "$INSTALLED_VERSION" "$SEQDESK_PROFILE_MIN_VERSION"; then
    if [ -n "$SEQDESK_PROFILE" ]; then
        print_error "Hosted profile '$SEQDESK_PROFILE' requires SeqDesk ${SEQDESK_PROFILE_MIN_VERSION} or newer, but this installation is ${INSTALLED_VERSION}."
    else
        print_error "Installer config requires SeqDesk ${SEQDESK_PROFILE_MIN_VERSION} or newer, but this installation is ${INSTALLED_VERSION}."
    fi
    print_info "Update SeqDesk before reconfiguring with this profile."
    print_troubleshooting_url
    exit 1
fi

# Install runtime dependencies
print_step "Install runtime Node dependencies"
install_runtime_node_modules

# Configure environment
print_step "Configure environment"

# All product/configuration questions were resolved and confirmed before apply.
# Reaching into the extracted release for a second wizard here caused settings
# to change after confirmation and made cancellation unsafe.

configure_postgres_urls

if [ -z "$SEQDESK_NEXTAUTH_SECRET" ]; then
    SEQDESK_NEXTAUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    print_info "Generated runtime.nextAuthSecret for the runtime config"
fi

# Prove the configured roots before persisting them. A warning here previously
# produced a successful-looking installation whose settings pointed at an
# unusable directory. Operators can mount or grant access and rerun safely.
if ! prepare_storage_layout; then
    print_error "Storage preparation failed; runtime configuration was not updated."
    print_info "Mount the selected storage or grant the current service user access, then rerun with the same choices."
    exit 1
fi

write_config "$PIPELINES_ENABLED" "$SEQDESK_DATA_PATH" "$SEQDESK_RUN_DIR"
write_install_checkpoint "configuration-written" "Storage probes passed and runtime configuration persisted"

clear_bootstrap_plaintext_passwords
export DATABASE_URL="$SEQDESK_DATABASE_URL"
export DIRECT_URL="$SEQDESK_DATABASE_DIRECT_URL"
export SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED

# Initialize database
SEED_OK="false"
DB_INIT_SKIPPED="false"
DB_MIGRATED_ONLY="false"
if is_truthy "$SEQDESK_RECONFIGURE" && ! is_truthy "$SEQDESK_RESEED_DB"; then
    DB_INIT_SKIPPED="true"
    print_info "Reconfigure mode: skipping database migrations/seed to preserve existing data."
    print_info "Use --reseed-db (or SEQDESK_RESEED_DB=1) to run migrations + seed explicitly."
else
    if is_truthy "$SEQDESK_RECONFIGURE" && is_truthy "$SEQDESK_RESEED_DB"; then
        print_warning "Reconfigure mode with --reseed-db: running migrations + seed on existing database."
    fi
    ensure_local_postgres_database || true
    if ! probe_postgres_database; then
        echo ""
        echo "  After fixing the database, rerun:"
        echo "  npx -y seqdesk@latest -y --reconfigure --reseed-db --dir $(shell_quote "$SEQDESK_DIR")"
        exit 1
    fi
    if ! run_with_spinner "PostgreSQL migrations" node scripts/run-prisma.mjs migrate deploy; then
        echo ""
        if [ "$SEQDESK_LOG_ENABLED" = "true" ] && [ -f "$SEQDESK_LOG" ]; then
            PRISMA_EXCERPT="$(grep -iE 'P[0-9]{4}|prisma|migrat|fatal|error|permission denied|does not exist' "$SEQDESK_LOG" | tail -n 12 || true)"
            if [ -n "$PRISMA_EXCERPT" ]; then
                print_warning "Prisma migration error excerpt (full log: $SEQDESK_LOG):"
                printf '%s\n' "$PRISMA_EXCERPT" | sed 's/^/  /'
                echo ""
            fi
            unset PRISMA_EXCERPT
        fi
        print_postgres_setup_instructions
        exit 1
    fi
    if is_truthy "$SEQDESK_UPDATE_EXISTING"; then
        DB_MIGRATED_ONLY="true"
        print_info "Update mode: migrations applied; seed data and user accounts were left unchanged."
    else
    # The migrations have run, so the User table is there to look at, and the
    # seed has not run yet. This is the only point where the installer can still
    # tell whether the credentials it is holding will actually be applied.
    adopt_existing_bootstrap_accounts

    ensure_seed_dependency "bcryptjs" || true
    if run_with_spinner_warn "Seed initial data" npm run db:seed; then
        SEED_OK="true"
    fi

    # Fallback: run seed.mjs directly if prisma db seed failed
    if [ "$SEED_OK" = "false" ]; then
        print_info "Trying direct seed..."
        if [ -f prisma/seed.mjs ] && run_with_spinner_warn "Direct seed" node prisma/seed.mjs; then
            SEED_OK="true"
        elif [ -f prisma/seed.js ] && run_with_spinner_warn "Direct seed" node prisma/seed.js; then
            SEED_OK="true"
        fi
    fi
    if [ "$SEQDESK_BOOTSTRAP_ADMIN_EXISTED" != "true" ] && \
        verify_bootstrap_administrator_created; then
        SEQDESK_BOOTSTRAP_ADMIN_VERIFIED="true"
        detail "verified bootstrap administrator ${SEQDESK_BOOTSTRAP_ADMIN_EMAIL}"
    fi
    fi
fi

if [ "$DB_INIT_SKIPPED" = "true" ]; then
    print_info "Database unchanged."
elif [ "$DB_MIGRATED_ONLY" = "true" ]; then
    print_success "Database schema updated; existing data, seed state, and user accounts preserved"
elif [ "$SEED_OK" = "true" ]; then
    # "Database initialized" used to print either way, so a reviewer whose
    # printed credentials were inert had nothing on screen to tell them the
    # database was not new. Name which of the three happened -- and say "empty"
    # only where a row count said so, never merely because the two bootstrap
    # addresses were absent.
    if [ "$SEQDESK_DB_ADOPTED" = "true" ]; then
        print_success "Existing SeqDesk database adopted: schema updated, existing accounts and data kept"
    elif [ "$SEQDESK_DB_USER_COUNT" = "0" ]; then
        print_success "Database initialized (new, empty SeqDesk database)"
    elif [ -n "$SEQDESK_DB_USER_COUNT" ]; then
        print_success "Database initialized: schema updated"
        print_warning "This database already held $SEQDESK_DB_USER_COUNT user account(s) before this install."
        echo "  None of them uses a bootstrap address, so this install created its own"
        echo "  account alongside them. No account, order or other record that was"
        echo "  already there has been changed."
    else
        print_success "Database initialized"
    fi
    if is_truthy "$SEQDESK_RECONFIGURE"; then
        print_info "Reconfigure mode: existing user accounts were kept."
    elif [ "$SEQDESK_DB_ADOPTED" = "true" ]; then
        # The adopted-accounts notice above already said which accounts govern.
        :
    elif [ -n "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH:-}" ] || [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
        print_info "Bootstrap account configuration applied."
        if [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
            print_info "Additional member accounts will be invited after administrator login."
        fi
    else
        print_warning "No bootstrap administrator account was configured."
    fi
else
    print_info "Seed did not complete during install -- the app will auto-seed on first launch"
    if [ "$SEQDESK_DB_ADOPTED" = "true" ]; then
        print_info "The accounts already in this database keep their current passwords."
    elif ! is_truthy "$SEQDESK_RECONFIGURE"; then
        print_info "The configured administrator will be created on first launch; no default member account is enabled."
    fi
fi
write_install_checkpoint "database-applied" "Database migration/seed policy completed"

if [ -n "$SEQDESK_PROFILE_CONFIG_FILE" ]; then
    if [ ! -f "scripts/apply-install-profile.mjs" ]; then
        print_error "Missing scripts/apply-install-profile.mjs; cannot apply hosted install profile."
        exit 1
    fi

    if ! run_with_spinner "Hosted install profile settings" node scripts/apply-install-profile.mjs --profile-config "$SEQDESK_PROFILE_CONFIG_FILE"; then
        exit 1
    fi
elif [ -n "$SEQDESK_FEATURE_MODULES_JSON" ] && [ "$SEQDESK_FEATURE_MODULES_JSON" != "{}" ]; then
    if [ ! -f "scripts/apply-install-profile.mjs" ]; then
        print_error "Missing scripts/apply-install-profile.mjs; cannot apply configured feature modules."
        exit 1
    fi

    # The normalized, non-secret module map has already passed InstallPlan
    # compatibility validation. Apply it only for local/unattended config;
    # hosted profiles must continue through the profile applicator above so
    # their managed-setting and reload semantics remain intact.
    if ! run_with_spinner "Configured feature modules" \
        env SEQDESK_FEATURE_MODULES_JSON="$SEQDESK_FEATURE_MODULES_JSON" \
        node scripts/apply-install-profile.mjs --feature-modules-from-env; then
        exit 1
    fi
fi

if [ -n "$SEQDESK_ORDER_FORM_SETTINGS" ] || [ -n "$SEQDESK_STUDY_FORM_SETTINGS" ]; then
    form_args=()
    if [ -n "$SEQDESK_ORDER_FORM_SETTINGS" ]; then
        form_args+=(--order-form-settings "$SEQDESK_ORDER_FORM_SETTINGS")
    fi
    if [ -n "$SEQDESK_STUDY_FORM_SETTINGS" ]; then
        form_args+=(--study-form-settings "$SEQDESK_STUDY_FORM_SETTINGS")
    fi
    if ! run_with_spinner "Form preset settings" node scripts/apply-form-configs.mjs "${form_args[@]}"; then
        exit 1
    fi
fi

if has_infrastructure_overrides; then
    run_with_spinner "Infrastructure settings" apply_infrastructure_settings
fi

# Pipeline environment
print_step "Configure pipeline environment"

if [ "$PIPELINES_ENABLED" = "true" ]; then
    setup_args=(
        --yes
        --write-config
        --pipelines-enabled
        --data-path "${SEQDESK_DATA_PATH:-./data}"
        --run-dir "${SEQDESK_RUN_DIR:-./pipeline_runs}"
    )
    if [ -n "$SEQDESK_EXEC_CONDA_PATH" ]; then
        setup_args+=(--conda-path "$SEQDESK_EXEC_CONDA_PATH")
    fi
    run_with_spinner "Pipeline Conda environment" ./scripts/setup-conda-env.sh "${setup_args[@]}"
else
    print_info "Skipped pipeline environment setup"
fi

install_private_metaxpath_if_configured

if [ -n "$SEQDESK_PROFILE_CONFIG_FILE" ]; then
    if [ ! -f "scripts/apply-install-profile-assets.mjs" ]; then
        print_error "Missing scripts/apply-install-profile-assets.mjs; cannot apply hosted install profile assets."
        exit 1
    fi

    if ! run_with_spinner "Hosted install profile pipeline assets" node scripts/apply-install-profile-assets.mjs --profile-config "$SEQDESK_PROFILE_CONFIG_FILE"; then
        exit 1
    fi
    rm -f "$SEQDESK_PROFILE_CONFIG_FILE"
    SEQDESK_PROFILE_CONFIG_FILE=""
fi

print_step "Configure process manager"

if is_truthy "$SEQDESK_USE_PM2"; then
    if ! resolve_pm2_bin; then
        if run_with_spinner_warn "PM2 global install" npm install -g pm2; then
            resolve_pm2_bin || true
        else
            print_warning "Trying local PM2 install (no sudo required)."
            if run_with_spinner_warn "PM2 local install" npm install --no-save pm2; then
                if resolve_pm2_bin; then
                    print_success "PM2 installed locally at ./node_modules/.bin/pm2"
                else
                    print_warning "PM2 install finished but PM2 binary was not found in PATH or local node_modules."
                fi
            else
                print_warning "Local PM2 install failed. Manual fallback: npm install --no-save pm2"
            fi
        fi
    fi

    if resolve_pm2_bin; then
        print_info "Using PM2 command: $PM2_DISPLAY_CMD"
        if [ "$PM2_PROCESS_EXISTS" != "true" ] && pm2_exec describe seqdesk >/dev/null 2>&1; then
            PM2_PROCESS_EXISTS="true"
        fi

        if [ "$PM2_PROCESS_EXISTS" = "true" ]; then
            # --update-env: a plain restart replays the environment PM2 captured
            # when the app was first started, which on an install that predates
            # pm2_exec_runtime still holds that install's DATABASE_URL. The app
            # would then keep the old database no matter what settings.json now
            # says. --update-env merges this environment into that copy, and
            # pm2_exec_runtime supplies empty DATABASE_URL/DIRECT_URL values --
            # merging cannot delete a variable, so an empty value is what
            # actually clears the frozen one and hands the process back to
            # settings.json.
            if run_with_spinner_warn "Restart SeqDesk PM2 process" pm2_exec_runtime restart seqdesk --update-env; then
                PM2_CONFIGURED="true"
                pm2_exec save >/dev/null 2>&1 || print_warning "Could not save PM2 process list (run: $PM2_DISPLAY_CMD save)"
            else
                print_warning "PM2 failed to restart seqdesk. You can restart manually with: DATABASE_URL= DIRECT_URL= $PM2_DISPLAY_CMD restart seqdesk --update-env"
            fi
        else
            if run_with_spinner_warn "Start SeqDesk with PM2" pm2_exec_runtime start "$SEQDESK_DIR/start.sh" --name seqdesk; then
                PM2_CONFIGURED="true"
                pm2_exec save >/dev/null 2>&1 || print_warning "Could not save PM2 process list (run: $PM2_DISPLAY_CMD save)"
                if pm2_exec startup >/dev/null 2>&1; then
                    PM2_STARTUP_ENABLED="true"
                else
                    print_warning "PM2 boot startup is not enabled yet. Run: $PM2_DISPLAY_CMD startup"
                fi
            else
                print_warning "PM2 failed to start SeqDesk. You can start manually with: $PM2_DISPLAY_CMD start \"$SEQDESK_DIR/start.sh\" --name seqdesk"
            fi
        fi
    else
        print_warning "PM2 is not available. You can start manually with ./start.sh, or set up systemd."
    fi
else
    print_info "Skipping PM2 setup"
fi

print_step "Install user CLI"
install_user_cli

# A failed seed can still be completed by startup auto-seeding. Retry after a
# managed service has started, but never infer account creation merely from a
# successful process-manager command.
if ! is_truthy "$SEQDESK_RECONFIGURE" && ! is_truthy "$SEQDESK_UPDATE_EXISTING" && \
    [ "$SEQDESK_BOOTSTRAP_ADMIN_EXISTED" != "true" ] && \
    [ "$SEQDESK_BOOTSTRAP_ADMIN_VERIFIED" != "true" ] && \
    verify_bootstrap_administrator_created; then
    SEQDESK_BOOTSTRAP_ADMIN_VERIFIED="true"
    detail "verified bootstrap administrator after application startup"
fi
write_install_checkpoint "complete" "Application, configuration, database, runtime, and service setup completed"
complete_install_checkpoint

# Done
INSTALL_END_TS=$(date +%s)
INSTALL_FINISHED_AT=$(date '+%Y-%m-%d %H:%M:%S %Z')
ELAPSED=$((INSTALL_END_TS - INSTALL_START_TS))

print_header "Install complete"

print_kv "Version" "v$INSTALLED_VERSION"
if [ -n "$SEQDESK_PROFILE" ]; then
    print_kv "Profile" "$SEQDESK_PROFILE"
fi
if is_truthy "$SEQDESK_RECONFIGURE"; then
    print_kv "Mode" "reconfigure existing install"
elif is_truthy "$SEQDESK_UPDATE_EXISTING"; then
    print_kv "Mode" "update existing install"
fi
print_kv "Directory" "$SEQDESK_DIR"
if [ -n "$SEQDESK_USER_CLI_PATH" ]; then
    print_kv "CLI" "$SEQDESK_USER_CLI_PATH"
    if [ "$SEQDESK_USER_CLI_NEEDS_PATH" = "true" ]; then
        print_warning "$SEQDESK_USER_CLI_BIN_DIR is not currently on PATH. No shell startup file was changed."
        printf '  Add it for this shell with: export PATH=%s:"$PATH"\n' \
            "$(shell_quote "$SEQDESK_USER_CLI_BIN_DIR")"
    fi
fi
print_kv "Browser URL" "$(browser_app_url)"
print_kv "Local health URL" "$(local_app_url)"
print_kv "Bind host" "$(bind_host)"
if [ "$(bind_host)" = "0.0.0.0" ]; then
    print_warning "SeqDesk is listening on every network interface. Set SEQDESK_BIND_HOST=127.0.0.1 before install/start for local-only use."
fi
print_kv "Node.js" "v$NODE_VERSION"
if command_exists conda && [ "$PIPELINES_ENABLED" = "true" ]; then
    CONDA_VERSION=$(conda --version 2>/dev/null | awk '{print $2}' || true)
    if [ -n "$CONDA_VERSION" ]; then
        print_kv "Conda" "v$CONDA_VERSION"
    fi
fi
PIPELINES_LABEL="disabled"
if [ "$PIPELINES_ENABLED" = "true" ]; then
    PIPELINES_LABEL="enabled"
fi
print_kv "Pipelines" "$PIPELINES_LABEL"
print_kv "Deployment profile" "$(deployment_profile_label "$SEQDESK_DEPLOYMENT_PROFILE")"
if [ -n "$SEQDESK_DATA_PATH" ]; then
    print_kv "Data path" "$SEQDESK_DATA_PATH"
fi
if [ -n "$SEQDESK_RUN_DIR" ] && [ "$PIPELINES_ENABLED" = "true" ]; then
    print_kv "Run directory" "$SEQDESK_RUN_DIR"
fi
if [ -n "$SEQDESK_PIPELINE_DATABASE_DIR" ] && [ "$PIPELINES_ENABLED" = "true" ]; then
    print_kv "Pipeline DB directory" "$SEQDESK_PIPELINE_DATABASE_DIR"
fi
INSTALLED_CONFIG_PATH="$SEQDESK_DIR/settings.json"
for f in settings.json seqdesk.config.json; do
    if [ -f "$SEQDESK_DIR/$f" ]; then
        INSTALLED_CONFIG_PATH="$SEQDESK_DIR/$f"
        print_kv "Config" "$INSTALLED_CONFIG_PATH"
        break
    fi
done
print_kv "Package integrity" "$RELEASE_INTEGRITY"

# A SeqDesk-owned PostgreSQL is invisible to `brew services` and `systemctl`, so
# this summary is the only place its location and its control command are ever
# stated -- and it is the block a reviewer screenshots for the supplementary
# materials. Printed only when the installer actually provisioned one; an
# adopted or remote database is the operator's to document.
if [ "${SEQDESK_PRIVATE_POSTGRES:-false}" = "true" ]; then
    print_kv "Database" "SeqDesk-managed PostgreSQL (Unix socket only, no TCP port)"
    print_kv "Database home" "$(private_postgres_root)"
    print_kv "Database socket" "$(private_postgres_socket_dir):$PRIVATE_PG_PORT"
    print_kv "Database log" "$(private_postgres_log_file)"
    echo "  $SEQDESK_DIR/start.sh starts it; it is not a launchd or systemd service."
    PRIVATE_PG_CTL="$(find_postgres_binary pg_ctl 2>/dev/null || true)"
    if [ -n "$PRIVATE_PG_CTL" ]; then
        echo "  To control it directly:"
        printf '  %s -D %s -l %s start\n' \
            "$(shell_quote "$PRIVATE_PG_CTL")" \
            "$(shell_quote "$(private_postgres_data_dir)")" \
            "$(shell_quote "$(private_postgres_log_file)")"
        printf '  %s -D %s -m fast stop\n' \
            "$(shell_quote "$PRIVATE_PG_CTL")" \
            "$(shell_quote "$(private_postgres_data_dir)")"
    fi
fi
print_kv "Started" "$INSTALL_STARTED_AT"
print_kv "Finished" "$INSTALL_FINISHED_AT"
print_kv "Elapsed" "$(format_elapsed "$ELAPSED")"
if [ -n "$SEQDESK_LOG" ]; then
    print_kv "Log" "$SEQDESK_LOG"
fi

print_header "Run"

if [ "$PM2_CONFIGURED" = "true" ]; then
    print_kv "Mode" "PM2"
    echo "  $PM2_DISPLAY_CMD status"
    echo "  $PM2_DISPLAY_CMD logs seqdesk"
    echo "  $PM2_DISPLAY_CMD restart seqdesk"
    echo ""
    # PM2 replays the environment it captured when the app was first started, so
    # a plain restart keeps serving the old configuration after settings.json has
    # been edited. --update-env alone is not enough either: it merges the current
    # environment into that stored copy and cannot remove anything from it, so a
    # database URL an older install froze into the process survives it. The empty
    # values are what overwrite it -- start.sh treats an empty DATABASE_URL as
    # unset and reads settings.json.
    echo "  After editing $INSTALLED_CONFIG_PATH:"
    echo "  DATABASE_URL= DIRECT_URL= SEQDESK_DATA_PATH= $PM2_DISPLAY_CMD restart seqdesk --update-env"
    echo "  $PM2_DISPLAY_CMD save"
    echo "  (a plain restart replays the environment PM2 captured at first start;"
    echo "   --update-env merges into it and cannot drop a variable, so the empty"
    echo "   values above are what clear a database URL frozen in by an older install)"
    echo ""
    echo "  If the PM2 process was removed:"
    echo "  $PM2_DISPLAY_CMD start \"$SEQDESK_DIR/start.sh\" --name seqdesk"
    echo "  $PM2_DISPLAY_CMD save"
    if [ "$PM2_STARTUP_ENABLED" != "true" ]; then
        echo ""
        echo "  Enable PM2 on reboot:"
        echo "  $PM2_DISPLAY_CMD startup"
        echo "  $PM2_DISPLAY_CMD save"
    fi
else
    print_kv "Mode" "manual"
    echo "  SeqDesk is installed but not running yet. Start it with:"
    echo ""
    # Absolute path: the reader is not necessarily in the install directory, and
    # a bare ./start.sh silently does nothing useful from anywhere else.
    printf '  %b%s/start.sh%b\n' "$CYAN" "$SEQDESK_DIR" "$NC"
    echo ""
    echo "  Leave it running in that terminal, or start it in the background with:"
    printf '  %bnohup %s/start.sh > %s/seqdesk.out 2>&1 &%b\n' \
        "$CYAN" "$SEQDESK_DIR" "$SEQDESK_DIR" "$NC"
    echo ""
    echo "  A manual start does not come back after a reboot or an update."
fi

# Extracted so the credential summary can be asserted directly. It used to be
# inline top-level code, which is why nothing could test that it renders a real
# password rather than an empty one.

print_login_summary

print_header "Diagnose"

# A persistent service can be checked immediately and should not make a new
# operator discover the verification flag. SEQDESK_RUN_DOCTOR=0 remains an
# explicit opt-out for automation that performs its own health check.
enable_doctor_for_persistent_service

if seqdesk_cli_command >/dev/null 2>&1; then
    if [ "$PM2_CONFIGURED" = "true" ]; then
        print_doctor_command
    else
        echo "  After starting SeqDesk:"
        print_doctor_command
    fi
    run_doctor_if_requested
else
    if is_truthy "$SEQDESK_RUN_DOCTOR"; then
        print_warning "seqdesk CLI not found; skipping automatic doctor run."
    fi
    print_warning "The user-level SeqDesk CLI could not be installed."
    echo "  Re-run the installer after checking that \$HOME/.local/bin is writable, then run:"
    print_doctor_command
fi

print_success_footer
print_next_steps
