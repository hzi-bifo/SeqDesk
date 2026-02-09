#!/bin/bash
#
# SeqDesk Installation Script
# Usage: curl -fsSL https://seqdesk.com/install.sh | bash
#
# Options (environment variables):
#   SEQDESK_DIR=/path/to/install   - Installation directory (default: ./seqdesk)
#   SEQDESK_BRANCH=main            - Git branch to install (default: main)
#   SEQDESK_SKIP_DEPS=1            - Skip dependency checks
#   SEQDESK_WITH_CONDA=1           - Legacy: install Miniconda + pipeline env
#   SEQDESK_WITH_PIPELINES=1       - Install pipeline dependencies (Conda + Nextflow)
#   SEQDESK_YES=1                  - Non-interactive; accept defaults
#   SEQDESK_DATA_PATH=/data        - Sequencing data base path
#   SEQDESK_RUN_DIR=/data/runs     - Pipeline run directory
#   SEQDESK_PORT=3000              - App port (default: 3000)
#   SEQDESK_NEXTAUTH_URL=https://  - Optional NextAuth URL
#   SEQDESK_DATABASE_URL=postgres  - Optional database URL
#   SEQDESK_LOG=/path/install.log  - Optional install log path
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SEQDESK_REPO="https://github.com/hzi-bifo/SeqDesk.git"
SEQDESK_DIR="${SEQDESK_DIR:-./seqdesk}"
SEQDESK_BRANCH="${SEQDESK_BRANCH:-main}"
MIN_NODE_VERSION=18

SEQDESK_SKIP_DEPS="${SEQDESK_SKIP_DEPS:-}"
SEQDESK_WITH_CONDA="${SEQDESK_WITH_CONDA:-}"
SEQDESK_WITH_PIPELINES="${SEQDESK_WITH_PIPELINES:-}"
SEQDESK_YES="${SEQDESK_YES:-}"
SEQDESK_DATA_PATH="${SEQDESK_DATA_PATH:-}"
SEQDESK_RUN_DIR="${SEQDESK_RUN_DIR:-}"
SEQDESK_PORT="${SEQDESK_PORT:-}"
SEQDESK_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}"
SEQDESK_DATABASE_URL="${SEQDESK_DATABASE_URL:-}"
SEQDESK_LOG="${SEQDESK_LOG:-}"

TOTAL_STEPS=8
CURRENT_STEP=0

# Helper functions
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
echo "  Sequencing Facility Management System"
echo "  https://seqdesk.com"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_warning "Running as root. Consider running as a regular user."
fi

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

# Check dependencies
print_step "Checking dependencies"

MISSING_DEPS=()
NODE_VERSION=""
NPM_VERSION=""
GIT_VERSION=""
CONDA_VERSION=""
NF_VERSION=""

if command_exists git; then
    GIT_VERSION=$(git --version | cut -d' ' -f3)
    print_success "Git: $GIT_VERSION"
else
    MISSING_DEPS+=("git")
    print_error "Git: not found"
fi

if command_exists node; then
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge "$MIN_NODE_VERSION" ]; then
        print_success "Node.js: $NODE_VERSION"
    else
        print_error "Node.js: $NODE_VERSION (requires >= $MIN_NODE_VERSION)"
        MISSING_DEPS+=("node")
    fi
else
    MISSING_DEPS+=("node")
    print_error "Node.js: not found"
fi

if command_exists npm; then
    NPM_VERSION=$(npm --version)
    print_success "npm: $NPM_VERSION"
else
    MISSING_DEPS+=("npm")
    print_error "npm: not found"
fi

if command_exists conda; then
    CONDA_VERSION=$(conda --version | cut -d' ' -f2)
    print_success "Conda: $CONDA_VERSION (optional)"
else
    print_info "Conda: not found (optional, needed for pipelines)"
fi

if command_exists nextflow; then
    NF_VERSION=$(nextflow -version 2>&1 | grep -oE 'version [0-9.]+' | awk '{print $2}' || echo "unknown")
    print_success "Nextflow: $NF_VERSION (optional)"
else
    print_info "Nextflow: not found (optional, needed for pipelines)"
fi

if [ ${#MISSING_DEPS[@]} -gt 0 ] && [ -z "$SEQDESK_SKIP_DEPS" ]; then
    print_header "Installing missing dependencies"
    for dep in "${MISSING_DEPS[@]}"; do
        case $dep in
            node|npm)
                print_info "Installing Node.js..."
                if [[ "$OS" == "macos" ]]; then
                    if command_exists brew; then
                        brew install node
                    else
                        print_error "Please install Homebrew first: https://brew.sh"
                        exit 1
                    fi
                elif [[ "$DISTRO" == "debian" ]]; then
                    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                elif [[ "$DISTRO" == "redhat" ]]; then
                    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                    sudo yum install -y nodejs
                else
                    print_error "Please install Node.js manually: https://nodejs.org"
                    exit 1
                fi
                ;;
            git)
                print_info "Installing Git..."
                if [[ "$OS" == "macos" ]]; then
                    xcode-select --install 2>/dev/null || brew install git
                elif [[ "$DISTRO" == "debian" ]]; then
                    sudo apt-get update && sudo apt-get install -y git
                elif [[ "$DISTRO" == "redhat" ]]; then
                    sudo yum install -y git
                fi
                ;;
        esac
    done
    print_success "Dependencies installed"
fi

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

