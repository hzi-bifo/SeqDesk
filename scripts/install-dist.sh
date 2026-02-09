#!/bin/bash
#
# SeqDesk Installation Script (Distribution)
# https://seqdesk.com
#
# Usage: curl -fsSL https://seqdesk.com/install.sh | bash
#
# Options (environment variables):
#   SEQDESK_DIR=/path/to/install   - Installation directory (default: ./seqdesk)
#   SEQDESK_VERSION=x.x.x          - Specific version (default: latest)
#   SEQDESK_WITH_PIPELINES=1       - Install pipeline dependencies (Conda + Nextflow)
#   SEQDESK_WITH_CONDA=1           - Legacy: install Miniconda + pipeline env
#   SEQDESK_SKIP_DEPS=1            - Skip dependency install (Node)
#   SEQDESK_YES=1                  - Non-interactive; accept defaults
#   SEQDESK_DATA_PATH=/data        - Sequencing data base path
#   SEQDESK_RUN_DIR=/data/runs     - Pipeline run directory
#   SEQDESK_PORT=3000              - App port (default: 3000)
#   SEQDESK_NEXTAUTH_URL=https://  - Optional NextAuth URL
#   SEQDESK_DATABASE_URL=postgres  - Optional database URL
#   SEQDESK_LOG=/path/install.log  - Optional install log path
#   SEQDESK_USE_PM2=1             - Start with PM2 for auto-restart (recommended)
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Config
SEQDESK_DIR="${SEQDESK_DIR:-./seqdesk}"
SEQDESK_VERSION="${SEQDESK_VERSION:-}"
SEQDESK_API="https://seqdesk.com/api"
SEQDESK_WITH_PIPELINES="${SEQDESK_WITH_PIPELINES:-}"
SEQDESK_WITH_CONDA="${SEQDESK_WITH_CONDA:-}"
SEQDESK_SKIP_DEPS="${SEQDESK_SKIP_DEPS:-}"
SEQDESK_YES="${SEQDESK_YES:-}"
SEQDESK_DATA_PATH="${SEQDESK_DATA_PATH:-}"
SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-}"
SEQDESK_PORT="${SEQDESK_PORT:-}"
SEQDESK_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}"
SEQDESK_DATABASE_URL="${SEQDESK_DATABASE_URL:-}"
SEQDESK_LOG="${SEQDESK_LOG:-}"
SEQDESK_USE_PM2="${SEQDESK_USE_PM2:-}"

PM2_CONFIGURED="false"

MIN_NODE_VERSION=18
INSTALL_START_TS=$(date +%s)
INSTALL_STARTED_AT=$(date '+%Y-%m-%d %H:%M:%S %Z')
TOTAL_STEPS=8
CURRENT_STEP=0

print_header() {
    echo ""
    echo -e "${BLUE}======================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}======================================${NC}"
    echo ""
}

print_step() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    print_header "Step ${CURRENT_STEP}/${TOTAL_STEPS}: $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

is_truthy() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|y|Y) return 0 ;;
        *) return 1 ;;
    esac
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

