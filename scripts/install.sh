#!/bin/bash
#
# SeqDesk Installation Script
# Usage: curl -fsSL https://seqdesk.com/install.sh | bash
# CLI usage: curl -fsSL https://seqdesk.com/install.sh | bash -s -- [options]
#
# Options (environment variables):
#   SEQDESK_REPO=https://github.com/... - Source repository override (advanced/CI)
#   SEQDESK_DIR=/path/to/install   - Installation directory (default: ./seqdesk)
#   SEQDESK_BRANCH=main            - Git branch to install (default: main)
#   SEQDESK_SKIP_DEPS=1            - Skip dependency checks
#   SEQDESK_WITH_CONDA=1           - Legacy: install Miniconda + pipeline env
#   SEQDESK_WITH_PIPELINES=1       - Install pipeline dependencies (Conda + Nextflow)
#   SEQDESK_YES=1                  - Non-interactive; accept defaults
#   SEQDESK_DATA_PATH=/data        - Optional sequencing data base path override
#   SEQDESK_RUN_DIR=/data/runs     - Optional pipeline run directory override
#   SEQDESK_PORT=8000              - App port (default: 8000)
#   SEQDESK_NEXTAUTH_URL=https://  - Optional NextAuth URL override
#   SEQDESK_NEXTAUTH_SECRET=...    - Optional NextAuth secret override
#   SEQDESK_DATABASE_URL=postgresql://... - Optional database URL
#   SEQDESK_DATABASE_DIRECT_URL=postgresql://... - Optional direct database URL for migrations
#   SEQDESK_ANTHROPIC_API_KEY=...  - Optional Anthropic API key
#   SEQDESK_ADMIN_SECRET=...       - Optional admin secret
#   SEQDESK_BLOB_READ_WRITE_TOKEN=... - Optional Blob token
#   SEQDESK_LOG=/path/install.log  - Optional install log path
#   SEQDESK_CONFIG=/path/or/url    - Optional infra JSON (flat or nested keys)
#   SEQDESK_EXEC_USE_SLURM=true    - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_QUEUE=cpu   - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_CORES=4     - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_MEMORY=64GB - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_TIME_LIMIT=12 - Optional pipeline execution override
#   SEQDESK_EXEC_SLURM_OPTIONS=... - Optional pipeline execution override
#   SEQDESK_EXEC_CONDA_PATH=/opt/miniconda3 - Optional pipeline execution override
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

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SEQDESK_REPO="${SEQDESK_REPO:-https://github.com/hzi-bifo/SeqDesk.git}"
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
SEQDESK_NEXTAUTH_SECRET="${SEQDESK_NEXTAUTH_SECRET:-}"
SEQDESK_DATABASE_URL="${SEQDESK_DATABASE_URL:-}"
SEQDESK_DATABASE_DIRECT_URL="${SEQDESK_DATABASE_DIRECT_URL:-}"
SEQDESK_ANTHROPIC_API_KEY="${SEQDESK_ANTHROPIC_API_KEY:-}"
SEQDESK_ADMIN_SECRET="${SEQDESK_ADMIN_SECRET:-}"
SEQDESK_BLOB_READ_WRITE_TOKEN="${SEQDESK_BLOB_READ_WRITE_TOKEN:-}"
SEQDESK_LOG="${SEQDESK_LOG:-}"
SEQDESK_CONFIG="${SEQDESK_CONFIG:-}"
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
SEQDESK_METAXPATH_PACKAGE_URL="${SEQDESK_METAXPATH_PACKAGE_URL:-${METAXPATH_PACKAGE_URL:-}}"
SEQDESK_METAXPATH_KEY="${SEQDESK_METAXPATH_KEY:-${METAXPATH_PACKAGE_TOKEN:-}}"
SEQDESK_METAXPATH_SHA256="${SEQDESK_METAXPATH_SHA256:-${METAXPATH_PACKAGE_SHA256:-}}"

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

