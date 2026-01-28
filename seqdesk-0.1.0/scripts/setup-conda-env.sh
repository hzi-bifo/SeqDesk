#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${SEQDESK_CONDA_ENV:-seqdesk-pipelines}"
CONDA_PATH="${SEQDESK_CONDA_PATH:-}"
PYTHON_VERSION="3.11"
YES=0
REMOVE_DEFAULTS=1
STRICT_PRIORITY=1
FORCE_RECREATE=0
DRY_RUN=0
WRITE_CONFIG=0
CREATE_DIRS=0
RUN_TESTS=1
RUN_PIPELINE_TEST=0
TEST_OUTDIR=""
EXECUTION_MODE=""
PIPELINES_ENABLED=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_PATH="${REPO_ROOT}/seqdesk.config.json"
CONFIG_TEMPLATE="${REPO_ROOT}/seqdesk.config.example.json"
DATA_PATH=""
RUN_DIR=""
SITE_NAME=""
CONTACT_EMAIL=""

usage() {
  cat <<'EOF'
Usage: scripts/setup-conda-env.sh [options]

Sets up the Conda environment used by SeqDesk pipelines, and can optionally
write SeqDesk config and run sanity tests.

Options:
  --full                Run conda setup, write config, create dirs, run tests
  --env NAME            Conda environment name (default: seqdesk-pipelines)
  --conda-path PATH     Conda base path (e.g., /opt/miniconda3)
  --python VERSION      Python version for the env (default: 3.11)
  --keep-defaults       Do not remove the "defaults" channel
  --no-strict           Do not set channel_priority strict
  --force               Recreate the env if it already exists
  --write-config         Create/update seqdesk.config.json
  --config-path PATH     Config file path (default: seqdesk.config.json)
  --data-path PATH       Sequencing data base path (default: ./data)
  --run-dir PATH         Pipeline run directory (default: ./pipeline_runs)
  --site-name NAME       Facility name
  --contact-email EMAIL  Facility contact email
  --mode MODE            Execution mode: local|slurm|kubernetes
  --pipelines-enabled    Set pipelines.enabled=true
  --pipelines-disabled   Set pipelines.enabled=false
  --create-dirs          Create data/run directories (if paths provided)
  --skip-tests           Skip sanity tests
  --test-pipeline        Run nf-core/mag test profile (Linux only)
  --no-test-pipeline     Skip nf-core pipeline test (default)
  --test-outdir PATH     Output directory for pipeline test (default: ./pipeline_test_out)
  --yes                 Non-interactive (assume yes)
  --dry-run             Print commands without executing
  -h, --help            Show this help

Environment variables:
  SEQDESK_CONDA_ENV      Overrides --env
  SEQDESK_CONDA_PATH     Overrides --conda-path
EOF
}

log() {
  printf '%s\n' "$*"
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '+ %s\n' "$*"
    return 0
  fi
  "$@"
}

confirm() {
  if [[ "$YES" -eq 1 ]]; then
    return 0
  fi
  local prompt="${1:-Continue?} [y/N] "
  read -r -p "$prompt" reply
  [[ "${reply:-}" == "y" || "${reply:-}" == "Y" ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)
      WRITE_CONFIG=1
      CREATE_DIRS=1
      RUN_TESTS=1
      RUN_PIPELINE_TEST=1
      shift
      ;;
    --env)
      ENV_NAME="${2:-}"
      shift 2
      ;;
    --conda-path)
      CONDA_PATH="${2:-}"
      shift 2
      ;;
    --python)
      PYTHON_VERSION="${2:-}"
      shift 2
      ;;
    --keep-defaults)
      REMOVE_DEFAULTS=0
      shift
      ;;
    --no-strict)
      STRICT_PRIORITY=0
      shift
      ;;
    --force)
      FORCE_RECREATE=1
      shift
      ;;
    --write-config)
      WRITE_CONFIG=1
      shift
      ;;
    --config-path)
      CONFIG_PATH="${2:-}"
      shift 2
      ;;
    --data-path)
      DATA_PATH="${2:-}"
      shift 2
      ;;
    --run-dir)
      RUN_DIR="${2:-}"
      shift 2
      ;;
    --site-name)
      SITE_NAME="${2:-}"
      shift 2
      ;;
    --contact-email)
      CONTACT_EMAIL="${2:-}"
      shift 2
      ;;
    --mode)
      EXECUTION_MODE="${2:-}"
      shift 2
      ;;
    --pipelines-enabled)
      PIPELINES_ENABLED="true"
      shift
      ;;
    --pipelines-disabled)
      PIPELINES_ENABLED="false"
      shift
      ;;
    --create-dirs)
      CREATE_DIRS=1
      shift
      ;;
    --skip-tests)
      RUN_TESTS=0
      shift
      ;;
    --test-pipeline)
      RUN_PIPELINE_TEST=1
      shift
      ;;
    --no-test-pipeline)
      RUN_PIPELINE_TEST=0
      shift
      ;;
    --test-outdir)
      TEST_OUTDIR="${2:-}"
      shift 2
      ;;
    --yes)
      YES=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${ENV_NAME}" ]]; then
  log "ERROR: --env cannot be empty"
  exit 1
