#!/bin/bash
#
# SeqDesk Installation Script (Distribution)
# https://seqdesk.com
#
# Usage: curl -fsSL https://seqdesk.com/install.sh | bash
# CLI usage: curl -fsSL https://seqdesk.com/install.sh | bash -s -- [options]
#
# Options (environment variables):
#   SEQDESK_DIR=/path/to/install   - Installation directory (default: ./seqdesk)
#   SEQDESK_VERSION=x.x.x          - Specific version (default: latest)
#   SEQDESK_WITH_PIPELINES=1       - Install pipeline dependencies (Conda + Nextflow)
#   SEQDESK_WITH_CONDA=1           - Legacy: install Miniconda + pipeline env
#   SEQDESK_SKIP_DEPS=1            - Deprecated (ignored in distribution installer)
#   SEQDESK_YES=1                  - Non-interactive; accept defaults
#   SEQDESK_DATA_PATH=/data        - Optional sequencing data base path override
#   SEQDESK_RUN_DIR=/data/runs     - Optional pipeline run directory override
#   SEQDESK_PORT=8000              - App port (default: 8000)
#   SEQDESK_NEXTAUTH_URL=https://  - Optional NextAuth URL override
#   SEQDESK_DATABASE_URL=postgres  - Optional database URL
#   SEQDESK_ANTHROPIC_API_KEY=...  - Optional Anthropic API key
#   SEQDESK_ADMIN_SECRET=...       - Optional admin secret
#   SEQDESK_BLOB_READ_WRITE_TOKEN=... - Optional Blob token
#   SEQDESK_LOG=/path/install.log  - Optional install log path
#   SEQDESK_USE_PM2=1             - Start with PM2 for auto-restart (recommended)
#   SEQDESK_CONFIG=/path/or/url    - Optional infra JSON (flat or nested keys)
#   SEQDESK_RECONFIGURE=1          - Reconfigure existing install in place (repeatable)
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
SEQDESK_ANTHROPIC_API_KEY="${SEQDESK_ANTHROPIC_API_KEY:-}"
SEQDESK_ADMIN_SECRET="${SEQDESK_ADMIN_SECRET:-}"
SEQDESK_BLOB_READ_WRITE_TOKEN="${SEQDESK_BLOB_READ_WRITE_TOKEN:-}"
SEQDESK_LOG="${SEQDESK_LOG:-}"
SEQDESK_USE_PM2="${SEQDESK_USE_PM2:-}"
SEQDESK_CONFIG="${SEQDESK_CONFIG:-}"
SEQDESK_RECONFIGURE="${SEQDESK_RECONFIGURE:-}"
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

PM2_CONFIGURED="false"
PM2_STARTUP_ENABLED="false"
PM2_PROCESS_EXISTS="false"

MIN_NODE_VERSION=18
INSTALL_START_TS=$(date +%s)
INSTALL_STARTED_AT=$(date '+%Y-%m-%d %H:%M:%S %Z')
TOTAL_STEPS=9
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
  --version <version>          Release version (default: latest)
  --with-pipelines             Enable pipeline dependencies
  --without-pipelines          Disable pipeline dependencies
  --skip-deps                  Deprecated (ignored in distribution installer)
  --port <port>                App port
  --data-path <path>           Sequencing data directory
  --run-dir <path>             Pipeline run directory
  --nextauth-url <url>         NEXTAUTH_URL override
  --database-url <url>         DATABASE_URL override
  --anthropic-api-key <key>    ANTHROPIC_API_KEY override
  --admin-secret <secret>      ADMIN_SECRET override
  --blob-read-write-token <token>  BLOB_READ_WRITE_TOKEN override
  --use-pm2                    Enable PM2 auto-restart setup
  --no-pm2                     Disable PM2 setup
  --reconfigure                Reconfigure an existing install in place
  -h, --help                   Show this help

