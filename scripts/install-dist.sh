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
#   SEQDESK_INTERACTIVE=1          - Guided setup wizard (database choice + accounts)
#   SEQDESK_DATA_PATH=/data        - Optional sequencing data base path override
#   SEQDESK_RUN_DIR=/data/runs     - Optional pipeline run directory override
#   SEQDESK_PIPELINE_DATABASE_DIR=/data/pipeline-dbs - Optional pipeline DB directory override
#   SEQDESK_PORT=8000              - App port (default: 8000)
#   SEQDESK_BIND_HOST=0.0.0.0      - Optional standalone server bind host
#   SEQDESK_NEXTAUTH_URL=https://  - Optional NextAuth URL override
#   SEQDESK_NEXTAUTH_SECRET=...    - Optional NextAuth secret override
#   SEQDESK_DATABASE_URL=postgresql://... - Optional database URL
#   SEQDESK_DATABASE_DIRECT_URL=postgresql://... - Optional direct database URL for migrations
#   SEQDESK_ANTHROPIC_API_KEY=...  - Optional Anthropic API key
#   SEQDESK_ADMIN_SECRET=...       - Optional admin secret
#   SEQDESK_BLOB_READ_WRITE_TOKEN=... - Optional Blob token
#   SEQDESK_ORDER_FORM_SETTINGS=/path/order.json - Optional exported order form preset
#   SEQDESK_STUDY_FORM_SETTINGS=/path/study.json - Optional exported study form preset
#   SEQDESK_LOG=/path/install.log  - Optional install log path (default: /tmp/seqdesk-install-*.log)
#   SEQDESK_USE_PM2=1             - Start with PM2 for auto-restart (recommended)
#   SEQDESK_RUN_DOCTOR=1          - Run seqdesk doctor after install when the CLI is available
#   SEQDESK_CONFIG=/path/or/url    - Optional infra JSON (flat or nested keys)
#   SEQDESK_PROFILE=twincore       - Hosted install profile id
#   SEQDESK_PROFILE_CODE=...       - Access code for hosted install profile
#   SEQDESK_PROFILE_REGISTRY_URL=https://seqdesk.org/api/install-profiles
#   SEQDESK_ADDITIONAL_SETTINGS_FILE=/etc/seqdesk/install-overrides.json - Optional local JSON overrides
#   SEQDESK_RECONFIGURE=1          - Reconfigure existing install in place (repeatable)
#   SEQDESK_OVERWRITE_EXISTING=1   - With -y, back up an existing install dir and replace it
#   SEQDESK_RESEED_DB=1            - Force DB push + seed (default off for reconfigure)
#   SEQDESK_PREPARE_POSTGRES=1     - Prepare local PostgreSQL role/database, then exit
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

set -euo pipefail

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
# Promote diagnostic detail() narration from the install log to the terminal.
SEQDESK_VERBOSE="${SEQDESK_VERBOSE:-}"
# Whether the installer generated the bootstrap passwords (and therefore has to
# show them once at the end) rather than the operator supplying them.
INTERACTIVE_RESULT_GENERATED="false"
SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="false"
SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="false"
INTERACTIVE_RESULT=""
SEQDESK_DATA_PATH="${SEQDESK_DATA_PATH:-}"
SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-}"
SEQDESK_PORT="${SEQDESK_PORT:-}"
SEQDESK_BIND_HOST="${SEQDESK_BIND_HOST:-}"
SEQDESK_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}"
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
SEQDESK_LOG="${SEQDESK_LOG:-}"
SEQDESK_USE_PM2="${SEQDESK_USE_PM2:-}"
SEQDESK_RUN_DOCTOR="${SEQDESK_RUN_DOCTOR:-}"
SEQDESK_CONFIG="${SEQDESK_CONFIG:-}"
SEQDESK_PROFILE="${SEQDESK_PROFILE:-${SEQDESK_SETTING:-}}"
SEQDESK_PROFILE_CODE="${SEQDESK_PROFILE_CODE:-${SEQDESK_KEY:-}}"
SEQDESK_PROFILE_REGISTRY_URL="${SEQDESK_PROFILE_REGISTRY_URL:-https://seqdesk.org/api/install-profiles}"
SEQDESK_PROFILE_CONFIG_FILE=""
SEQDESK_ADDITIONAL_SETTINGS_FILE="${SEQDESK_ADDITIONAL_SETTINGS_FILE:-}"
SEQDESK_ADDITIONAL_SETTINGS=()
SEQDESK_RECONFIGURE="${SEQDESK_RECONFIGURE:-}"
SEQDESK_OVERWRITE_EXISTING="${SEQDESK_OVERWRITE_EXISTING:-}"
SEQDESK_RESEED_DB="${SEQDESK_RESEED_DB:-}"
SEQDESK_PREPARE_POSTGRES="${SEQDESK_PREPARE_POSTGRES:-}"
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

SEQDESK_LOG_ENABLED="false"
PM2_CONFIGURED="false"
PM2_STARTUP_ENABLED="false"
PM2_PROCESS_EXISTS="false"
PM2_BIN=""
PM2_DISPLAY_CMD="pm2"
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
INSTALL_PHASE="init"

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
    printf '%s' "${persisted_bind_host:-0.0.0.0}"
}

doctor_url() {
    local_app_url
}

print_doctor_command() {
    printf '  seqdesk doctor --dir %s --url %s\n' "$(shell_quote "$SEQDESK_DIR")" "$(shell_quote "$(doctor_url)")"
}

run_doctor_if_requested() {
    if ! is_truthy "$SEQDESK_RUN_DOCTOR"; then
        return 0
    fi

    if ! command_exists seqdesk; then
        print_warning "seqdesk CLI not found; skipping automatic doctor run."
        print_info "Install CLI: npm install -g seqdesk"
        return 0
    fi

    echo ""
    print_info "Running seqdesk doctor..."
    if seqdesk doctor --dir "$SEQDESK_DIR" --url "$(doctor_url)"; then
        print_success "Doctor checks completed"
    else
        print_warning "Doctor reported issues. Installation completed; review the checks above."
    fi
}