fi

EXEC_CWD="$(pwd)"
if [[ -z "${DATA_PATH}" ]]; then
  DATA_PATH="${EXEC_CWD}/data"
fi
if [[ -z "${RUN_DIR}" ]]; then
  RUN_DIR="${EXEC_CWD}/pipeline_runs"
fi
if [[ -z "${TEST_OUTDIR}" ]]; then
  TEST_OUTDIR="${EXEC_CWD}/pipeline_test_out"
fi

OS_NAME="$(uname -s)"
if [[ "$RUN_PIPELINE_TEST" -eq 1 && "${OS_NAME}" != "Linux" ]]; then
  log "Pipeline tests are Linux-only. Skipping on ${OS_NAME}."
  RUN_PIPELINE_TEST=0
fi

if [[ -n "${EXECUTION_MODE}" ]]; then
  case "${EXECUTION_MODE}" in
    local|slurm|kubernetes)
      ;;
    *)
      log "ERROR: --mode must be local, slurm, or kubernetes"
      exit 1
      ;;
  esac
fi

CONDA_BIN=""
if [[ -n "${CONDA_PATH}" ]]; then
  for candidate in "${CONDA_PATH}/condabin/conda" "${CONDA_PATH}/bin/conda"; do
    if [[ -x "$candidate" ]]; then
      CONDA_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "${CONDA_BIN}" ]]; then
  if command -v conda >/dev/null 2>&1; then
    CONDA_BIN="conda"
  else
    log "ERROR: conda not found. Install Miniconda/Anaconda first."
    exit 1
  fi
fi

log "Using conda: ${CONDA_BIN}"
log "Environment: ${ENV_NAME}"

CONDA_BASE="$("$CONDA_BIN" info --base 2>/dev/null || true)"
if [[ -n "${CONDA_PATH}" ]]; then
  CONDA_BASE="${CONDA_PATH}"
fi
if [[ -z "${CONDA_BASE}" ]]; then
  log "WARNING: Could not resolve conda base path."
fi

if [[ "$REMOVE_DEFAULTS" -eq 1 || "$STRICT_PRIORITY" -eq 1 ]]; then
  log "This will update your conda channel configuration."
  if ! confirm; then
    log "Aborted."
    exit 1
  fi
fi

if [[ "$REMOVE_DEFAULTS" -eq 1 ]]; then
  run "$CONDA_BIN" config --remove channels defaults >/dev/null 2>&1 || true
fi

run "$CONDA_BIN" config --remove channels conda-forge >/dev/null 2>&1 || true
run "$CONDA_BIN" config --remove channels bioconda >/dev/null 2>&1 || true
run "$CONDA_BIN" config --add channels conda-forge
run "$CONDA_BIN" config --add channels bioconda

if [[ "$STRICT_PRIORITY" -eq 1 ]]; then
  run "$CONDA_BIN" config --set channel_priority strict
fi

log "Configured channels:"
run "$CONDA_BIN" config --show channels

ENV_EXISTS=0
if "$CONDA_BIN" env list | awk '{print $1}' | grep -qx "${ENV_NAME}"; then
  ENV_EXISTS=1
  if [[ "$FORCE_RECREATE" -eq 1 ]]; then
    log "Removing existing env: ${ENV_NAME}"
    run "$CONDA_BIN" env remove -n "${ENV_NAME}"
    ENV_EXISTS=0
  else
    log "Env ${ENV_NAME} already exists. Updating packages."
    run "$CONDA_BIN" install -y -n "${ENV_NAME}" \
      -c conda-forge -c bioconda \
      "python=${PYTHON_VERSION}" \
      "openjdk=17" \
      nextflow \
      nf-core
  fi
fi

if [[ "$ENV_EXISTS" -eq 0 ]]; then
  log "Creating env ${ENV_NAME}..."
  run "$CONDA_BIN" create -y -n "${ENV_NAME}" \
    -c conda-forge -c bioconda \
    "python=${PYTHON_VERSION}" \
    "openjdk=17" \
    nextflow \
    nf-core