# Install Miniconda if requested and missing
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
    CONDA_VERSION=$(conda --version | cut -d' ' -f2 || true)

    print_success "Miniconda installed to ~/miniconda3"
    print_warning "Please restart your shell or run: source ~/.bashrc"
fi

# Clone repository
print_step "Downloading SeqDesk"

if [ -d "$SEQDESK_DIR" ]; then
    if is_truthy "$SEQDESK_YES"; then
        print_error "Directory $SEQDESK_DIR already exists. Set SEQDESK_DIR to a new path or remove it."
        exit 1
    fi
    print_warning "Directory $SEQDESK_DIR already exists"
    overwrite_reply=$(read_input "Overwrite? (y/N) ")
    if [[ ! "$overwrite_reply" =~ ^[Yy]$ ]]; then
        print_error "Installation cancelled"
        exit 1
    fi
    rm -rf "$SEQDESK_DIR"
fi

print_info "Cloning repository..."
git clone --branch "$SEQDESK_BRANCH" --depth 1 "$SEQDESK_REPO" "$SEQDESK_DIR"
cd "$SEQDESK_DIR"

print_success "Downloaded to $SEQDESK_DIR"

INSTALLED_VERSION=""
if command_exists node && [ -f package.json ]; then
    INSTALLED_VERSION=$(node -p "try{const pkg=require('./package.json'); pkg.version||''}catch(e){''}" 2>/dev/null || true)
fi

# Install npm dependencies
print_step "Installing Node dependencies"

print_info "Running npm install..."
npm install

print_success "Dependencies installed"

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

if [ ! -f .env ]; then
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
    RANDOM_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    if grep -q "^NEXTAUTH_SECRET=" .env; then
        sed_inplace "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"${RANDOM_SECRET}\"|" .env
    else
        echo "NEXTAUTH_SECRET=\"${RANDOM_SECRET}\"" >> .env
    fi
    print_success "Created .env with generated secret"
else
    print_info ".env already exists, skipping"
fi

set_env_var "NEXTAUTH_URL" "$SEQDESK_NEXTAUTH_URL"
set_env_var "DATABASE_URL" "$SEQDESK_DATABASE_URL"
set_env_var "PORT" "$SEQDESK_PORT"

write_config "$PIPELINES_ENABLED" "$SEQDESK_DATA_PATH" "$SEQDESK_RUN_DIR"

# Setup database
print_step "Initializing database"

print_info "Creating database schema..."
PRISMA_CLI="./node_modules/.bin/prisma"
PRISMA_VERSION=""
PRISMA_SKIP_GENERATE=""
if [ ! -f "./node_modules/@prisma/client/generator-build/index.js" ]; then
    PRISMA_SKIP_GENERATE="--skip-generate"
fi
if command_exists node && [ -f package.json ]; then
    PRISMA_VERSION=$(node -p "try{const pkg=require('./package.json'); (pkg.dependencies&&pkg.dependencies.prisma)||(pkg.devDependencies&&pkg.devDependencies.prisma)||''}catch(e){''}")
    PRISMA_VERSION=$(echo "$PRISMA_VERSION" | sed 's/^[^0-9]*//')
fi
if [ -x "$PRISMA_CLI" ]; then
    "$PRISMA_CLI" db push $PRISMA_SKIP_GENERATE
else
    if [ -n "$PRISMA_VERSION" ]; then
        print_info "Using Prisma CLI v$PRISMA_VERSION"
        npx prisma@"$PRISMA_VERSION" db push $PRISMA_SKIP_GENERATE
    else
        npx prisma db push $PRISMA_SKIP_GENERATE
    fi
fi

print_info "Seeding initial data..."
if [ -x "$PRISMA_CLI" ]; then
    "$PRISMA_CLI" db seed
elif [ -n "$PRISMA_VERSION" ]; then
    print_info "Using Prisma CLI v$PRISMA_VERSION for seeding"
    npx prisma@"$PRISMA_VERSION" db seed
else
    npx prisma db seed
fi

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

# Final instructions
print_header "Installation Complete!"

echo -e "${GREEN}SeqDesk has been installed successfully!${NC}"
echo ""
if [ -n "$INSTALLED_VERSION" ]; then
    echo "Installed version: v$INSTALLED_VERSION"
fi
echo "App directory: $SEQDESK_DIR"
if [ -n "$NODE_VERSION" ]; then
    echo "Node: v$NODE_VERSION"
fi
if [ -n "$CONDA_VERSION" ] && [ "$PIPELINES_ENABLED" = "true" ]; then
    echo "Conda: v$CONDA_VERSION"
fi
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
echo "To start the application:"
echo ""
echo -e "  ${BLUE}cd $SEQDESK_DIR${NC}"
echo -e "  ${BLUE}npm run dev${NC}"
echo ""
echo "Then open http://localhost:${SEQDESK_PORT:-3000} in your browser."
echo ""
echo "Default login credentials:"
echo "  Admin:      admin@example.com / admin"
echo "  Researcher: user@example.com / user"
echo ""
echo "Next steps:"
echo "  1. Update seqdesk.config.json for your facility"
echo "  2. Configure pipeline execution under Admin > Settings > Compute"
echo "  3. See docs/installation.md for production deployment"
echo ""
echo -e "Documentation: ${BLUE}https://github.com/hzi-bifo/SeqDesk/tree/main/docs${NC}"
echo -e "Website:       ${BLUE}https://seqdesk.com${NC}"
echo ""