print_usage() {
    cat <<'EOF'
Usage:
  curl -fsSL https://seqdesk.com/install.sh | bash -s -- [options]

Options:
  -y, --yes                    Non-interactive mode (accept defaults)
  --config <path-or-url>       Infrastructure JSON file (local path or https URL)
  --dir <path>                 Install directory
  --branch <branch>            Git branch to install (source installer)
  --with-pipelines             Enable pipeline dependencies
  --without-pipelines          Disable pipeline dependencies
  --skip-deps                  Skip dependency preflight checks
  --port <port>                App port
  --data-path <path>           Sequencing data directory
  --run-dir <path>             Pipeline run directory
  --nextauth-url <url>         NEXTAUTH_URL override
  --nextauth-secret <secret>   NEXTAUTH_SECRET override
  --database-url <url>         DATABASE_URL override
  --database-direct-url <url>  DIRECT_URL override for Prisma migrations
  --anthropic-api-key <key>    ANTHROPIC_API_KEY override
  --admin-secret <secret>      ADMIN_SECRET override
  --blob-read-write-token <token>  BLOB_READ_WRITE_TOKEN override
  -h, --help                   Show this help

Examples:
  curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y
  curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y --config https://example.org/infrastructure-setup.json
EOF
}

print_node_install_instructions() {
    print_info "Install Node.js ${MIN_NODE_VERSION}+ manually and re-run this installer."
    case "$OS:$DISTRO" in
        macos:macos)
            echo "  brew install node"
            ;;
        linux:debian)
            echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
            echo "  sudo apt-get install -y nodejs"
            ;;
        linux:redhat)
            echo "  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -"
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
}

print_git_install_instructions() {
    print_info "Install Git manually and re-run this installer."
    case "$OS:$DISTRO" in
        macos:macos)
            if command_exists brew; then
                echo "  brew install git"
            else
                echo "  xcode-select --install"
            fi
            ;;
        linux:debian)
            echo "  sudo apt-get update && sudo apt-get install -y git"
            ;;
        linux:redhat)
            if command_exists dnf; then
                echo "  sudo dnf install -y git"
            else
                echo "  sudo yum install -y git"
            fi
            ;;
        *)
            echo "  https://git-scm.com/downloads"
            ;;
    esac
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

default_postgres_url() {
    local password="$1"
    printf 'postgresql://seqdesk:%s@127.0.0.1:5432/seqdesk?schema=public' "$password"
}

is_postgres_url() {
    [[ "${1:-}" =~ ^postgres(ql)?:// ]]
}

configure_postgres_urls() {
    if [ -z "$SEQDESK_DATABASE_URL" ]; then
        local generated_password
        generated_password="$(generate_postgres_password)"
        SEQDESK_DATABASE_URL="$(default_postgres_url "$generated_password")"
        print_info "No DATABASE_URL supplied. Defaulting to local PostgreSQL on 127.0.0.1:5432."
        print_info "Create role 'seqdesk' with this password: $generated_password"
    fi

    if [[ "$SEQDESK_DATABASE_URL" == file:* ]]; then
        print_error "SQLite is no longer supported. Configure PostgreSQL via --database-url or SEQDESK_DATABASE_URL."
        exit 1
    fi

    if ! is_postgres_url "$SEQDESK_DATABASE_URL"; then
        print_error "Unsupported DATABASE_URL. SeqDesk now only supports PostgreSQL connection strings."
        exit 1
    fi

    if [ -z "$SEQDESK_DATABASE_DIRECT_URL" ]; then
        SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
    fi

    if [[ "$SEQDESK_DATABASE_DIRECT_URL" == file:* ]]; then
        print_error "SQLite is no longer supported for DIRECT_URL. Use a PostgreSQL connection string."
        exit 1
    fi

    if ! is_postgres_url "$SEQDESK_DATABASE_DIRECT_URL"; then
        print_error "Unsupported DIRECT_URL. SeqDesk now only supports PostgreSQL connection strings."
        exit 1
    fi
}

print_postgres_setup_instructions() {
    print_warning "PostgreSQL must be installed and the SeqDesk database must exist before migrations can run."
    case "$OS:$DISTRO" in
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
            echo "  Install PostgreSQL 15+ and ensure it is reachable from this host."
            ;;
    esac
    echo "  sudo -u postgres psql <<'SQL'"
    echo "  CREATE ROLE seqdesk LOGIN PASSWORD 'replace-with-password-from-DATABASE_URL';"
    echo "  CREATE DATABASE seqdesk OWNER seqdesk;"
    echo "  SQL"
    echo "  Current DATABASE_URL: ${SEQDESK_DATABASE_URL}"
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

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            -y|--yes)
                SEQDESK_YES="1"
                ;;
            --config)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --config"
                    exit 1
                fi
                SEQDESK_CONFIG="$2"
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
            --branch)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --branch"
                    exit 1
                fi
                SEQDESK_BRANCH="$2"
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