can_mirror_output_to_log() {
    ( : > >(cat >/dev/null) ) 2>/dev/null
}

configure_install_log() {
    exec 3>&1 || true

    if [ -z "$SEQDESK_LOG" ]; then
        SEQDESK_LOG="/tmp/seqdesk-install-$(date '+%Y%m%d-%H%M%S').log"
    fi

    mkdir -p "$(dirname "$SEQDESK_LOG")" 2>/dev/null || true
    : > "$SEQDESK_LOG" 2>/dev/null || {
        print_warning "Could not create install log: $SEQDESK_LOG"
        return 0
    }
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

    date +%s | shasum | awk '{print $1}' | cut -c1-32
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
        generated_password="$(generate_postgres_password)"
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
        local database_host
        database_host="$(postgres_url_host "$SEQDESK_DATABASE_DIRECT_URL")"
        if [ -z "$database_host" ]; then
            database_host="$(postgres_url_host "$SEQDESK_DATABASE_URL")"
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

probe_postgres_database() {
    # Connect to DATABASE_URL using the pg module installed with the runtime
    # dependencies and report a categorized failure if anything is wrong.
    # Must be called from the install directory so node can resolve "pg".
    if [ -z "$SEQDESK_DATABASE_URL" ]; then
        return 0
    fi
    if [ -n "${MACOS_POSTGRES_SOCKET_DIR:-}" ] && \
        ! postgres_socket_owned_by_current_user "$MACOS_POSTGRES_SOCKET_DIR" "${PG_PORT:-5432}"; then
        print_untrusted_macos_postgres_socket "$MACOS_POSTGRES_SOCKET_DIR" "${PG_PORT:-5432}"
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
    const tables = await client.query(`
      SELECT
        to_regclass('public."User"') IS NOT NULL AS has_users,
        to_regclass('public."Order"') IS NOT NULL AS has_orders
    `);
    if (tables.rows[0]?.has_users || tables.rows[0]?.has_orders) {
      let users = "unknown";
      let orders = "unknown";
      if (tables.rows[0]?.has_users) {
        const result = await client.query('SELECT COUNT(*)::bigint AS count FROM "User"');
        users = String(result.rows[0]?.count ?? "unknown");
      }
      if (tables.rows[0]?.has_orders) {
        const result = await client.query('SELECT COUNT(*)::bigint AS count FROM "Order"');
        orders = String(result.rows[0]?.count ?? "unknown");
      }
      console.log("EXISTING_SEQDESK\t" + users + "\t" + orders);
    }
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
            return 0
            ;;
        OK*)
            local database_name database_role database_version
            IFS=$'\t' read -r _ database_name database_role database_version <<< "$first_line"
            print_kv "PostgreSQL server" "${database_version:-unknown} (${database_name:-unknown} as ${database_role:-unknown})"

            local existing_line
            existing_line="$(printf '%s\n' "$probe_output" | grep '^EXISTING_SEQDESK' | head -n 1)"
            if [ -n "$existing_line" ] && ! is_truthy "$SEQDESK_RECONFIGURE"; then
                local existing_users existing_orders
                IFS=$'\t' read -r _ existing_users existing_orders <<< "$existing_line"
                print_warning "Existing SeqDesk data was detected in the selected database."
                print_kv "Existing records" "users=${existing_users:-unknown}, orders=${existing_orders:-unknown}"
                print_info "Migrations preserve and update this database; use a different --database-url for an isolated installation."
            fi

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

print_untrusted_macos_postgres_socket() {
    local socket_dir="${1:-/tmp}"
    local socket_port="${2:-5432}"

    print_error "PostgreSQL answered through ${socket_dir}:${socket_port}, but its socket is not owned by the current macOS user."
    echo "  SeqDesk will not send generated database credentials to that endpoint or modify it."
    echo "  Run the installer as the user that owns the Homebrew PostgreSQL service,"
    echo "  or provide an explicit trusted PostgreSQL DATABASE_URL and DIRECT_URL."
    print_troubleshooting_url "https://seqdesk.org/docs/installation/macos#postgresql-unix-socket-works-but-tcp-does-not"
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
    if env LC_ALL=C LANG=C "$pg_ctl_bin" -D "$data_dir" status >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

# Both the config and the HBA file are written by SeqDesk rather than patched,
# so the resulting cluster is identical on every machine and auditable in one
# place. listen_addresses='' means the server never opens a TCP socket at all.
private_postgres_write_config() {
    local data_dir="$1"
    local socket_dir="$2"

    cat >> "$data_dir/postgresql.conf" <<CONF

# --- SeqDesk-managed private instance ---
# Unix socket only: no TCP listener is opened, on any interface or port.
listen_addresses = ''
unix_socket_directories = '$socket_dir'
unix_socket_permissions = 0700
CONF
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
    env LC_ALL=C LANG=C "$pg_ctl_bin" -D "$data_dir" -l "$log_file" -w start >/dev/null 2>&1
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
    env LC_ALL=C LANG=C "$initdb_bin" \
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
    PG_PORT="5432"
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

sudo_postgres_ready() {
    local psql_bin
    psql_bin="$(find_postgres_binary psql 2>/dev/null || true)"
    if [ -z "$psql_bin" ]; then
        return 1
    fi

    PGCONNECT_TIMEOUT=5 run_as_postgres "$psql_bin" \
        -X -w \
        -h "${PG_HOST:-127.0.0.1}" \
        -p "${PG_PORT:-5432}" \
        -d postgres -qAt -c "select 1" >/dev/null 2>&1
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
            echo "  A listening port that does not speak the PostgreSQL protocol usually means"
            echo "  a VPN or endpoint-security tool is intercepting local connections."
        else
            echo "  ${configured_host}:${configured_port}     nothing is listening"
        fi
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
            print_untrusted_macos_postgres_socket "$socket_dir" "$port"
            return 1
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

ensure_local_postgres_database() {
    if ! load_postgres_url_parts; then
        return 0
    fi
    if [ -n "${MACOS_POSTGRES_SOCKET_DIR:-}" ] && \
        ! postgres_socket_owned_by_current_user "$MACOS_POSTGRES_SOCKET_DIR" "${PG_PORT:-5432}"; then
        print_untrusted_macos_postgres_socket "$MACOS_POSTGRES_SOCKET_DIR" "${PG_PORT:-5432}"
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
        if ! run_with_spinner "Local PostgreSQL database" run_as_postgres "$psql_bin" \
            -X -w -h "$PG_HOST" -p "${PG_PORT:-5432}" \
            -v ON_ERROR_STOP=1 -d postgres -f "$sql_file"; then
            rm -f "$sql_file"
            return 1
        fi
    elif ! run_with_spinner "Local PostgreSQL database" run_as_postgres "$psql_bin" \
        -X -w -v ON_ERROR_STOP=1 -d postgres -f "$sql_file"; then
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
    local label="$1" default_value="$2" reply
    while true; do
        reply=$(read_input "$label [$default_value]: ")
        reply=${reply:-$default_value}
        if is_valid_email "$reply"; then
            INTERACTIVE_RESULT="$reply"
            return 0
        fi
        print_error "  '$reply' is not a valid email address. Try again."
    done
}

interactive_prompt_password() {
    local label="$1" pw pw2
    INTERACTIVE_RESULT_GENERATED="false"
    while true; do
        pw=$(read_secret "$label (leave blank to generate a strong one): ")
        if [ -z "$pw" ]; then
            pw="$(generate_postgres_password)"
            # Deliberately not printed here. A generated password shown mid-wizard
            # scrolls away behind the rest of the install (or behind a failure
            # that means the account was never created). It is printed once at
            # the end, next to the URL it is used on.
            print_info "  A strong password was generated; it is shown when the install finishes."
            INTERACTIVE_RESULT="$pw"
            INTERACTIVE_RESULT_GENERATED="true"
            return 0
        fi
        if [ "${#pw}" -lt 8 ]; then
            print_error "  Password must be at least 8 characters. Try again."
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
    [ -z "${SEQDESK_CONFIG:-}" ] || return 1
    [ -z "${SEQDESK_PROFILE:-}" ] || return 1
    return 0
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

    print_header "Guided setup"

    # 1) Database
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
        while true; do
            url=$(read_input "  DATABASE_URL (postgresql://user:password@host:5432/dbname): ")
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
            local anyway
            anyway=$(read_input "  Use this URL anyway? (y/N): ")
            case "$anyway" in y|Y|yes|YES) break ;; *) continue ;; esac
        done
        direct=$(read_input "  DIRECT_URL for migrations (optional, blank = same as DATABASE_URL): ")
        if [ -n "$direct" ]; then
            if is_postgres_url "$direct"; then
                SEQDESK_DATABASE_DIRECT_URL="$direct"
            else
                print_warning "  Ignoring DIRECT_URL — not a postgresql:// connection string."
            fi
        fi
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

    # 2) Accounts
    print_info "Accounts — the initial users to create"
    interactive_prompt_email "  Admin email" "admin@example.com"
    SEQDESK_BOOTSTRAP_ADMIN_EMAIL="$INTERACTIVE_RESULT"
    interactive_prompt_password "  Admin password"
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD="$INTERACTIVE_RESULT"
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="$INTERACTIVE_RESULT_GENERATED"

    local make_researcher
    make_researcher=$(read_input "  Also create a researcher (non-admin) account? (Y/n): ")
    make_researcher=${make_researcher:-Y}
    case "$make_researcher" in
        n|N|no|NO)
            SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED="0"
            print_info "  Skipping the researcher account."
            ;;
        *)
            SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED="1"
            interactive_prompt_email "  Researcher email" "user@example.com"
            SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL="$INTERACTIVE_RESULT"
            interactive_prompt_password "  Researcher password"
            SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD="$INTERACTIVE_RESULT"
            SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="$INTERACTIVE_RESULT_GENERATED"
            ;;
    esac

    print_success "Guided setup captured. Continuing the installation..."
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
  --interactive                Guided setup wizard: choose the database and
                               create the admin/researcher accounts, with a
                               live database reachability check
  --verbose                    Print the diagnostic detail that normally goes
                               only to the install log
  --config <path-or-url>       Infrastructure JSON file (local path or https URL)
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
  --overwrite-existing         With -y, back up an existing install dir (<dir>.backup.<ts>) and replace it
  --version <version>          Release version (default: latest)
  --with-pipelines             Install optional Conda/Nextflow pipeline support
  --without-pipelines          Install the core app only (default)
  --skip-deps                  Deprecated (ignored in distribution installer)
  --port <port>                App port
  --data-path <path>           Sequencing data directory
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
  --reconfigure                Reconfigure an existing install in place
  --reseed-db                  Force DB push + seed (default off for --reconfigure)
  --prepare-postgres           Prepare local PostgreSQL role/database, then exit
  -h, --help                   Show this help

Pipeline environment:
  SEQDESK_EXEC_CONDA_PATH      Existing Conda base to reuse, or an unused path
                               where Miniconda may be installed. This overrides
                               PATH and standard user-prefix discovery.

Examples:
  npx -y seqdesk@latest -y
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
  "app",
  "bootstrap",
  "ena",
  "forms",
  "install",
  "modules",
  "notifications",
  "pipelines",
  "pipelineSmokeTests",
  "privatePipelines",
  "runtime",
  "seedData",
  "sequencingTech",
  "site",
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

    if ! command_exists curl; then
        print_error "curl is required to resolve hosted install profiles."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#what-the-installer-checks"
        exit 1
    fi

    local profile_url
    local profile_config
    profile_url="${SEQDESK_PROFILE_REGISTRY_URL%/}/${SEQDESK_PROFILE}/resolve"
    profile_config="$(mktemp)"

    print_info "Resolving hosted install profile: $SEQDESK_PROFILE"
    if ! curl -fsSL -H "Authorization: Bearer ${SEQDESK_PROFILE_CODE}" "$profile_url" -o "$profile_config"; then
        rm -f "$profile_config"
        print_error "Failed to resolve hosted install profile '$SEQDESK_PROFILE'. Check the profile id and access code."
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
        if ! curl -fsSL "$config_ref" -o "$temp_json"; then
            rm -f "$temp_json"
            print_error "Failed to download config: $config_ref"
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
    if ! node - "$config_path" >"$temp_env" <<'NODE'
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

function escapeShell(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

if (!isRecord(input)) {
  throw new Error("Config root must be a JSON object.");
}

const root = input;
const app = toRecord(root.app);
const install = toRecord(root.install);
const site = toRecord(root.site);
const pipelines = toRecord(root.pipelines);
const execution = toRecord(pipelines?.execution);
const conda = toRecord(execution?.conda);
const slurm = toRecord(execution?.slurm);
const runtime = toRecord(root.runtime);
const telemetry = toRecord(root.telemetry);
const notifications = toRecord(root.notifications);
const bootstrap = toRecord(root.bootstrap);
const bootstrapUsers = toRecord(bootstrap?.users);
const bootstrapAdmin = toRecord(bootstrapUsers?.admin);
const bootstrapResearcher = toRecord(bootstrapUsers?.researcher);
const forms = toRecord(root.forms);
const privatePipelines = toRecord(root.privatePipelines);
const metaxpath = toRecord(privatePipelines?.metaxpath);

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
  installDir: toOptionalString(
    firstDefined(root.installDir, root.seqdeskDir, root.dir, install?.dir, install?.installDir)
  ),
  usePm2: toOptionalBoolean(
    firstDefined(root.usePm2, root.pm2, install?.usePm2, install?.pm2)
  ),
  port: toOptionalInt(firstDefined(root.port, root.appPort, app?.port)),
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
      pipelines?.databaseDirectory
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
if (values.installDir) out.SEQDESK_CFG_DIR = values.installDir;
if (values.usePm2 !== undefined) out.SEQDESK_CFG_USE_PM2 = values.usePm2 ? "1" : "0";
if (values.port !== undefined && values.port > 0) out.SEQDESK_CFG_PORT = String(values.port);
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
if (values.orderFormSettings) {
  out.SEQDESK_CFG_ORDER_FORM_SETTINGS = values.orderFormSettings;
}
if (values.studyFormSettings) {
  out.SEQDESK_CFG_STUDY_FORM_SETTINGS = values.studyFormSettings;
}
if (values.telemetryEnabled !== undefined) {
  out.SEQDESK_CFG_TELEMETRY_ENABLED = values.telemetryEnabled ? "true" : "false";
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
    apply_config_value SEQDESK_USE_PM2 SEQDESK_CFG_USE_PM2
    apply_config_value SEQDESK_PORT SEQDESK_CFG_PORT
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
    apply_config_value SEQDESK_ORDER_FORM_SETTINGS SEQDESK_CFG_ORDER_FORM_SETTINGS
    apply_config_value SEQDESK_STUDY_FORM_SETTINGS SEQDESK_CFG_STUDY_FORM_SETTINGS
    apply_config_value SEQDESK_TELEMETRY_ENABLED SEQDESK_CFG_TELEMETRY_ENABLED
    apply_config_value SEQDESK_TELEMETRY_ENDPOINT SEQDESK_CFG_TELEMETRY_ENDPOINT
    apply_config_value SEQDESK_TELEMETRY_INTERVAL_HOURS SEQDESK_CFG_TELEMETRY_INTERVAL_HOURS
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

    unset SEQDESK_CFG_DIR SEQDESK_CFG_USE_PM2
    unset SEQDESK_CFG_PORT SEQDESK_CFG_DATA_PATH SEQDESK_CFG_RUN_DIR
    unset SEQDESK_CFG_PIPELINE_DATABASE_DIR
    unset SEQDESK_CFG_NEXTAUTH_URL SEQDESK_CFG_NEXTAUTH_SECRET
    unset SEQDESK_CFG_DATABASE_URL SEQDESK_CFG_DATABASE_DIRECT_URL SEQDESK_CFG_WITH_PIPELINES
    unset SEQDESK_CFG_ANTHROPIC_API_KEY SEQDESK_CFG_ADMIN_SECRET
    unset SEQDESK_CFG_BLOB_READ_WRITE_TOKEN
    unset SEQDESK_CFG_ORDER_FORM_SETTINGS SEQDESK_CFG_STUDY_FORM_SETTINGS
    unset SEQDESK_CFG_TELEMETRY_ENABLED SEQDESK_CFG_TELEMETRY_ENDPOINT
    unset SEQDESK_CFG_TELEMETRY_INTERVAL_HOURS
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

    apply_config_value SEQDESK_PORT SEQDESK_EXISTING_PORT
    apply_config_value SEQDESK_NEXTAUTH_URL SEQDESK_EXISTING_NEXTAUTH_URL
    apply_config_value SEQDESK_NEXTAUTH_SECRET SEQDESK_EXISTING_NEXTAUTH_SECRET
    apply_config_value SEQDESK_DATABASE_URL SEQDESK_EXISTING_DATABASE_URL
    apply_config_value SEQDESK_DATABASE_DIRECT_URL SEQDESK_EXISTING_DATABASE_DIRECT_URL
    apply_config_value SEQDESK_DATA_PATH SEQDESK_EXISTING_DATA_PATH
    apply_config_value SEQDESK_RUN_DIR SEQDESK_EXISTING_RUN_DIR
    apply_config_value SEQDESK_PIPELINE_DATABASE_DIR SEQDESK_EXISTING_PIPELINE_DATABASE_DIR
    apply_config_value SEQDESK_EXEC_CONDA_PATH SEQDESK_EXISTING_CONDA_PATH
    apply_config_value SEQDESK_WITH_PIPELINES SEQDESK_EXISTING_WITH_PIPELINES

    unset SEQDESK_EXISTING_PORT SEQDESK_EXISTING_NEXTAUTH_URL SEQDESK_EXISTING_NEXTAUTH_SECRET
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

    local line
    line=$(df -Pk "$target" 2>/dev/null | awk 'NR==2')
    if [ -z "$line" ]; then
        printf 'unknown'
        return 0
    fi

    local avail_kb
    local mount_point
    avail_kb=$(echo "$line" | awk '{print $4}')
    mount_point=$(echo "$line" | awk '{print $6}')
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

validate_or_confirm_install_target() {
    if is_truthy "$SEQDESK_RECONFIGURE" || [ ! -e "$SEQDESK_DIR" ]; then
        return 0
    fi

    if is_truthy "$SEQDESK_OVERWRITE_EXISTING"; then
        print_warning "Target path already exists and will be backed up before replacement: $SEQDESK_DIR"
        return 0
    fi

    if is_truthy "$SEQDESK_YES"; then
        print_error "Target path $SEQDESK_DIR already exists. Choose a new --dir, use --reconfigure for an installed instance, or pass --overwrite-existing to back it up and replace it."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-target-exists-is-not-writable-or-has-too-little-space"
        exit 1
    fi

    print_warning "Target path already exists: $SEQDESK_DIR"
    local response
    response=$(read_input "Backup and replace? (y/N): ")
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi
    SEQDESK_OVERWRITE_EXISTING="1"
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
    local config_status="will create"
    local config_name="settings.json"
    for f in settings.json seqdesk.config.json; do
        if [ -f "$f" ]; then
            config_name="$f"
            config_status="exists (will update)"
            break
        fi
    done

    local pipeline_label="disabled"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        pipeline_label="enabled"
    fi

    print_header "Configuration summary"
    print_kv "Pipelines" "$pipeline_label"
    print_kv "Data path" "${SEQDESK_DATA_PATH:-configure later in Admin > Data Storage}"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        print_kv "Run directory" "${SEQDESK_RUN_DIR:-configure later in Admin > Pipeline Runtime}"
        if [ -n "${SEQDESK_PIPELINE_DATABASE_DIR:-}" ]; then
            print_kv "Pipeline DB directory" "$SEQDESK_PIPELINE_DATABASE_DIR"
        fi
    else
        print_kv "Run directory" "not used"
    fi
    print_kv "Port" "${SEQDESK_PORT:-8000}"
    print_kv "NEXTAUTH_URL" "${SEQDESK_NEXTAUTH_URL:-http://localhost:${SEQDESK_PORT:-8000}}"
    if [ -n "${SEQDESK_DATABASE_URL:-}" ]; then
        print_kv "DATABASE_URL" "$(redact_database_url "$SEQDESK_DATABASE_URL")"
    elif [ -n "${MACOS_POSTGRES_SOCKET_DIR:-}" ]; then
        print_kv "DATABASE_URL" "generated local URL via Unix socket ${MACOS_POSTGRES_SOCKET_DIR}:5432"
    else
        print_kv "DATABASE_URL" "default local PostgreSQL URL"
    fi
    if [ -n "${SEQDESK_DATABASE_DIRECT_URL:-}" ] && [ "$SEQDESK_DATABASE_DIRECT_URL" != "$SEQDESK_DATABASE_URL" ]; then
        print_kv "DIRECT_URL" "$(redact_database_url "$SEQDESK_DATABASE_DIRECT_URL")"
    fi
    if [ -n "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
        print_kv "Admin account" "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL"
    fi
    if [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" ]; then
        print_kv "Researcher account" "$SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL"
    fi
    print_kv "$config_name" "$config_status"
}

confirm_config() {
    if is_truthy "$SEQDESK_YES"; then
        return 0
    fi
    local reply
    reply=$(read_input "Continue with these settings? (Y/n): ")
    reply=${reply:-Y}
    case "$reply" in
        n|N|no|NO)
            print_error "Installation cancelled."
            exit 1
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
    local id="" id_like=""
    id=$(grep -E '^ID=' "$osr" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"' | tr '[:upper:]' '[:lower:]')
    id_like=$(grep -E '^ID_LIKE=' "$osr" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"' | tr '[:upper:]' '[:lower:]')
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
    if ! LC_ALL=C LANG=C "$SEQDESK_PG_CTL" -D "$SEQDESK_PG_DATA" status >/dev/null 2>&1; then
        if ! LC_ALL=C LANG=C "$SEQDESK_PG_CTL" -D "$SEQDESK_PG_DATA" \
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
        --token "${SEQDESK_METAXPATH_KEY}"
        --dir "$(pwd)"
    )
    if [ -n "${SEQDESK_METAXPATH_SHA256:-}" ]; then
        metaxpath_args+=(--sha256 "${SEQDESK_METAXPATH_SHA256}")
    fi

    if ! run_with_spinner "Private MetaxPath pipeline package" ./scripts/install-private-metaxpath.sh "${metaxpath_args[@]}"; then
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
    SEQDESK_INSTALL_RUN_DIR="$run_dir" \
    SEQDESK_INSTALL_PIPELINE_DATABASE_DIR="${SEQDESK_PIPELINE_DATABASE_DIR:-}" \
    SEQDESK_INSTALL_PIPELINES_ENABLED="$pipelines_enabled" \
    SEQDESK_INSTALL_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}" \
    SEQDESK_INSTALL_NEXTAUTH_SECRET="${SEQDESK_NEXTAUTH_SECRET:-}" \
    SEQDESK_INSTALL_DATABASE_URL="${SEQDESK_DATABASE_URL:-}" \
    SEQDESK_INSTALL_DATABASE_DIRECT_URL="${SEQDESK_DATABASE_DIRECT_URL:-}" \
    SEQDESK_INSTALL_ANTHROPIC_API_KEY="${SEQDESK_ANTHROPIC_API_KEY:-}" \
    SEQDESK_INSTALL_ADMIN_SECRET="${SEQDESK_ADMIN_SECRET:-}" \
    SEQDESK_INSTALL_BLOB_READ_WRITE_TOKEN="${SEQDESK_BLOB_READ_WRITE_TOKEN:-}" \
    SEQDESK_INSTALL_TELEMETRY_ENABLED="${SEQDESK_TELEMETRY_ENABLED:-}" \
    SEQDESK_INSTALL_TELEMETRY_ENDPOINT="${SEQDESK_TELEMETRY_ENDPOINT:-}" \
    SEQDESK_INSTALL_TELEMETRY_INTERVAL_HOURS="${SEQDESK_TELEMETRY_INTERVAL_HOURS:-}" \
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
const runDir = process.env.SEQDESK_INSTALL_RUN_DIR || '';
const pipelineDatabaseDir = process.env.SEQDESK_INSTALL_PIPELINE_DATABASE_DIR || '';
const pipelinesEnabled = process.env.SEQDESK_INSTALL_PIPELINES_ENABLED || '';
const nextAuthUrl = process.env.SEQDESK_INSTALL_NEXTAUTH_URL || '';
const nextAuthSecret = process.env.SEQDESK_INSTALL_NEXTAUTH_SECRET || '';
const databaseUrl = process.env.SEQDESK_INSTALL_DATABASE_URL || '';
const directUrl = process.env.SEQDESK_INSTALL_DATABASE_DIRECT_URL || '';
const anthropicApiKey = process.env.SEQDESK_INSTALL_ANTHROPIC_API_KEY || '';
const adminSecret = process.env.SEQDESK_INSTALL_ADMIN_SECRET || '';
const blobReadWriteToken = process.env.SEQDESK_INSTALL_BLOB_READ_WRITE_TOKEN || '';
const telemetryEnabledRaw = process.env.SEQDESK_INSTALL_TELEMETRY_ENABLED || '';
const telemetryEndpoint = process.env.SEQDESK_INSTALL_TELEMETRY_ENDPOINT || '';
const telemetryIntervalHoursRaw = process.env.SEQDESK_INSTALL_TELEMETRY_INTERVAL_HOURS || '';
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

const installProfile = buildInstallProfileConfig(profileConfigFile);
if (installProfile) {
  config.installProfile = installProfile;
}

config.site = config.site || {};
if (dataPath) config.site.dataBasePath = dataPath;

config.pipelines = config.pipelines || {};
if (pipelinesEnabled) config.pipelines.enabled = pipelinesEnabled === 'true';
if (pipelineDatabaseDir) config.pipelines.databaseDirectory = pipelineDatabaseDir;

if (runDir) {
  config.pipelines.execution = config.pipelines.execution || {};
  if (!config.pipelines.execution.mode) config.pipelines.execution.mode = 'local';
  config.pipelines.execution.runDirectory = runDir;
}

const appPort = toOptionalPort(appPortRaw);
if (appPort !== undefined) {
  config.app = config.app && typeof config.app === 'object' ? config.app : {};
  config.app.port = appPort;
}

const runtime = config.runtime && typeof config.runtime === 'object' ? config.runtime : {};
if (nextAuthUrl) runtime.nextAuthUrl = nextAuthUrl;
if (databaseUrl) runtime.databaseUrl = databaseUrl;
if (directUrl) runtime.directUrl = directUrl;
if (nextAuthSecret) runtime.nextAuthSecret = nextAuthSecret;
if (anthropicApiKey) runtime.anthropicApiKey = anthropicApiKey;
if (adminSecret) runtime.adminSecret = adminSecret;
if (blobReadWriteToken) runtime.blobReadWriteToken = blobReadWriteToken;
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
if (adminBootstrap || researcherBootstrap || researcherEnabled === false) {
  config.bootstrap = config.bootstrap && typeof config.bootstrap === 'object' ? config.bootstrap : {};
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

on_error() {
    local exit_code=$?
    local failed_at
    local elapsed
    set +e
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

    echo ""
    print_error "Install failed after $(format_elapsed "$elapsed")."
    print_info "Command: ${BASH_COMMAND}"
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

# Test hook: when sourced with SEQDESK_INSTALL_LIB_ONLY=1, load the function
# and variable definitions above but do NOT run the installer. Lets the wizard
# and other helpers be unit-tested in isolation (scripts/ci/test-interactive-wizard.sh).
if [ -n "${SEQDESK_INSTALL_LIB_ONLY:-}" ]; then
    return 0 2>/dev/null || exit 0
fi

parse_args "$@"

trap on_error ERR

configure_install_log

if [ -z "$SEQDESK_YES" ] && [ ! -t 0 ] && [ ! -t 1 ]; then
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

if is_truthy "$SEQDESK_RECONFIGURE" && [ ! -d "$SEQDESK_DIR" ]; then
    print_error "Reconfigure mode requires an existing installation directory: $SEQDESK_DIR"
    print_troubleshooting_url "https://seqdesk.org/docs/installation/quickstart#the-target-exists-is-not-writable-or-has-too-little-space"
    exit 1
fi

if { is_truthy "$SEQDESK_RECONFIGURE" || is_truthy "$SEQDESK_PREPARE_POSTGRES"; } && [ -d "$SEQDESK_DIR" ]; then
    if is_truthy "$SEQDESK_RECONFIGURE"; then
        print_info "Reconfigure mode: loading defaults from existing installation"
    elif is_truthy "$SEQDESK_PREPARE_POSTGRES"; then
        print_info "PostgreSQL setup mode: loading defaults from existing installation"
    fi
    load_existing_install_values "$SEQDESK_DIR"
fi

if is_truthy "$SEQDESK_PREPARE_POSTGRES"; then
    prepare_postgres_and_exit
fi

# Reject or confirm an existing fresh-install target before asking wizard
# questions, installing Conda, or downloading the release package.
validate_or_confirm_install_target

resolve_conda_runtime

# Guided setup wizard (opt-in via --interactive), first half. Runs after
# dependency checks so Node is available for the database reachability test.
# Only the database question is asked here, because the answer decides what the
# preflight below has to do.
run_interactive_wizard_database

# On macOS, provision or validate the selected local PostgreSQL server before
# downloading the release or creating the install directory. A clean reviewer
# machine gets a working PostgreSQL either way: a healthy local server is reused
# untouched, and otherwise SeqDesk creates its own socket-only instance under
# SEQDESK_PG_HOME. Managed/remote database URLs are untouched.
#
# This deliberately runs before the account prompts: everything that can fail
# without the user having entered anything should fail first.
if ! preflight_local_postgres; then
    exit 1
fi

# Second half of the wizard: the account details and generated credentials,
# asked only once the database they will be created in is known to work.
run_interactive_wizard_accounts

# Pipeline support
print_step "Configure pipeline support"

resolve_pipeline_enablement

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

print_preflight_summary

if [ "$PIPELINES_ENABLED" = "true" ] && {
    [ "$CONDA_RESOLUTION" = "invalid-configured" ] ||
    [ "$CONDA_RESOLUTION" = "invalid-defaults" ];
}; then
    print_unusable_conda_prefix_error
    exit 1
fi

if [ "$PIPELINES_ENABLED" = "true" ] && [ "$HAS_CONDA" != "true" ]; then
    print_header "Install Miniconda"

    if ! CONDA_INSTALLER=$(select_miniconda_installer "$OS" "$ARCH"); then
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
        curl -fsSL "https://repo.anaconda.com/miniconda/$CONDA_INSTALLER" \
        -o "$MINICONDA_INSTALLER_FILE"

    install_miniconda_with_diagnostics "$MINICONDA_INSTALLER_FILE" "$CONDA_INSTALL_BASE"

    CONDA_INIT_BIN=""
    CONDA_INIT_BIN="$(find_usable_conda_in_prefix "$CONDA_INSTALL_BASE" || true)"
    if [ -z "$CONDA_INIT_BIN" ]; then
        print_error "Miniconda install completed but conda binary was not found under $CONDA_INSTALL_BASE."
        print_troubleshooting_url "https://seqdesk.org/docs/installation/prerequisites#optional-pipeline-prerequisites"
        exit 1
    fi

    CURRENT_SHELL="$(basename "${SHELL:-}")"
    INIT_SHELLS=()
    case "$CURRENT_SHELL" in
        bash|zsh) INIT_SHELLS+=("$CURRENT_SHELL") ;;
    esac
    for default_shell in bash zsh; do
        already_added="false"
        for init_shell in "${INIT_SHELLS[@]}"; do
            if [ "$init_shell" = "$default_shell" ]; then
                already_added="true"
                break
            fi
        done
        if [ "$already_added" != "true" ]; then
            INIT_SHELLS+=("$default_shell")
        fi
    done
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
TEMP_FILE=""
# Ensure the downloaded release tarball never leaks if a later step (backup mv,
# extraction) fails; TEMP_FILE is "" until mktemp runs, so this is a no-op early.
trap 'rm -f "$TEMP_FILE"' EXIT
if is_truthy "$SEQDESK_RECONFIGURE"; then
    print_info "Reconfigure mode enabled; skipping release download."
else
    if [ -n "$SEQDESK_VERSION" ]; then
        VERSION_INFO=$(curl -fsSL "$SEQDESK_API/version?version=$SEQDESK_VERSION" 2>/dev/null || true)
    else
        VERSION_INFO=$(curl -fsSL "$SEQDESK_API/version" 2>/dev/null || true)
    fi

    if [ -z "$VERSION_INFO" ]; then
        print_error "Could not connect to SeqDesk server"
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

    TEMP_FILE=$(mktemp)

    if [ -n "$FILE_SIZE" ] && [ "$FILE_SIZE" -gt 0 ]; then
        SIZE_MB=$((FILE_SIZE / 1024 / 1024))
        print_info "File size: ${SIZE_MB}MB"
    fi

    # GATING preflight: fail fast before downloading/backing up/extracting if
    # the target is not writable or free disk is below max(3x tarball, 2GB).
    gating_preflight "${FILE_SIZE:-0}"

    run_with_spinner "Release package download" curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_FILE"

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
            print_success "Checksum verified"
        else
            print_error "Checksum mismatch"
            print_error "Expected: $CHECKSUM"
            print_error "Got:      $ACTUAL_CHECKSUM"
            rm -f "$TEMP_FILE"
            print_troubleshooting_url
            exit 1
        fi
    fi
fi

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
else
    if [ -e "$SEQDESK_DIR" ]; then
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
        print_success "Moved existing install to $existing_backup_path"
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

# Install runtime dependencies
print_step "Install runtime Node dependencies"
install_runtime_node_modules

# Configure environment
print_step "Configure environment"

wizard_status=1
if run_wizard; then
    wizard_status=0
else
    wizard_status=$?
fi
if [ $wizard_status -eq 2 ]; then
    print_error "Installation cancelled"
    exit 1
elif [ $wizard_status -ne 0 ]; then
    prompt_value SEQDESK_PORT "App port" "8000"
fi

if [ -z "$SEQDESK_PORT" ]; then
    SEQDESK_PORT="8000"
fi
if [ -z "$SEQDESK_NEXTAUTH_URL" ]; then
    SEQDESK_NEXTAUTH_URL="http://localhost:${SEQDESK_PORT}"
fi

print_config_summary
confirm_config

configure_postgres_urls

if [ -z "$SEQDESK_NEXTAUTH_SECRET" ]; then
    SEQDESK_NEXTAUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    print_info "Generated runtime.nextAuthSecret for the runtime config"
fi

write_config "$PIPELINES_ENABLED" "$SEQDESK_DATA_PATH" "$SEQDESK_RUN_DIR"
clear_bootstrap_plaintext_passwords
export DATABASE_URL="$SEQDESK_DATABASE_URL"
export DIRECT_URL="$SEQDESK_DATABASE_DIRECT_URL"
export SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED

# Initialize database
SEED_OK="false"
DB_INIT_SKIPPED="false"
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
    ensure_seed_dependency "bcryptjs" || true
    if run_with_spinner_warn "Seed initial data" npm run db:seed; then
        SEED_OK="true"

# Materialize the storage directories captured during configuration. The config
# and DB infrastructure record now point at these paths, but only the default
# $SEQDESK_DIR/data is created above (sync_release_shared_paths) -- an explicitly
# provided --data-path/--run-dir override is never created. Create any provided
# directory so the app does not reference a path that is missing on disk.
# Warn-only: a privileged or network mount may need manual creation and must not
# abort an otherwise successful install.
for storage_dir in "$SEQDESK_DATA_PATH" "$SEQDESK_RUN_DIR"; do
    [ -n "$storage_dir" ] || continue
    [ -d "$storage_dir" ] && continue
    if mkdir -p "$storage_dir" 2>/dev/null; then
        print_success "Created directory: $storage_dir"
    else
        print_warning "Could not create $storage_dir -- create it manually before use"
    fi
done

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
fi

if [ "$DB_INIT_SKIPPED" = "true" ]; then
    print_info "Database unchanged."
elif [ "$SEED_OK" = "true" ]; then
    print_success "Database initialized"
    if is_truthy "$SEQDESK_RECONFIGURE"; then
        print_info "Reconfigure mode: existing user accounts were kept."
    elif [ -n "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH:-}" ] || [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
        print_info "Bootstrap account configuration applied."
        if [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
            print_info "Researcher account not created."
        fi
    else
        print_info "Default users available: admin@example.com/admin and user@example.com/user"
    fi
else
    print_info "Seed did not complete during install -- the app will auto-seed on first launch"
    if ! is_truthy "$SEQDESK_RECONFIGURE"; then
        print_info "Default users after first launch: admin@example.com/admin and user@example.com/user"
    fi
fi

if [ -n "$SEQDESK_PROFILE_CONFIG_FILE" ]; then
    if [ ! -f "scripts/apply-install-profile.mjs" ]; then
        print_error "Missing scripts/apply-install-profile.mjs; cannot apply hosted install profile."
        exit 1
    fi

    if ! run_with_spinner "Hosted install profile settings" node scripts/apply-install-profile.mjs --profile-config "$SEQDESK_PROFILE_CONFIG_FILE"; then
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

if [ -z "$SEQDESK_USE_PM2" ]; then
    if is_truthy "$SEQDESK_RECONFIGURE"; then
        if resolve_pm2_bin && pm2_exec describe seqdesk >/dev/null 2>&1; then
            PM2_PROCESS_EXISTS="true"
            SEQDESK_USE_PM2="1"
            print_info "Detected existing PM2 process 'seqdesk'; it will be restarted."
        else
            SEQDESK_USE_PM2="0"
            print_info "Reconfigure mode: PM2 not detected, skipping process manager changes."
        fi
    else
        prompt_yes_no SEQDESK_USE_PM2 "Start SeqDesk with PM2 for auto-restart? (recommended)" "y"
    fi
fi

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
            if run_with_spinner_warn "Restart SeqDesk PM2 process" pm2_exec restart seqdesk; then
                PM2_CONFIGURED="true"
                pm2_exec save >/dev/null 2>&1 || print_warning "Could not save PM2 process list (run: $PM2_DISPLAY_CMD save)"
            else
                print_warning "PM2 failed to restart seqdesk. You can restart manually with: $PM2_DISPLAY_CMD restart seqdesk"
            fi
        else
            if run_with_spinner_warn "Start SeqDesk with PM2" pm2_exec start "$SEQDESK_DIR/start.sh" --name seqdesk; then
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
fi
print_kv "Directory" "$SEQDESK_DIR"
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
if [ -n "$SEQDESK_DATA_PATH" ]; then
    print_kv "Data path" "$SEQDESK_DATA_PATH"
fi
if [ -n "$SEQDESK_RUN_DIR" ] && [ "$PIPELINES_ENABLED" = "true" ]; then
    print_kv "Run directory" "$SEQDESK_RUN_DIR"
fi
if [ -n "$SEQDESK_PIPELINE_DATABASE_DIR" ] && [ "$PIPELINES_ENABLED" = "true" ]; then
    print_kv "Pipeline DB directory" "$SEQDESK_PIPELINE_DATABASE_DIR"
fi
for f in settings.json seqdesk.config.json; do
    if [ -f "$SEQDESK_DIR/$f" ]; then
        print_kv "Config" "$SEQDESK_DIR/$f"
        break
    fi
done
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
    printf '  %bcd %s%b\n' "$CYAN" "$SEQDESK_DIR" "$NC"
    printf '  %b./start.sh%b\n' "$CYAN" "$NC"
    echo ""
    echo "  Manual start will not auto-restart after updates."
fi

print_header "Login"

if is_truthy "$SEQDESK_RECONFIGURE"; then
    echo "  Existing user accounts are unchanged (reconfigure mode)."
elif [ -n "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD:-}" ] || [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH:-}" ] || [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
    # A password the installer generated is shown exactly once, here, next to the
    # URL it is used on — and via print_secret_kv, so it is not written to the
    # install log. A password the operator chose is never echoed back.
    if [ "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED:-false}" = "true" ]; then
        print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}"
        print_secret_kv "Admin password" "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD}"
    else
        print_kv "Admin" "${SEQDESK_BOOTSTRAP_ADMIN_EMAIL:-admin@example.com} / configured profile password"
    fi
    if [ "${SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED:-}" = "0" ]; then
        print_kv "Researcher" "not created"
    elif [ -n "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL:-}" ]; then
        if [ "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED:-false}" = "true" ]; then
            print_kv "Researcher" "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL}"
            print_secret_kv "Researcher password" "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD}"
        else
            print_kv "Researcher" "${SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL} / configured profile password"
        fi
    else
        print_kv "Researcher" "user@example.com / user (default; change after first login)"
    fi
    if [ "${SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED:-false}" = "true" ] || \
        [ "${SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED:-false}" = "true" ]; then
        echo "  Save the generated passwords now — they are not stored anywhere else."
    fi
else
    print_kv "Admin" "admin@example.com / admin"
    print_kv "Researcher" "user@example.com / user"
    echo "  Change the default admin password immediately after first login."
fi

print_header "Diagnose"

if command_exists seqdesk; then
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
    print_kv "Install CLI" "npm install -g seqdesk"
    echo "  Then run:"
    print_doctor_command
fi

print_header "Next steps"

echo "  1. Log in as admin and configure Data Storage in Admin > Data Storage"
echo "  2. Configure pipeline runtime under Admin > Pipeline Runtime (if enabled)"
echo "  3. Use the Browser URL for login. Use the Local health URL for curl/doctor checks."
echo ""