fi

log "Done. Activate with:"
log "  conda activate ${ENV_NAME}"

if [[ "$WRITE_CONFIG" -eq 1 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would write config to ${CONFIG_PATH}"
  elif ! command -v node >/dev/null 2>&1; then
    log "WARNING: node not found; cannot write config. Install Node.js or update config manually."
  else
    log "Writing config: ${CONFIG_PATH}"
    SEQDESK_CONFIG_PATH="${CONFIG_PATH}" \
    SEQDESK_CONFIG_TEMPLATE="${CONFIG_TEMPLATE}" \
    SEQDESK_SITE_NAME="${SITE_NAME}" \
    SEQDESK_CONTACT_EMAIL="${CONTACT_EMAIL}" \
    SEQDESK_DATA_PATH="${DATA_PATH}" \
    SEQDESK_RUN_DIR="${RUN_DIR}" \
    SEQDESK_EXEC_MODE="${EXECUTION_MODE}" \
    SEQDESK_PIPELINES_ENABLED="${PIPELINES_ENABLED}" \
    SEQDESK_CONDA_BASE="${CONDA_BASE}" \
    SEQDESK_CONDA_ENV_NAME="${ENV_NAME}" \
    node <<'NODE'
const fs = require('fs');
const path = require('path');

const configPath = process.env.SEQDESK_CONFIG_PATH || 'seqdesk.config.json';
const templatePath = process.env.SEQDESK_CONFIG_TEMPLATE || 'seqdesk.config.example.json';

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`ERROR: Failed to parse ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

const config = readJson(configPath) || readJson(templatePath) || {};

config.site = config.site || {};
if (process.env.SEQDESK_SITE_NAME) config.site.name = process.env.SEQDESK_SITE_NAME;
if (process.env.SEQDESK_CONTACT_EMAIL) config.site.contactEmail = process.env.SEQDESK_CONTACT_EMAIL;
if (process.env.SEQDESK_DATA_PATH) config.site.dataBasePath = process.env.SEQDESK_DATA_PATH;

config.pipelines = config.pipelines || {};
if (process.env.SEQDESK_PIPELINES_ENABLED) {
  config.pipelines.enabled = process.env.SEQDESK_PIPELINES_ENABLED === 'true';
}

config.pipelines.execution = config.pipelines.execution || {};
if (process.env.SEQDESK_EXEC_MODE) config.pipelines.execution.mode = process.env.SEQDESK_EXEC_MODE;
if (process.env.SEQDESK_RUN_DIR) config.pipelines.execution.runDirectory = process.env.SEQDESK_RUN_DIR;

config.pipelines.execution.conda = config.pipelines.execution.conda || {};
config.pipelines.execution.conda.enabled = true;
if (process.env.SEQDESK_CONDA_BASE) config.pipelines.execution.conda.path = process.env.SEQDESK_CONDA_BASE;
if (process.env.SEQDESK_CONDA_ENV_NAME) config.pipelines.execution.conda.environment = process.env.SEQDESK_CONDA_ENV_NAME;

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`Wrote ${configPath}`);
NODE
  fi
fi

if [[ "$CREATE_DIRS" -eq 1 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would create data/run directories"
  else
  for dir in "${DATA_PATH}" "${RUN_DIR}"; do
    if [[ -z "${dir}" ]]; then
      continue
    fi
    if [[ -d "${dir}" ]]; then
      log "Directory exists: ${dir}"
    else
      if mkdir -p "${dir}" 2>/dev/null; then
        log "Created directory: ${dir}"
      else
        log "WARNING: Could not create directory: ${dir}"
      fi
    fi
  done
  fi
fi

if [[ "$RUN_TESTS" -eq 1 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would run sanity tests"
  else
    log "Running sanity tests..."
    run "$CONDA_BIN" --version
    run "$CONDA_BIN" config --show channels
    run "$CONDA_BIN" run -n "${ENV_NAME}" nextflow -version
    run "$CONDA_BIN" run -n "${ENV_NAME}" nf-core --version
    run "$CONDA_BIN" run -n "${ENV_NAME}" java -version
  fi

  if [[ "$RUN_PIPELINE_TEST" -eq 1 ]]; then
    if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
      log "WARNING: Running pipeline test on macOS ARM may fail."
    else
      :
    fi
    if [[ "$DRY_RUN" -eq 0 ]]; then
      run "$CONDA_BIN" run -n "${ENV_NAME}" nextflow run nf-core/mag -profile test,conda -stub --outdir "${TEST_OUTDIR}"
    fi
  fi
fi