Examples:
  curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y
  curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y --config https://example.org/infrastructure-setup.json
  curl -fsSL https://seqdesk.com/install.sh | bash -s -- -y --reconfigure --config ./infrastructure-setup.json
EOF
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
            --nextauth-url)
                if [ $# -lt 2 ]; then
                    print_error "Missing value for --nextauth-url"
                    exit 1
                fi
                SEQDESK_NEXTAUTH_URL="$2"
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
            --use-pm2)
                SEQDESK_USE_PM2="1"
                ;;
            --no-pm2)
                SEQDESK_USE_PM2="0"
                ;;
            --reconfigure)
                SEQDESK_RECONFIGURE="1"
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
  databaseUrl: toOptionalString(
    firstDefined(root.databaseUrl, app?.databaseUrl, runtime?.databaseUrl)
  ),
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
if (values.databaseUrl) out.SEQDESK_CFG_DATABASE_URL = values.databaseUrl;
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
    apply_config_value SEQDESK_DATABASE_URL SEQDESK_CFG_DATABASE_URL
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
    unset SEQDESK_CFG_NEXTAUTH_URL SEQDESK_CFG_DATABASE_URL SEQDESK_CFG_WITH_PIPELINES
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

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

const envPath = path.join(installDir, ".env");
const configPath = path.join(installDir, "seqdesk.config.json");
const envValues = parseEnvFile(envPath);

let config = {};
if (fs.existsSync(configPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      config = parsed;
    }
  } catch {
    // Ignore malformed existing config and keep defaults empty.
  }
}

const port = trimString(envValues.PORT);
const runtime = config && typeof config.runtime === "object" ? config.runtime : {};
const nextAuthUrl =
  trimString(runtime.nextAuthUrl) || trimString(envValues.NEXTAUTH_URL);
const databaseUrl =
  trimString(runtime.databaseUrl) || trimString(envValues.DATABASE_URL);
const dataPath = trimString(config?.site?.dataBasePath);
const runDir = trimString(config?.pipelines?.execution?.runDirectory);

let withPipelines;
if (typeof config?.pipelines?.enabled === "boolean") {
  withPipelines = config.pipelines.enabled ? "1" : "0";
}

const out = {};
if (port) out.SEQDESK_EXISTING_PORT = port;
if (nextAuthUrl) out.SEQDESK_EXISTING_NEXTAUTH_URL = nextAuthUrl;
if (databaseUrl) out.SEQDESK_EXISTING_DATABASE_URL = databaseUrl;
if (dataPath) out.SEQDESK_EXISTING_DATA_PATH = dataPath;
if (runDir) out.SEQDESK_EXISTING_RUN_DIR = runDir;
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
    apply_config_value SEQDESK_DATABASE_URL SEQDESK_EXISTING_DATABASE_URL
    apply_config_value SEQDESK_DATA_PATH SEQDESK_EXISTING_DATA_PATH
    apply_config_value SEQDESK_RUN_DIR SEQDESK_EXISTING_RUN_DIR
    apply_config_value SEQDESK_WITH_PIPELINES SEQDESK_EXISTING_WITH_PIPELINES

    unset SEQDESK_EXISTING_PORT SEQDESK_EXISTING_NEXTAUTH_URL
    unset SEQDESK_EXISTING_DATABASE_URL SEQDESK_EXISTING_DATA_PATH
    unset SEQDESK_EXISTING_RUN_DIR SEQDESK_EXISTING_WITH_PIPELINES
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
    print_kv "Data path" "${SEQDESK_DATA_PATH:-configure later in Admin > Data Storage}"
    if [ "$PIPELINES_ENABLED" = "true" ]; then
        print_kv "Run directory" "${SEQDESK_RUN_DIR:-configure later in Admin > Pipeline Runtime}"
    else
        print_kv "Run directory" "not used"
    fi
    print_kv "Port" "${SEQDESK_PORT:-8000}"
    print_kv "NEXTAUTH_URL" "${SEQDESK_NEXTAUTH_URL:-http://localhost:${SEQDESK_PORT:-8000}}"
    print_kv "DATABASE_URL" "${SEQDESK_DATABASE_URL:-default sqlite}"
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