load_install_config() {
    local config_ref="$1"
    local config_path="$config_ref"
    local temp_json=""
    local temp_env=""

    if ! command_exists node; then
        print_error "Node.js is required to parse --config JSON."
        exit 1
    fi

    if [[ "$config_ref" =~ ^https?:// ]]; then
        if ! command_exists curl; then
            print_error "curl is required to download config URL: $config_ref"
            exit 1
        fi
        temp_json=$(mktemp)
        if ! curl -fsSL "$config_ref" -o "$temp_json"; then
            rm -f "$temp_json"
            print_error "Failed to download config: $config_ref"
            exit 1
        fi
        config_path="$temp_json"
    elif [ ! -f "$config_ref" ]; then
        print_error "Config file not found: $config_ref"
        exit 1
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
const site = toRecord(root.site);
const pipelines = toRecord(root.pipelines);
const execution = toRecord(pipelines?.execution);
const conda = toRecord(execution?.conda);
const slurm = toRecord(execution?.slurm);
const runtime = toRecord(root.runtime);
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
if (values.port !== undefined && values.port > 0) out.SEQDESK_CFG_PORT = String(values.port);
if (values.dataPath) out.SEQDESK_CFG_DATA_PATH = values.dataPath;
if (values.runDir) out.SEQDESK_CFG_RUN_DIR = values.runDir;
if (values.nextAuthUrl) out.SEQDESK_CFG_NEXTAUTH_URL = values.nextAuthUrl;
if (values.nextAuthSecret) out.SEQDESK_CFG_NEXTAUTH_SECRET = values.nextAuthSecret;
if (values.databaseUrl) out.SEQDESK_CFG_DATABASE_URL = values.databaseUrl;
if (values.directUrl) out.SEQDESK_CFG_DATABASE_DIRECT_URL = values.directUrl;
if (values.anthropicApiKey) out.SEQDESK_CFG_ANTHROPIC_API_KEY = values.anthropicApiKey;
if (values.adminSecret) out.SEQDESK_CFG_ADMIN_SECRET = values.adminSecret;
if (values.blobReadWriteToken) {
  out.SEQDESK_CFG_BLOB_READ_WRITE_TOKEN = values.blobReadWriteToken;
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
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$temp_env"
    rm -f "$temp_env"
    if [ -n "$temp_json" ]; then
        rm -f "$temp_json"
    fi

    apply_config_value SEQDESK_PORT SEQDESK_CFG_PORT
    apply_config_value SEQDESK_DATA_PATH SEQDESK_CFG_DATA_PATH
    apply_config_value SEQDESK_RUN_DIR SEQDESK_CFG_RUN_DIR
    apply_config_value SEQDESK_NEXTAUTH_URL SEQDESK_CFG_NEXTAUTH_URL
    apply_config_value SEQDESK_NEXTAUTH_SECRET SEQDESK_CFG_NEXTAUTH_SECRET
    apply_config_value SEQDESK_DATABASE_URL SEQDESK_CFG_DATABASE_URL
    apply_config_value SEQDESK_DATABASE_DIRECT_URL SEQDESK_CFG_DATABASE_DIRECT_URL
    apply_config_value SEQDESK_ANTHROPIC_API_KEY SEQDESK_CFG_ANTHROPIC_API_KEY
    apply_config_value SEQDESK_ADMIN_SECRET SEQDESK_CFG_ADMIN_SECRET
    apply_config_value SEQDESK_BLOB_READ_WRITE_TOKEN SEQDESK_CFG_BLOB_READ_WRITE_TOKEN
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

    unset SEQDESK_CFG_PORT SEQDESK_CFG_DATA_PATH SEQDESK_CFG_RUN_DIR
    unset SEQDESK_CFG_NEXTAUTH_URL SEQDESK_CFG_NEXTAUTH_SECRET
    unset SEQDESK_CFG_DATABASE_URL SEQDESK_CFG_DATABASE_DIRECT_URL SEQDESK_CFG_WITH_PIPELINES
    unset SEQDESK_CFG_ANTHROPIC_API_KEY SEQDESK_CFG_ADMIN_SECRET
    unset SEQDESK_CFG_BLOB_READ_WRITE_TOKEN
    unset SEQDESK_CFG_EXEC_USE_SLURM SEQDESK_CFG_EXEC_SLURM_QUEUE
    unset SEQDESK_CFG_EXEC_SLURM_CORES SEQDESK_CFG_EXEC_SLURM_MEMORY
    unset SEQDESK_CFG_EXEC_SLURM_TIME_LIMIT SEQDESK_CFG_EXEC_SLURM_OPTIONS
    unset SEQDESK_CFG_EXEC_CONDA_PATH SEQDESK_CFG_EXEC_CONDA_ENV
    unset SEQDESK_CFG_EXEC_NEXTFLOW_PROFILE SEQDESK_CFG_EXEC_WEBLOG_URL
    unset SEQDESK_CFG_EXEC_WEBLOG_SECRET
    unset SEQDESK_CFG_METAXPATH_PACKAGE_URL SEQDESK_CFG_METAXPATH_KEY
    unset SEQDESK_CFG_METAXPATH_SHA256
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

install_source_node_modules() {
    if [ -f package-lock.json ]; then
        print_info "Running npm ci..."
        npm ci --no-audit --no-fund
    else
        print_warning "package-lock.json not found, falling back to npm install."
        npm install --no-audit --no-fund
    fi
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

    print_info "Installing missing dependency: ${module_name}"
    if npm install --no-save "${module_name}"; then
        print_success "Installed ${module_name}"
        return 0
    fi

    print_warning "Could not install ${module_name}; seed may fail."
    return 1
}

write_start_script() {
    cat > start.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -n "${1:-}" ]]; then
  export PORT="$1"
fi

if [[ -z "${PORT:-}" && -f seqdesk.config.json ]]; then
  CONFIG_PORT=$(node <<'NODE' 2>/dev/null || true
const fs = require("fs");

function toOptionalPort(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const intValue = Math.trunc(value);
    if (intValue > 0 && intValue <= 65535) return String(intValue);
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return "";
    const intValue = Math.trunc(parsed);
    if (intValue > 0 && intValue <= 65535) return String(intValue);
  }
  return "";
}

try {
  const parsed = JSON.parse(fs.readFileSync("seqdesk.config.json", "utf8"));
  const appPort = toOptionalPort(parsed?.app?.port);
  if (appPort) {
    process.stdout.write(appPort);
    process.exit(0);
  }
  const nextAuthUrl = parsed?.runtime?.nextAuthUrl;
  if (typeof nextAuthUrl === "string" && nextAuthUrl.trim()) {
    try {
      const parsedUrl = new URL(nextAuthUrl);
      if (parsedUrl.port) {
        process.stdout.write(parsedUrl.port);
      }
    } catch {
      // Ignore invalid URL.
    }
  }
} catch {
  // Ignore invalid or missing config.
}
NODE
)
  if [[ -n "$CONFIG_PORT" ]]; then
    export PORT="$CONFIG_PORT"
  fi
fi

if [[ -z "${PORT:-}" ]]; then
  export PORT=3000
fi

export NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}"
export NODE_ENV=production

RUNTIME_DB_JSON=$(node <<'NODE'
const fs = require("fs");

function trim(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

let databaseUrl = trim(process.env.DATABASE_URL);
let directUrl = trim(process.env.DIRECT_URL);
const envDatabaseUrl = databaseUrl;

if ((!databaseUrl || !directUrl) && fs.existsSync("seqdesk.config.json")) {
  try {
    const parsed = JSON.parse(fs.readFileSync("seqdesk.config.json", "utf8"));
    const runtime = parsed && typeof parsed === "object" ? parsed.runtime : undefined;
    if (!databaseUrl) databaseUrl = trim(runtime?.databaseUrl);
    if (!directUrl) directUrl = envDatabaseUrl || trim(runtime?.directUrl) || databaseUrl;
  } catch {}
}

directUrl = directUrl || databaseUrl;

if (!databaseUrl) process.exit(1);
if (databaseUrl.startsWith("file:")) {
  console.error("SQLite is no longer supported. Configure PostgreSQL in DATABASE_URL.");
  process.exit(1);
}
if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
  console.error("Unsupported DATABASE_URL. SeqDesk now only supports PostgreSQL connection strings.");
  process.exit(1);
}

if (directUrl.startsWith("file:")) {
  console.error("SQLite is no longer supported for DIRECT_URL. Use a PostgreSQL connection string.");
  process.exit(1);
}
if (!directUrl.startsWith("postgresql://") && !directUrl.startsWith("postgres://")) {
  console.error("Unsupported DIRECT_URL. SeqDesk now only supports PostgreSQL connection strings.");
  process.exit(1);
}

process.stdout.write(JSON.stringify({ databaseUrl, directUrl }));
NODE
)
export DATABASE_URL="$(node -p "JSON.parse(process.argv[1]).databaseUrl" "$RUNTIME_DB_JSON")"
export DIRECT_URL="$(node -p "JSON.parse(process.argv[1]).directUrl" "$RUNTIME_DB_JSON")"

if [[ ! -f ".next/BUILD_ID" ]]; then
  echo "Next.js build output not found. Building SeqDesk..."
  npm run build
fi

APP_VERSION=""
if [[ -f package.json ]]; then
  APP_VERSION=$(node -p "try { require('./package.json').version || '' } catch (e) { '' }" 2>/dev/null || true)
fi
if [[ -n "$APP_VERSION" ]]; then
  echo "SeqDesk version: v${APP_VERSION}"
fi

exec npm run start
EOF
    chmod +x start.sh
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

    print_info "Installing private MetaxPath pipeline package..."
    local metaxpath_args=(
        --url "${SEQDESK_METAXPATH_PACKAGE_URL}"
        --token "${SEQDESK_METAXPATH_KEY}"
        --dir "$(pwd)"
    )
    if [ -n "${SEQDESK_METAXPATH_SHA256:-}" ]; then
        metaxpath_args+=(--sha256 "${SEQDESK_METAXPATH_SHA256}")
    fi

    if ./scripts/install-private-metaxpath.sh "${metaxpath_args[@]}"; then
        print_success "Private MetaxPath pipeline installed"
    else
        print_error "Private MetaxPath pipeline installation failed."
        exit 1
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
    SEQDESK_INSTALL_NEXTAUTH_URL="${SEQDESK_NEXTAUTH_URL:-}" \
    SEQDESK_INSTALL_NEXTAUTH_SECRET="${SEQDESK_NEXTAUTH_SECRET:-}" \
    SEQDESK_INSTALL_DATABASE_URL="${SEQDESK_DATABASE_URL:-}" \
    SEQDESK_INSTALL_DATABASE_DIRECT_URL="${SEQDESK_DATABASE_DIRECT_URL:-}" \
    SEQDESK_INSTALL_ANTHROPIC_API_KEY="${SEQDESK_ANTHROPIC_API_KEY:-}" \
    SEQDESK_INSTALL_ADMIN_SECRET="${SEQDESK_ADMIN_SECRET:-}" \
    SEQDESK_INSTALL_BLOB_READ_WRITE_TOKEN="${SEQDESK_BLOB_READ_WRITE_TOKEN:-}" \
    SEQDESK_INSTALL_PORT="${SEQDESK_PORT:-}" \
    node <<'NODE'
const fs = require('fs');

const dataPath = process.env.SEQDESK_INSTALL_DATA_PATH || '';
const runDir = process.env.SEQDESK_INSTALL_RUN_DIR || '';
const pipelinesEnabled = process.env.SEQDESK_INSTALL_PIPELINES_ENABLED || '';
const nextAuthUrl = process.env.SEQDESK_INSTALL_NEXTAUTH_URL || '';
const nextAuthSecret = process.env.SEQDESK_INSTALL_NEXTAUTH_SECRET || '';
const databaseUrl = process.env.SEQDESK_INSTALL_DATABASE_URL || '';
const directUrl = process.env.SEQDESK_INSTALL_DATABASE_DIRECT_URL || '';
const anthropicApiKey = process.env.SEQDESK_INSTALL_ANTHROPIC_API_KEY || '';
const adminSecret = process.env.SEQDESK_INSTALL_ADMIN_SECRET || '';
const blobReadWriteToken = process.env.SEQDESK_INSTALL_BLOB_READ_WRITE_TOKEN || '';
const appPortRaw = process.env.SEQDESK_INSTALL_PORT || '';

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

const config = readJson('seqdesk.config.json') || {};

config.site = config.site || {};
if (dataPath) config.site.dataBasePath = dataPath;

config.pipelines = config.pipelines || {};
if (pipelinesEnabled) config.pipelines.enabled = pipelinesEnabled === 'true';

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

fs.writeFileSync('seqdesk.config.json', JSON.stringify(config, null, 2));
console.log('Wrote seqdesk.config.json');
NODE
}

