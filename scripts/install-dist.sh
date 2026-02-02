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
#   SEQDESK_YES=1                  - Non-interactive; accept defaults
#   SEQDESK_DATA_PATH=/data        - Sequencing data base path
#   SEQDESK_RUN_DIR=/data/runs     - Pipeline run directory
#   SEQDESK_NEXTAUTH_URL=https://  - Optional NextAuth URL
#   SEQDESK_DATABASE_URL=postgres  - Optional database URL
#   SEQDESK_LOG=/path/install.log  - Optional install log path
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
SEQDESK_YES="${SEQDESK_YES:-}"
SEQDESK_DATA_PATH="${SEQDESK_DATA_PATH:-}"
SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-}"
SEQDESK_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}"
SEQDESK_DATABASE_URL="${SEQDESK_DATABASE_URL:-}"
SEQDESK_LOG="${SEQDESK_LOG:-}"

TOTAL_STEPS=7
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
    local wizard_out
    wizard_out=$(mktemp)
    SEQDESK_WIZARD_OUT="$wizard_out" \
    SEQDESK_WIZARD_PIPELINES_ENABLED="$PIPELINES_ENABLED" \
    SEQDESK_WIZARD_DEFAULT_DATA_PATH="${SEQDESK_DATA_PATH:-./data}" \
    SEQDESK_WIZARD_DEFAULT_RUN_DIR="${SEQDESK_RUN_DIR:-./pipeline_runs}" \
    SEQDESK_YES="${SEQDESK_YES:-}" \
    SEQDESK_DATA_PATH="${SEQDESK_DATA_PATH:-}" \
    SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-}" \
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
    print_error "Command failed (exit ${exit_code}): ${BASH_COMMAND}"
    if [ -n "$SEQDESK_LOG" ]; then
        print_error "See log: $SEQDESK_LOG"
    fi
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

if ! command_exists node; then
    print_error "Node.js is required but not installed."
    print_error "Install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    print_error "Node.js 18+ is required (found v$NODE_VERSION)"
    exit 1
fi
print_success "Node.js $NODE_VERSION"

if ! command_exists npm; then
    print_error "npm is required but not installed."
    exit 1
fi
print_success "npm $(npm -v)"

# Pipeline support
print_step "Pipeline support"

PIPELINES_ENABLED=""
if is_truthy "$SEQDESK_WITH_PIPELINES" || is_truthy "$SEQDESK_WITH_CONDA"; then
    PIPELINES_ENABLED="true"
fi

if [ -z "$PIPELINES_ENABLED" ]; then
    if command_exists conda; then
        prompt_yes_no PIPELINES_ENABLED "Enable pipeline support (Conda + Nextflow)?" "n"
    else
        prompt_yes_no PIPELINES_ENABLED "Install pipeline dependencies (Conda + Nextflow)?" "n"
    fi
fi

if [ "$PIPELINES_ENABLED" = "true" ]; then
    print_info "Pipeline support enabled"
else
    print_info "Pipeline support disabled"
fi

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

LATEST_VERSION=$(echo "$VERSION_INFO" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
DOWNLOAD_URL=$(echo "$VERSION_INFO" | grep -o '"downloadUrl":"[^"]*"' | head -1 | cut -d'"' -f4)
CHECKSUM=$(echo "$VERSION_INFO" | grep -o '"checksum":"[^"]*"' | head -1 | cut -d'"' -f4)
FILE_SIZE=$(echo "$VERSION_INFO" | grep -o '"size":[0-9]*' | head -1 | cut -d':' -f2)

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
    if command -v sha256sum &> /dev/null; then
        ACTUAL_CHECKSUM=$(sha256sum "$TEMP_FILE" | cut -d' ' -f1)
    else
        ACTUAL_CHECKSUM=$(shasum -a 256 "$TEMP_FILE" | cut -d' ' -f1)
    fi

    if [ "$ACTUAL_CHECKSUM" = "$CHECKSUM" ]; then
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

# Configure environment
print_step "Configuring environment"

wizard_status=1
set +e
run_wizard
wizard_status=$?
set -e
if [ $wizard_status -eq 2 ]; then
    print_error "Installation cancelled"
    exit 1
elif [ $wizard_status -ne 0 ]; then
    prompt_value SEQDESK_DATA_PATH "Sequencing data base path" "./data"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        prompt_value SEQDESK_RUN_DIR "Pipeline run directory" "./pipeline_runs"
    fi

    prompt_optional SEQDESK_NEXTAUTH_URL "NEXTAUTH_URL (optional)" ""
    prompt_optional SEQDESK_DATABASE_URL "DATABASE_URL (optional)" ""
fi

if [ ! -f ".env" ]; then
    cp .env.example .env
    SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    sed_inplace "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"${SECRET}\"|" .env
    print_success "Created .env with generated secret"
else
    print_info ".env already exists, skipping"
fi

set_env_var "NEXTAUTH_URL" "$SEQDESK_NEXTAUTH_URL"
set_env_var "DATABASE_URL" "$SEQDESK_DATABASE_URL"

write_config "$PIPELINES_ENABLED" "$SEQDESK_DATA_PATH" "$SEQDESK_RUN_DIR"

# Initialize database
print_info "Initializing database..."
npx prisma db push --skip-generate
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

# Done
print_header "Installation Complete!"

echo -e "${GREEN}SeqDesk $LATEST_VERSION installed successfully!${NC}"
echo ""
echo "App directory: $SEQDESK_DIR"
echo "Node: v$NODE_VERSION"
echo "Pipelines: ${PIPELINES_ENABLED}" | sed 's/true/enabled/; s/false/disabled/'
if [ -n "$SEQDESK_DATA_PATH" ]; then
    echo "Data path: $SEQDESK_DATA_PATH"
fi
if [ -n "$SEQDESK_RUN_DIR" ] && [ "$PIPELINES_ENABLED" = "true" ]; then
    echo "Run directory: $SEQDESK_RUN_DIR"
fi
if [ -n "$SEQDESK_LOG" ]; then
    echo "Install log: $SEQDESK_LOG"
fi

echo ""
echo "To start SeqDesk:"
echo ""
echo -e "  ${CYAN}cd $SEQDESK_DIR${NC}"
echo -e "  ${CYAN}./start.sh${NC}"
echo ""
echo "Then open http://localhost:3000"
echo ""
echo "Default login:"
echo "  Email:    admin@example.com"
echo "  Password: admin"
echo ""
echo "Next steps:"
echo "  1. Update seqdesk.config.json for your facility"
echo "  2. Configure pipeline execution under Admin > Settings > Compute"
echo ""