prompt_optional() {
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

print_kv() {
    printf "  %-24s %s\n" "$1" "$2"
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

SEQDESK_DIR="${SEQDESK_DIR/#\~/$HOME}"
SEQDESK_DIR="$(resolve_absolute_dir "$SEQDESK_DIR")"

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

print_preflight_summary() {
    local target_status="new"
    if [ -d "$SEQDESK_DIR" ]; then
        target_status="exists"
    fi

    local writable="no"
    if is_writable_target "$SEQDESK_DIR"; then
        writable="${GREEN}yes${NC}"
    else
        writable="${RED}no${NC}"
    fi

    local parent_dir
    parent_dir="$(resolve_parent_dir "$SEQDESK_DIR")"

    local conda_status="${YELLOW}not found${NC}"
    if command_exists conda; then
        conda_status="${GREEN}found${NC}"
    fi

    local nextflow_status="${YELLOW}not found${NC}"
    if command_exists nextflow; then
        nextflow_status="${GREEN}found${NC}"
    fi

    local pipelines_status="pending"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        pipelines_status="enabled"
    elif [ "$PIPELINES_ENABLED" = "false" ]; then
        pipelines_status="disabled"
    fi

    print_header "Preflight Summary"
    print_kv "Target directory" "$SEQDESK_DIR ($target_status)"
    print_kv "Writable" "$writable"
    print_kv "Disk available" "$(get_disk_info "$parent_dir")"
    print_kv "Node.js" "v$NODE_VERSION"
    print_kv "npm" "$NPM_VERSION"
    print_kv "Conda" "$conda_status"
    print_kv "Nextflow" "$nextflow_status"
    print_kv "Pipelines" "$pipelines_status"
}

print_config_summary() {
    local env_status="will create"
    local config_status="will create"
    if [ -f ".env" ]; then
        env_status="exists (will update)"
    fi
    if [ -f "seqdesk.config.json" ]; then
        config_status="exists (will update)"
    fi

    local pipeline_label="disabled"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        pipeline_label="enabled"
    fi

    print_header "Configuration Summary"
    print_kv "Pipelines" "$pipeline_label"
    print_kv "Data path" "${SEQDESK_DATA_PATH:-./data}"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        print_kv "Run directory" "${SEQDESK_RUN_DIR:-./pipeline_runs}"
    else
        print_kv "Run directory" "not used"
    fi
    print_kv "Port" "${SEQDESK_PORT:-3000}"
    print_kv "NEXTAUTH_URL" "${SEQDESK_NEXTAUTH_URL:-<not set>}"
    print_kv "DATABASE_URL" "${SEQDESK_DATABASE_URL:-<not set>}"
    print_kv ".env" "$env_status"
    print_kv "seqdesk.config.json" "$config_status"
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

install_node() {
    print_info "Installing Node.js 20..."
    if [[ "$OS" == "macos" ]]; then
        if command_exists brew; then
            brew install node
        else
            print_error "Homebrew not found. Install Node.js manually: https://nodejs.org"
            exit 1
        fi
        return 0
    fi

    if [ "$EUID" -ne 0 ] && ! command_exists sudo; then
        print_error "sudo is required to install Node.js. Install it manually: https://nodejs.org"
        exit 1
    fi

    if [[ "$DISTRO" == "debian" ]]; then
        if [ "$EUID" -eq 0 ]; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
            apt-get install -y nodejs
        else
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        fi
    elif [[ "$DISTRO" == "redhat" ]]; then
        if [ "$EUID" -eq 0 ]; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
            if command_exists dnf; then
                dnf install -y nodejs
            else
                yum install -y nodejs
            fi
        else
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            if command_exists dnf; then
                sudo dnf install -y nodejs
            else
                sudo yum install -y nodejs
            fi
        fi
    else
        print_error "Unsupported distro for auto-install. Install Node.js manually: https://nodejs.org"
        exit 1
    fi
}

sed_inplace() {
    local expr="$1"
    local file="$2"
    if [[ "${OS:-}" == "macos" ]]; then
        sed -i '' "$expr" "$file"
    else
        sed -i "$expr" "$file"
    fi
}

run_wizard() {
    if ! command_exists node; then
        return 1
    fi
    if [ ! -f scripts/install-wizard.mjs ]; then
        return 1
    fi
    if [ -z "$SEQDESK_YES" ] && [ ! -t 0 ]; then
        return 1
    fi
    local wizard_out
    wizard_out=$(mktemp)
    SEQDESK_WIZARD_OUT="$wizard_out" \
    SEQDESK_WIZARD_PIPELINES_ENABLED="$PIPELINES_ENABLED" \
    SEQDESK_WIZARD_DEFAULT_DATA_PATH="${SEQDESK_DATA_PATH:-./data}" \
    SEQDESK_WIZARD_DEFAULT_RUN_DIR="${SEQDESK_RUN_DIR:-./pipeline_runs}" \
    SEQDESK_WIZARD_DEFAULT_PORT="${SEQDESK_PORT:-3000}" \
    SEQDESK_YES="${SEQDESK_YES:-}" \
    SEQDESK_DATA_PATH="${SEQDESK_DATA_PATH:-}" \
    SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-}" \
    SEQDESK_PORT="${SEQDESK_PORT:-}" \
    SEQDESK_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}" \
    SEQDESK_DATABASE_URL="${SEQDESK_DATABASE_URL:-}" \
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

set_env_var() {
    local key="$1"
    local value="$2"
    if [ -z "$value" ]; then
        return 0
    fi

    if grep -q "^${key}=" .env; then
        sed_inplace "s|^${key}=.*|${key}=\"${value}\"|" .env
    else
        echo "${key}=\"${value}\"" >> .env
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
    SEQDESK_INSTALL_PIPELINES_ENABLED="$pipelines_enabled" \
    node <<'NODE'
const fs = require('fs');

const dataPath = process.env.SEQDESK_INSTALL_DATA_PATH || '';
const runDir = process.env.SEQDESK_INSTALL_RUN_DIR || '';
const pipelinesEnabled = process.env.SEQDESK_INSTALL_PIPELINES_ENABLED || '';

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`ERROR: Failed to parse ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

const config = readJson('seqdesk.config.json') || readJson('seqdesk.config.example.json') || {};

config.site = config.site || {};
if (dataPath) config.site.dataBasePath = dataPath;

config.pipelines = config.pipelines || {};
if (pipelinesEnabled) config.pipelines.enabled = pipelinesEnabled === 'true';

if (runDir) {
  config.pipelines.execution = config.pipelines.execution || {};
  if (!config.pipelines.execution.mode) config.pipelines.execution.mode = 'local';
  config.pipelines.execution.runDirectory = runDir;
}

fs.writeFileSync('seqdesk.config.json', JSON.stringify(config, null, 2));
console.log('Wrote seqdesk.config.json');
NODE
}

on_error() {
    local exit_code=$?
    set +e
    echo ""
    print_error "Installer failed."
    print_info "Command: ${BASH_COMMAND}"
    print_info "Exit code: ${exit_code}"
    if [ -n "$SEQDESK_LOG" ]; then
        print_info "Log: $SEQDESK_LOG"
    else
        print_info "Tip: re-run with SEQDESK_LOG=/tmp/seqdesk-install.log"
    fi
    print_info "Common fixes: check network access, sudo permissions, and disk space."
    exit $exit_code
}

trap on_error ERR

if [ -n "$SEQDESK_LOG" ]; then
    mkdir -p "$(dirname "$SEQDESK_LOG")" 2>/dev/null || true
    exec > >(tee -a "$SEQDESK_LOG") 2>&1
fi

if [ -z "$SEQDESK_YES" ] && [ ! -e /dev/tty ]; then
    print_error "No TTY available. Set SEQDESK_YES=1 for non-interactive installs."
    exit 1
fi

# Banner
echo ""
echo -e "${BLUE}"
echo "  ____             ____            _    "
echo " / ___|  ___  __ _|  _ \\  ___  ___| | __"
echo " \\___ \\ / _ \\/ _\` | | | |/ _ \\/ __| |/ /"
echo "  ___) |  __/ (_| | |_| |  __/\\__ \\   < "
echo " |____/ \\___|\\__, |____/ \\___||___/_|\\_\\"
echo "                |_|                      "
echo -e "${NC}"
echo ""
echo "SeqDesk Installer (Distribution)"
echo "Requested version: ${SEQDESK_VERSION:-latest}"
echo "Started: ${INSTALL_STARTED_AT}"
echo ""

# System detection
print_step "Detecting system"

OS="unknown"
ARCH=$(uname -m)
DISTRO="unknown"

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    if [ -f /etc/debian_version ]; then
        DISTRO="debian"
    elif [ -f /etc/redhat-release ]; then
        DISTRO="redhat"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    DISTRO="macos"
else
    print_error "Unsupported operating system: $OSTYPE"
    exit 1
fi

print_success "OS: $OS ($DISTRO)"
print_success "Architecture: $ARCH"

# Dependencies
print_step "Checking dependencies"

node_install_reason=""
if ! command_exists node; then
    node_install_reason="missing"
else
    NODE_VERSION=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -lt "$MIN_NODE_VERSION" ]; then
        node_install_reason="outdated"
    fi
fi

if [ -n "$node_install_reason" ]; then
    if is_truthy "$SEQDESK_SKIP_DEPS"; then
        print_error "Node.js $MIN_NODE_VERSION+ is required but not installed."
        print_error "Install Node.js from https://nodejs.org and re-run the installer."
        exit 1
    fi

    if is_truthy "$SEQDESK_YES"; then
        install_node
    else
        if [ "$node_install_reason" = "missing" ]; then
            prompt_yes_no INSTALL_NODE "Node.js not found. Install Node.js 20 now? (requires sudo)" "y"
        else
            prompt_yes_no INSTALL_NODE "Node.js is too old. Upgrade to Node.js 20 now? (requires sudo)" "y"
        fi
        if [ "$INSTALL_NODE" = "true" ]; then
            install_node
        else
            print_error "Node.js $MIN_NODE_VERSION+ is required to continue."
            exit 1
        fi
    fi
fi

if ! command_exists node; then
    print_error "Node.js installation failed or is not on PATH."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt "$MIN_NODE_VERSION" ]; then
    print_error "Node.js ${MIN_NODE_VERSION}+ is required (found v$NODE_VERSION)"
    exit 1
fi
print_success "Node.js $NODE_VERSION"

if ! command_exists npm; then
    print_error "npm is required but not installed."
    exit 1
fi
NPM_VERSION=$(npm -v)
print_success "npm $NPM_VERSION"

# Pipeline support
print_step "Pipeline support"

PIPELINES_ENABLED=""
if is_truthy "$SEQDESK_WITH_PIPELINES" || is_truthy "$SEQDESK_WITH_CONDA"; then
    PIPELINES_ENABLED="true"
fi

if [ -z "$PIPELINES_ENABLED" ]; then
    if command_exists conda; then
        prompt_yes_no PIPELINES_ENABLED "Enable pipeline support (Conda + Nextflow)?" "y"
    else
        prompt_yes_no PIPELINES_ENABLED "Install pipeline dependencies (Conda + Nextflow)?" "y"
    fi
fi

if [ "$PIPELINES_ENABLED" = "true" ]; then
    print_info "Pipeline support enabled"
else
    print_info "Pipeline support disabled"
fi

print_preflight_summary

if [ "$PIPELINES_ENABLED" = "true" ] && ! command_exists conda; then
    print_header "Installing Miniconda"

    CONDA_INSTALLER="Miniconda3-latest-Linux-x86_64.sh"
    if [[ "$OS" == "macos" ]]; then
        if [[ "$ARCH" == "arm64" ]]; then
            CONDA_INSTALLER="Miniconda3-latest-MacOSX-arm64.sh"
        else
            CONDA_INSTALLER="Miniconda3-latest-MacOSX-x86_64.sh"
        fi
    fi

    print_info "Downloading Miniconda..."
    curl -fsSL "https://repo.anaconda.com/miniconda/$CONDA_INSTALLER" -o /tmp/miniconda.sh

    print_info "Installing Miniconda to ~/miniconda3..."
    bash /tmp/miniconda.sh -b -p "$HOME/miniconda3"
    rm /tmp/miniconda.sh

    "$HOME/miniconda3/bin/conda" init bash 2>/dev/null || true
    "$HOME/miniconda3/bin/conda" init zsh 2>/dev/null || true

    export PATH="$HOME/miniconda3/bin:$PATH"

    print_success "Miniconda installed to ~/miniconda3"
    print_warning "Please restart your shell or run: source ~/.bashrc"
fi

# Download
print_step "Downloading SeqDesk"

if [ -n "$SEQDESK_VERSION" ]; then
    VERSION_INFO=$(curl -fsSL "$SEQDESK_API/version?version=$SEQDESK_VERSION" 2>/dev/null || true)
else
    VERSION_INFO=$(curl -fsSL "$SEQDESK_API/version" 2>/dev/null || true)
fi

if [ -z "$VERSION_INFO" ]; then
    print_error "Could not connect to SeqDesk server"
    exit 1
fi

LATEST_VERSION=$(echo "$VERSION_INFO" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
DOWNLOAD_URL=$(echo "$VERSION_INFO" | grep -o '"downloadUrl":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
CHECKSUM=$(echo "$VERSION_INFO" | grep -o '"checksum":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
FILE_SIZE=$(echo "$VERSION_INFO" | grep -o '"size":[0-9]*' | head -1 | cut -d':' -f2 || true)

if [ -z "$LATEST_VERSION" ] || [ -z "$DOWNLOAD_URL" ]; then
    print_error "Could not fetch version info"
    exit 1
fi

print_success "Latest version: $LATEST_VERSION"

TEMP_FILE=$(mktemp)

if [ -n "$FILE_SIZE" ] && [ "$FILE_SIZE" -gt 0 ]; then
    SIZE_MB=$((FILE_SIZE / 1024 / 1024))
    print_info "File size: ${SIZE_MB}MB"
fi

curl -fL "$DOWNLOAD_URL" -o "$TEMP_FILE" --progress-bar 2>&1 | \
    stdbuf -oL tr '\r' '\n' | \
    while IFS= read -r line; do
        if [[ "$line" =~ ([0-9]+)\.([0-9]+)% ]]; then
            percent="${BASH_REMATCH[1]}"
            printf "\r  Downloading: [%-40s] %3d%%" "$(printf '#%.0s' $(seq 1 $((percent * 40 / 100))))" "$percent"
        fi
    done

echo -e "\r  Downloading: [########################################] 100%"
print_success "Downloaded successfully"

if [ -n "$CHECKSUM" ]; then
    print_info "Verifying checksum..."
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
        exit 1
    fi
fi

# Extract
print_step "Extracting package"

if [ -d "$SEQDESK_DIR" ]; then
    if is_truthy "$SEQDESK_YES"; then
        print_error "Directory $SEQDESK_DIR already exists. Set SEQDESK_DIR to a new path or remove it."
        rm -f "$TEMP_FILE"
        exit 1
    fi
    print_warning "Directory exists: $SEQDESK_DIR"
    response=$(read_input "Backup and replace? (y/N): ")
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        rm -f "$TEMP_FILE"
        exit 0
    fi
    mv "$SEQDESK_DIR" "${SEQDESK_DIR}.backup.$(date +%Y%m%d%H%M%S)"
fi

mkdir -p "$SEQDESK_DIR"
tar -xzf "$TEMP_FILE" -C "$SEQDESK_DIR" --strip-components=1
rm "$TEMP_FILE"

print_success "Extracted"

cd "$SEQDESK_DIR"

INSTALLED_VERSION="$LATEST_VERSION"
if command_exists node && [ -f package.json ]; then
    DETECTED_VERSION=$(node -p "try{const pkg=require('./package.json'); pkg.version||''}catch(e){''}" 2>/dev/null || true)
    if [ -n "$DETECTED_VERSION" ]; then
        INSTALLED_VERSION="$DETECTED_VERSION"
    fi
fi

# Configure environment
print_step "Configuring environment"

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
    prompt_value SEQDESK_DATA_PATH "Sequencing data base path" "./data"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        prompt_value SEQDESK_RUN_DIR "Pipeline run directory" "./pipeline_runs"
    fi

    prompt_value SEQDESK_PORT "App port" "3000"
    prompt_optional SEQDESK_NEXTAUTH_URL "NEXTAUTH_URL (optional)" ""
    prompt_optional SEQDESK_DATABASE_URL "DATABASE_URL (optional)" ""
fi

print_config_summary
confirm_config

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        cat > .env <<'EOF'
NEXTAUTH_SECRET=""
NEXTAUTH_URL=""
DATABASE_URL=""
PORT=3000
EOF
    fi
    SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    if grep -q "^NEXTAUTH_SECRET=" .env; then
        sed_inplace "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"${SECRET}\"|" .env
    else
        echo "NEXTAUTH_SECRET=\"${SECRET}\"" >> .env
    fi
    print_success "Created .env with generated secret"
else
    print_info ".env already exists, skipping"
fi

set_env_var "NEXTAUTH_URL" "$SEQDESK_NEXTAUTH_URL"
set_env_var "DATABASE_URL" "$SEQDESK_DATABASE_URL"
set_env_var "PORT" "$SEQDESK_PORT"

write_config "$PIPELINES_ENABLED" "$SEQDESK_DATA_PATH" "$SEQDESK_RUN_DIR"

# Initialize database
print_info "Initializing database..."
PRISMA_CLI="./node_modules/.bin/prisma"
PRISMA_VERSION=""
PRISMA_SKIP_GENERATE=""
if [ ! -f "./node_modules/@prisma/client/generator-build/index.js" ]; then
    PRISMA_SKIP_GENERATE="--skip-generate"
fi
if [ -x "$PRISMA_CLI" ]; then
    "$PRISMA_CLI" db push $PRISMA_SKIP_GENERATE
else
    if command_exists node && [ -f package.json ]; then
        PRISMA_VERSION=$(node -p "try{const pkg=require('./package.json'); (pkg.dependencies&&pkg.dependencies.prisma)||(pkg.devDependencies&&pkg.devDependencies.prisma)||''}catch(e){''}")
        PRISMA_VERSION=$(echo "$PRISMA_VERSION" | sed 's/^[^0-9]*//')
    fi
    if [ -n "$PRISMA_VERSION" ]; then
        print_info "Using Prisma CLI v$PRISMA_VERSION"
        npx prisma@"$PRISMA_VERSION" db push $PRISMA_SKIP_GENERATE
    else
        npx prisma db push $PRISMA_SKIP_GENERATE
    fi
fi
print_info "Seeding initial data..."
npx prisma db seed

print_success "Database initialized"

# Pipeline environment
print_step "Pipeline environment"

if [ "$PIPELINES_ENABLED" = "true" ]; then
    print_info "Setting up conda environment for pipelines..."
    setup_args=(
        --yes
        --write-config
        --pipelines-enabled
        --data-path "$SEQDESK_DATA_PATH"
        --run-dir "$SEQDESK_RUN_DIR"
    )
    ./scripts/setup-conda-env.sh "${setup_args[@]}"
else
    print_info "Skipped pipeline environment setup"
fi

print_step "Process manager"

if [ -z "$SEQDESK_USE_PM2" ]; then
    prompt_yes_no SEQDESK_USE_PM2 "Start SeqDesk with PM2 for auto-restart? (recommended)" "y"
fi

if is_truthy "$SEQDESK_USE_PM2"; then
    if ! command_exists pm2; then
        print_info "Installing PM2 (requires npm)..."
        if npm install -g pm2; then
            print_success "PM2 installed"
        else
            print_warning "PM2 install failed. You may need to run: npm install -g pm2"
        fi
    fi

    if command_exists pm2; then
        print_info "Starting SeqDesk with PM2..."
        if pm2 start "$SEQDESK_DIR/start.sh" --name seqdesk; then
            PM2_CONFIGURED="true"
            pm2 save >/dev/null 2>&1 || print_warning "Could not save PM2 process list (run: pm2 save)"
            if ! pm2 startup >/dev/null 2>&1; then
                print_warning "PM2 startup not enabled. Run: pm2 startup"
            fi
            print_success "PM2 configured for auto-restart"
        else
            print_warning "PM2 failed to start SeqDesk. You can start manually with ./start.sh"
        fi
    else
        print_warning "PM2 not available. You can start manually with ./start.sh"
    fi
else
    print_info "Skipping PM2 setup"
fi

# Done
print_header "Installation Complete!"

echo -e "${GREEN}SeqDesk v$INSTALLED_VERSION installed successfully!${NC}"
echo ""
echo "Installed version: v$INSTALLED_VERSION"
echo "App directory: $SEQDESK_DIR"
echo "Node: v$NODE_VERSION"
if command_exists conda && [ "$PIPELINES_ENABLED" = "true" ]; then
    CONDA_VERSION=$(conda --version 2>/dev/null | awk '{print $2}' || true)
    if [ -n "$CONDA_VERSION" ]; then
        echo "Conda: v$CONDA_VERSION"
    fi
fi
echo "Pipelines: ${PIPELINES_ENABLED}" | sed 's/true/enabled/; s/false/disabled/'
if [ -n "$SEQDESK_DATA_PATH" ]; then
    echo "Data path: $SEQDESK_DATA_PATH"
fi
if [ -n "$SEQDESK_RUN_DIR" ] && [ "$PIPELINES_ENABLED" = "true" ]; then
    echo "Run directory: $SEQDESK_RUN_DIR"
fi
if [ -f "$SEQDESK_DIR/.env" ]; then
    echo "Env file: $SEQDESK_DIR/.env"
fi
if [ -f "$SEQDESK_DIR/seqdesk.config.json" ]; then
    echo "Config file: $SEQDESK_DIR/seqdesk.config.json"
fi
INSTALL_END_TS=$(date +%s)
INSTALL_FINISHED_AT=$(date '+%Y-%m-%d %H:%M:%S %Z')
ELAPSED=$((INSTALL_END_TS - INSTALL_START_TS))
printf 'Started: %s\n' "$INSTALL_STARTED_AT"
printf 'Finished: %s\n' "$INSTALL_FINISHED_AT"
printf 'Elapsed: %dm%ds\n' $((ELAPSED / 60)) $((ELAPSED % 60))
if [ -n "$SEQDESK_LOG" ]; then
    echo "Install log: $SEQDESK_LOG"
fi

echo ""
if [ "$PM2_CONFIGURED" = "true" ]; then
    echo "SeqDesk is running under PM2."
    echo "  pm2 status"
    echo "  pm2 logs seqdesk"
else
    echo "To start SeqDesk manually:"
    echo ""
    echo -e "  ${CYAN}cd $SEQDESK_DIR${NC}"
    echo -e "  ${CYAN}./start.sh${NC}"
    echo ""
    echo "Note: manual start will not auto-restart after updates."
    echo "For auto-restart, re-run the installer and choose PM2, or set up systemd."
fi
echo ""
echo "Open http://localhost:${SEQDESK_PORT:-3000}"
echo ""
echo "Default login:"
echo "  Email:    admin@example.com"
echo "  Password: admin"
echo ""
echo "Next steps:"
echo "  1. Update seqdesk.config.json for your facility"
echo "  2. Configure pipeline execution under Admin > Settings > Compute"
echo ""