has_infrastructure_overrides() {
    [ -n "$SEQDESK_DATA_PATH" ] || \
    [ -n "$SEQDESK_RUN_DIR" ] || \
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
    const raw = fs.readFileSync("seqdesk.config.json", "utf8");
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
    set +e
    print_error "Command failed (exit ${exit_code}): ${BASH_COMMAND}"
    if [ -n "$SEQDESK_LOG" ]; then
        print_error "See log: $SEQDESK_LOG"
    fi
    exit $exit_code
}

parse_args "$@"
SEQDESK_DIR="${SEQDESK_DIR/#\~/$HOME}"
SEQDESK_DIR="$(resolve_absolute_dir "$SEQDESK_DIR")"

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
    print_header "Missing required dependencies"
    print_warning "Automatic system package installation is disabled."
    printed_node_instructions="false"
    for dep in "${MISSING_DEPS[@]}"; do
        case "$dep" in
            node|npm)
                if [ "$printed_node_instructions" != "true" ]; then
                    print_node_install_instructions
                    printed_node_instructions="true"
                fi
                ;;
            git)
                print_git_install_instructions
                ;;
        esac
    done
    print_error "Install missing dependencies and re-run the installer."
    exit 1
fi

if [ -n "$SEQDESK_CONFIG" ]; then
    print_info "Loading installer config: $SEQDESK_CONFIG"
    load_install_config "$SEQDESK_CONFIG"
    print_success "Loaded installer config"