print_node_install_instructions() {
    print_warning "Automatic system package installation is disabled."
    print_info "Install Node.js ${MIN_NODE_VERSION}+ manually, then re-run this installer."
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

install_runtime_node_modules() {
    if [ -x "./node_modules/.bin/next" ]; then
        print_info "Runtime Node dependencies already available."
        return 0
    fi

    if [ -f package-lock.json ]; then
        print_info "Running npm ci --omit=dev..."
        npm ci --omit=dev --no-audit --no-fund
    else
        print_warning "package-lock.json not found, falling back to npm install --omit=dev."
        npm install --omit=dev --no-audit --no-fund
    fi

    if [ ! -x "./node_modules/.bin/next" ]; then
        print_error "next CLI is missing after dependency install (node_modules/.bin/next)."
        print_error "Run 'npm install --omit=dev' manually in $SEQDESK_DIR and retry."
        exit 1
    fi

    print_success "Runtime Node dependencies installed"
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
    SEQDESK_WIZARD_DEFAULT_PORT="${SEQDESK_PORT:-8000}" \
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
    SEQDESK_INSTALL_DATABASE_URL="${SEQDESK_DATABASE_URL:-}" \
    node <<'NODE'
const fs = require('fs');

const dataPath = process.env.SEQDESK_INSTALL_DATA_PATH || '';
const runDir = process.env.SEQDESK_INSTALL_RUN_DIR || '';
const pipelinesEnabled = process.env.SEQDESK_INSTALL_PIPELINES_ENABLED || '';
const nextAuthUrl = process.env.SEQDESK_INSTALL_NEXTAUTH_URL || '';
const databaseUrl = process.env.SEQDESK_INSTALL_DATABASE_URL || '';

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`ERROR: Failed to parse ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const parsed = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

function toOptionalString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const config = readJson('seqdesk.config.json') || {};
if (!config.$schema) config.$schema = './docs/seqdesk-config-schema.json';

config.site = config.site || {};
if (dataPath) config.site.dataBasePath = dataPath;

config.pipelines = config.pipelines || {};
if (pipelinesEnabled) config.pipelines.enabled = pipelinesEnabled === 'true';

if (runDir) {
  config.pipelines.execution = config.pipelines.execution || {};
  if (!config.pipelines.execution.mode) config.pipelines.execution.mode = 'local';
  config.pipelines.execution.runDirectory = runDir;
}

const envValues = readDotEnv('.env');
const nextAuthSecret = toOptionalString(envValues.NEXTAUTH_SECRET);
const anthropicApiKey = toOptionalString(envValues.ANTHROPIC_API_KEY);
const adminSecret = toOptionalString(envValues.ADMIN_SECRET);
const blobReadWriteToken = toOptionalString(envValues.BLOB_READ_WRITE_TOKEN);

const runtime = config.runtime && typeof config.runtime === 'object' ? config.runtime : {};
if (nextAuthUrl) runtime.nextAuthUrl = nextAuthUrl;
if (databaseUrl) runtime.databaseUrl = databaseUrl;
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

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "file:./dev.db";
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
    echo ""
    print_error "Installer failed."
    print_info "Command: ${BASH_COMMAND}"
    print_info "Exit code: ${exit_code}"
    if [ -n "$SEQDESK_LOG" ]; then
        print_info "Log: $SEQDESK_LOG"
    else
        print_info "Tip: re-run with SEQDESK_LOG=/tmp/seqdesk-install.log"
    fi
    print_info "Common fixes: check network access, Node.js prerequisites, and disk space."
    exit $exit_code
}

parse_args "$@"
SEQDESK_DIR="${SEQDESK_DIR/#\~/$HOME}"
SEQDESK_DIR="$(resolve_absolute_dir "$SEQDESK_DIR")"

if is_truthy "$SEQDESK_RECONFIGURE" && [ ! -d "$SEQDESK_DIR" ]; then
    print_error "Reconfigure mode requires an existing installation directory: $SEQDESK_DIR"
    exit 1
fi

trap on_error ERR

if [ -n "$SEQDESK_LOG" ]; then
    mkdir -p "$(dirname "$SEQDESK_LOG")" 2>/dev/null || true
    exec > >(tee -a "$SEQDESK_LOG") 2>&1
fi

if [ -z "$SEQDESK_YES" ] && [ ! -t 0 ] && [ ! -t 1 ]; then
    print_error "No interactive TTY detected. Use -y (or SEQDESK_YES=1) for automated installs."
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

if is_truthy "$SEQDESK_SKIP_DEPS"; then
    print_warning "--skip-deps is deprecated for the distribution installer and is ignored."
fi

if [ -n "$node_install_reason" ]; then
    if [ "$node_install_reason" = "missing" ]; then
        print_error "Node.js $MIN_NODE_VERSION+ is required but was not found."
    else
        print_error "Node.js ${MIN_NODE_VERSION}+ is required (found v$NODE_VERSION)."
    fi
    print_node_install_instructions
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

if [ -n "$SEQDESK_CONFIG" ]; then
    print_info "Loading installer config: $SEQDESK_CONFIG"
    load_install_config "$SEQDESK_CONFIG"
    print_success "Loaded installer config"
fi

if is_truthy "$SEQDESK_RECONFIGURE"; then
    print_info "Reconfigure mode: loading defaults from existing installation"
    load_existing_install_values "$SEQDESK_DIR"
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

LATEST_VERSION=""
TEMP_FILE=""
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

    if command_exists stdbuf; then
        curl -fL "$DOWNLOAD_URL" -o "$TEMP_FILE" --progress-bar 2>&1 | \
            stdbuf -oL tr '\r' '\n' | \
            while IFS= read -r line; do
                if [[ "$line" =~ ([0-9]+)\.([0-9]+)% ]]; then
                    percent="${BASH_REMATCH[1]}"
                    printf "\r  Downloading: [%-40s] %3d%%" "$(printf '#%.0s' $(seq 1 $((percent * 40 / 100))))" "$percent"
                fi
            done
    else
        curl -fL "$DOWNLOAD_URL" -o "$TEMP_FILE" --progress-bar 2>&1 | \
            tr '\r' '\n' | \
            while IFS= read -r line; do
                if [[ "$line" =~ ([0-9]+)\.([0-9]+)% ]]; then
                    percent="${BASH_REMATCH[1]}"
                    printf "\r  Downloading: [%-40s] %3d%%" "$(printf '#%.0s' $(seq 1 $((percent * 40 / 100))))" "$percent"
                fi
            done
    fi

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
fi

# Extract
print_step "Extracting package"

if is_truthy "$SEQDESK_RECONFIGURE"; then
    if [ ! -d "$SEQDESK_DIR" ]; then
        print_error "Reconfigure mode requires an existing installation directory: $SEQDESK_DIR"
        exit 1
    fi
    print_success "Using existing installation: $SEQDESK_DIR"
else
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
fi

cd "$SEQDESK_DIR"

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
print_step "Installing runtime Node dependencies"
install_runtime_node_modules

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
PORT=8000
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
set_env_var "ANTHROPIC_API_KEY" "$SEQDESK_ANTHROPIC_API_KEY"
set_env_var "ADMIN_SECRET" "$SEQDESK_ADMIN_SECRET"
set_env_var "BLOB_READ_WRITE_TOKEN" "$SEQDESK_BLOB_READ_WRITE_TOKEN"
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
ensure_seed_dependency "bcryptjs" || true
SEED_OK="false"
if [ -x "$PRISMA_CLI" ]; then
    if "$PRISMA_CLI" db seed; then
        SEED_OK="true"
    fi
elif [ -n "$PRISMA_VERSION" ]; then
    print_info "Using Prisma CLI v$PRISMA_VERSION for seeding"
    if npx prisma@"$PRISMA_VERSION" db seed; then
        SEED_OK="true"
    fi
else
    if npx prisma db seed; then
        SEED_OK="true"
    fi
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
    ./scripts/setup-conda-env.sh "${setup_args[@]}"
else
    print_info "Skipped pipeline environment setup"
fi

install_private_metaxpath_if_configured

print_step "Process manager"

if [ -z "$SEQDESK_USE_PM2" ]; then
    if is_truthy "$SEQDESK_RECONFIGURE"; then
        if command_exists pm2 && pm2 describe seqdesk >/dev/null 2>&1; then
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
    if ! command_exists pm2; then
        print_info "Installing PM2 (requires npm)..."
        if npm install -g pm2; then
            print_success "PM2 installed"
        else
            print_warning "PM2 install failed. You may need to run: npm install -g pm2"
        fi
    fi

    if command_exists pm2; then
        if [ "$PM2_PROCESS_EXISTS" != "true" ] && pm2 describe seqdesk >/dev/null 2>&1; then
            PM2_PROCESS_EXISTS="true"
        fi

        if [ "$PM2_PROCESS_EXISTS" = "true" ]; then
            print_info "Restarting existing SeqDesk PM2 process..."
            if pm2 restart seqdesk; then
                PM2_CONFIGURED="true"
                pm2 save >/dev/null 2>&1 || print_warning "Could not save PM2 process list (run: pm2 save)"
                print_success "PM2 process restarted"
            else
                print_warning "PM2 failed to restart seqdesk. You can restart manually with: pm2 restart seqdesk"
            fi
        else
            print_info "Starting SeqDesk with PM2..."
            if pm2 start "$SEQDESK_DIR/start.sh" --name seqdesk; then
                PM2_CONFIGURED="true"
                pm2 save >/dev/null 2>&1 || print_warning "Could not save PM2 process list (run: pm2 save)"
                if pm2 startup >/dev/null 2>&1; then
                    PM2_STARTUP_ENABLED="true"
                else
                    print_warning "PM2 boot startup is not enabled yet. Run: pm2 startup"
                fi
                print_success "PM2 configured for auto-restart"
            else
                print_warning "PM2 failed to start SeqDesk. You can start manually with ./start.sh"
            fi
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
if is_truthy "$SEQDESK_RECONFIGURE"; then
    echo "Mode: reconfigure existing install"
fi
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
    echo "  pm2 restart seqdesk"
    echo ""
    echo "Recommended run mode:"
    echo "  Keep SeqDesk running under PM2."
    echo "  ./start.sh is manual/foreground mode and does not provide PM2 restart behavior."
    echo ""
    echo "If the PM2 process was removed (for example with 'pm2 delete'):"
    echo "  pm2 start \"$SEQDESK_DIR/start.sh\" --name seqdesk"
    echo "  pm2 save"
    if [ "$PM2_STARTUP_ENABLED" != "true" ]; then
        echo ""
        echo "Enable PM2 on reboot (one-time):"
        echo "  pm2 startup"
        echo "  # then run the sudo command printed by pm2 startup"
        echo "  pm2 save"
    fi
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
echo "Open http://localhost:${SEQDESK_PORT:-8000}"
echo ""
echo "Default login:"
echo "  Email:    admin@example.com"
echo "  Password: admin"
echo ""
echo "Next steps:"
echo "  1. Log in as admin and configure Data Storage in Admin > Data Storage"
echo "  2. Configure pipeline runtime under Admin > Pipeline Runtime (if enabled)"
echo ""