fi

if [ -n "$SEQDESK_EXEC_CONDA_PATH" ]; then
    SEQDESK_EXEC_CONDA_PATH="${SEQDESK_EXEC_CONDA_PATH/#\~/$HOME}"
fi

CONDA_BIN_FROM_PATH=""
if [ -n "$SEQDESK_EXEC_CONDA_PATH" ]; then
    for candidate in "$SEQDESK_EXEC_CONDA_PATH/condabin/conda" "$SEQDESK_EXEC_CONDA_PATH/bin/conda"; do
        if [ -x "$candidate" ]; then
            CONDA_BIN_FROM_PATH="$candidate"
            break
        fi
    done
    if [ -n "$CONDA_BIN_FROM_PATH" ]; then
        export PATH="$SEQDESK_EXEC_CONDA_PATH/bin:$PATH"
        print_info "Using configured Conda at $CONDA_BIN_FROM_PATH"
    fi
fi

# Pipeline support
print_step "Pipeline support"

PIPELINES_ENABLED=""
if [ -n "$SEQDESK_WITH_PIPELINES" ]; then
    if is_truthy "$SEQDESK_WITH_PIPELINES"; then
        PIPELINES_ENABLED="true"
    else
        PIPELINES_ENABLED="false"
    fi
elif is_truthy "$SEQDESK_WITH_CONDA"; then
    PIPELINES_ENABLED="true"
fi

HAS_CONDA="false"
if [ -n "$CONDA_BIN_FROM_PATH" ] || command_exists conda; then
    HAS_CONDA="true"
fi

if [ -z "$PIPELINES_ENABLED" ]; then
    if [ "$HAS_CONDA" = "true" ]; then
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
if [ "$PIPELINES_ENABLED" = "true" ] && [ "$HAS_CONDA" != "true" ]; then
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

    CONDA_INSTALL_BASE="${SEQDESK_EXEC_CONDA_PATH:-$HOME/miniconda3}"
    print_info "Installing Miniconda to $CONDA_INSTALL_BASE..."
    bash /tmp/miniconda.sh -b -p "$CONDA_INSTALL_BASE"
    rm /tmp/miniconda.sh

    CONDA_INIT_BIN=""
    for candidate in "$CONDA_INSTALL_BASE/condabin/conda" "$CONDA_INSTALL_BASE/bin/conda"; do
        if [ -x "$candidate" ]; then
            CONDA_INIT_BIN="$candidate"
            break
        fi
    done
    if [ -z "$CONDA_INIT_BIN" ]; then
        print_error "Miniconda install completed but conda binary was not found under $CONDA_INSTALL_BASE."
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
    CONDA_VERSION=$("$CONDA_INIT_BIN" --version | cut -d' ' -f2 || true)
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

# Clone repository
print_step "Downloading SeqDesk"

EXISTING_BACKUP_PATH=""
if [ -e "$SEQDESK_DIR" ]; then
    if is_truthy "$SEQDESK_YES"; then
        print_error "Target path $SEQDESK_DIR already exists. Set SEQDESK_DIR to a new path or remove it."
        exit 1
    fi
    print_warning "Target path already exists: $SEQDESK_DIR"
    overwrite_reply=$(read_input "Backup and replace? (y/N) ")
    if [[ ! "$overwrite_reply" =~ ^[Yy]$ ]]; then
        print_error "Installation cancelled"
        exit 1
    fi
    EXISTING_BACKUP_PATH="${SEQDESK_DIR}.backup.$(date +%Y%m%d%H%M%S)"
    mv "$SEQDESK_DIR" "$EXISTING_BACKUP_PATH"
    print_success "Moved existing install to $EXISTING_BACKUP_PATH"
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

install_source_node_modules

if [ ! -x "./node_modules/.bin/next" ]; then
    print_error "next CLI is missing after dependency install (node_modules/.bin/next)."
    print_error "Run 'npm ci' manually in $SEQDESK_DIR and retry."
    exit 1
fi

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
    prompt_value SEQDESK_PORT "App port" "8000"
fi

if [ -z "$SEQDESK_PORT" ]; then
    SEQDESK_PORT="8000"
fi
if [ -z "$SEQDESK_NEXTAUTH_URL" ]; then
    SEQDESK_NEXTAUTH_URL="http://localhost:${SEQDESK_PORT}"
fi

configure_postgres_urls

if [ -z "$SEQDESK_NEXTAUTH_SECRET" ]; then
    SEQDESK_NEXTAUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    print_info "Generated runtime.nextAuthSecret for seqdesk.config.json"
fi

export NEXTAUTH_URL="$SEQDESK_NEXTAUTH_URL"
export NEXTAUTH_SECRET="$SEQDESK_NEXTAUTH_SECRET"
export DATABASE_URL="$SEQDESK_DATABASE_URL"
export DIRECT_URL="$SEQDESK_DATABASE_DIRECT_URL"
if [ -n "$SEQDESK_ANTHROPIC_API_KEY" ]; then
    export ANTHROPIC_API_KEY="$SEQDESK_ANTHROPIC_API_KEY"
fi
if [ -n "$SEQDESK_ADMIN_SECRET" ]; then
    export ADMIN_SECRET="$SEQDESK_ADMIN_SECRET"
fi
if [ -n "$SEQDESK_BLOB_READ_WRITE_TOKEN" ]; then
    export BLOB_READ_WRITE_TOKEN="$SEQDESK_BLOB_READ_WRITE_TOKEN"
fi

write_config "$PIPELINES_ENABLED" "$SEQDESK_DATA_PATH" "$SEQDESK_RUN_DIR"
write_start_script

# Setup database
print_step "Initializing database"

print_info "Running PostgreSQL migrations..."
if ! node scripts/run-prisma.mjs migrate deploy; then
    print_postgres_setup_instructions
    exit 1
fi

print_info "Seeding initial data..."
ensure_seed_dependency "bcryptjs" || true
SEED_OK="false"
if npm run db:seed; then
    SEED_OK="true"
fi
# Fallback: run seed.mjs directly if prisma db seed failed
if [ "$SEED_OK" = "false" ]; then
    print_info "Prisma seed command failed, trying direct seed..."
    if [ -f prisma/seed.mjs ] && node prisma/seed.mjs; then
        SEED_OK="true"
    elif [ -f prisma/seed.js ] && node prisma/seed.js; then
        SEED_OK="true"
    fi
fi
if [ "$SEED_OK" = "true" ]; then
    print_success "Database initialized"
else
    print_info "Seed did not complete during install -- the app will auto-seed on first launch"
fi

if has_infrastructure_overrides; then
    print_info "Applying infrastructure settings to site runtime config..."
    apply_infrastructure_settings
    print_success "Infrastructure settings applied"
fi

# Pipeline environment
print_step "Pipeline environment"

if [ "$PIPELINES_ENABLED" = "true" ]; then
    print_info "Setting up conda environment for pipelines..."
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
    ./scripts/setup-conda-env.sh "${setup_args[@]}"
else
    print_info "Skipped pipeline environment setup"
fi

install_private_metaxpath_if_configured

# Final instructions
print_header "Installation Complete!"

echo -e "${GREEN}SeqDesk has been installed successfully!${NC}"
echo ""
if [ -n "$INSTALLED_VERSION" ]; then
    echo "Installed version: v$INSTALLED_VERSION"
fi
echo "App directory: $SEQDESK_DIR"
if [ -n "$EXISTING_BACKUP_PATH" ]; then
    echo "Previous install backup: $EXISTING_BACKUP_PATH"
fi
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
echo -e "  ${BLUE}./start.sh${NC}"
echo ""
echo "Then open http://localhost:${SEQDESK_PORT:-8000} in your browser."
echo ""
echo "For live source development:"
echo -e "  ${BLUE}PORT=${SEQDESK_PORT:-8000} npm run dev${NC}"
echo ""
echo "Default login credentials:"
echo "  Admin:      admin@example.com / admin"
echo "  Researcher: user@example.com / user"
echo ""
echo "Next steps:"
echo "  1. Log in as admin and configure Data Storage in Admin > Data Storage"
echo "  2. Configure pipeline runtime under Admin > Pipeline Runtime (if enabled)"
echo "  3. See https://www.seqdesk.com/docs for production deployment"
echo ""
echo -e "Documentation: ${BLUE}https://www.seqdesk.com/docs${NC}"
echo -e "Website:       ${BLUE}https://seqdesk.com${NC}"
echo ""
