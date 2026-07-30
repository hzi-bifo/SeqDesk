#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${SEQDESK_CONDA_ENV:-seqdesk-pipelines}"
CONDA_PATH="${SEQDESK_CONDA_PATH:-}"
PYTHON_VERSION="3.11"
INSTALL_MINICONDA=0
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
# A13: read AND write the SAME runtime config the installer already wrote
# (settings.json on fresh installs, seqdesk.config.json on legacy upgrades) so the
# conda/execution settings land in the canonical file — never a second, orphaned one.
if [[ -f "${REPO_ROOT}/settings.json" ]]; then
  CONFIG_PATH="${REPO_ROOT}/settings.json"
elif [[ -f "${REPO_ROOT}/seqdesk.config.json" ]]; then
  CONFIG_PATH="${REPO_ROOT}/seqdesk.config.json"
else
  CONFIG_PATH="${REPO_ROOT}/settings.json"
fi
CONFIG_TEMPLATE="${REPO_ROOT}/seqdesk.config.example.json"
DATA_PATH=""
RUN_DIR=""
SITE_NAME=""
CONTACT_EMAIL=""
MINICONDA_TEMP_FILE=""
MINICONDA_TEMP_DIR=""
RUNTIME_SETUP_LOCK_DIR=""
RUNTIME_SETUP_LOCK_TOKEN=""
RUNTIME_SETUP_LOCK_ACQUIRED=0
RUNTIME_SETUP_LOCK_TIMEOUT="${SEQDESK_RUNTIME_SETUP_LOCK_TIMEOUT:-900}"
SEQDESK_MINICONDA_BASE_URL="${SEQDESK_MINICONDA_BASE_URL:-https://repo.anaconda.com/miniconda}"
SEQDESK_MINICONDA_INSTALLER="${SEQDESK_MINICONDA_INSTALLER:-}"
SEQDESK_CURL_CONNECT_TIMEOUT="${SEQDESK_CURL_CONNECT_TIMEOUT:-10}"
SEQDESK_CURL_RETRIES="${SEQDESK_CURL_RETRIES:-2}"

usage() {
  cat <<'EOF'
Usage: scripts/setup-conda-env.sh [options]

Sets up the Conda environment used by SeqDesk pipelines, and can optionally
write SeqDesk config and run sanity tests.

Options:
  --full                Run conda setup, write config, create dirs, run tests
  --env NAME            Conda environment name (default: seqdesk-pipelines)
  --conda-path PATH     Conda base path (e.g., /opt/miniconda3)
  --install-miniconda   Install a managed Miniconda base when Conda is missing
  --python VERSION      Python version for the env (default: 3.11)
  --keep-defaults       Include configured/default channels for env operations
  --no-strict           Do not enforce strict priority for env operations
  --force               Recreate the env if it already exists
  --write-config         Create/update seqdesk.config.json
  --config-path PATH     Config file path (default: settings.json, else seqdesk.config.json)
  --data-path PATH       Sequencing data base path (default: ./data)
  --run-dir PATH         Pipeline run directory (default: ./pipeline_runs)
  --site-name NAME       Facility name
  --contact-email EMAIL  Facility contact email
  --mode MODE            Execution mode: local|slurm
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
  SEQDESK_MINICONDA_BASE_URL
                           Miniconda download mirror/base URL
  SEQDESK_MINICONDA_INSTALLER
                           Exact Miniconda installer file name
  SEQDESK_RUNTIME_SETUP_LOCK_TIMEOUT
                           Seconds to wait for another setup (default: 900)
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

normalize_conda_path() {
  local value="$1"
  while [[ "${value}" != "/" && "${value}" == */ ]]; do
    value="${value%/}"
  done
  printf '%s\n' "${value}"
}

absolute_conda_path() {
  local value="$1"
  case "${value}" in
    "~")
      value="${HOME}"
      ;;
    "~/"*)
      value="${HOME}/${value#\~/}"
      ;;
  esac
  if [[ "${value}" != /* ]]; then
    value="${EXEC_CWD}/${value#./}"
  fi
  normalize_conda_path "${value}"
}

path_exists_or_symlink() {
  [[ -e "$1" || -L "$1" ]]
}

find_conda_in_prefix() {
  local prefix
  local candidate
  prefix="$(normalize_conda_path "$1")"
  [[ -n "${prefix}" ]] || return 1
  for candidate in "${prefix}/condabin/conda" "${prefix}/bin/conda"; do
    if [[ -x "${candidate}" ]] && "${candidate}" --version >/dev/null 2>&1; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

select_miniconda_installer() {
  local os_name="$1"
  local arch_name="$2"
  case "${os_name}:${arch_name}" in
    Linux:x86_64|Linux:amd64)
      printf '%s\n' "Miniconda3-latest-Linux-x86_64.sh"
      ;;
    Linux:aarch64|Linux:arm64)
      printf '%s\n' "Miniconda3-latest-Linux-aarch64.sh"
      ;;
    Darwin:x86_64|Darwin:amd64)
      printf '%s\n' "Miniconda3-latest-MacOSX-x86_64.sh"
      ;;
    Darwin:arm64|Darwin:aarch64)
      printf '%s\n' "Miniconda3-latest-MacOSX-arm64.sh"
      ;;
    *)
      return 1
      ;;
  esac
}

cleanup_miniconda_download() {
  if [[ -n "${MINICONDA_TEMP_FILE}" ]]; then
    rm -f "${MINICONDA_TEMP_FILE}" 2>/dev/null || true
    MINICONDA_TEMP_FILE=""
  fi
  if [[ -n "${MINICONDA_TEMP_DIR}" ]]; then
    rmdir "${MINICONDA_TEMP_DIR}" 2>/dev/null || true
    MINICONDA_TEMP_DIR=""
  fi
}

release_runtime_setup_lock() {
  local owner_file
  local current_owner

  if [[ "${RUNTIME_SETUP_LOCK_ACQUIRED}" -ne 1 ]]; then
    return
  fi

  owner_file="${RUNTIME_SETUP_LOCK_DIR}/owner"
  current_owner=""
  if [[ -f "${owner_file}" && ! -L "${owner_file}" ]]; then
    IFS= read -r current_owner < "${owner_file}" || true
  fi

  if [[ "${current_owner}" == "$$:${RUNTIME_SETUP_LOCK_TOKEN}" ]]; then
    rm -f "${owner_file}" 2>/dev/null || true
    if ! rmdir "${RUNTIME_SETUP_LOCK_DIR}" 2>/dev/null; then
      log "WARNING: Runtime setup lock contains unexpected files and was left in place: ${RUNTIME_SETUP_LOCK_DIR}"
    fi
  fi

  RUNTIME_SETUP_LOCK_ACQUIRED=0
}

cleanup_runtime_setup() {
  cleanup_miniconda_download
  release_runtime_setup_lock
}

acquire_runtime_setup_lock() {
  local owner_file
  local owner_line
  local owner_pid
  local owner_token
  local current_owner
  local wait_started
  local wait_announced

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    return
  fi

  case "${RUNTIME_SETUP_LOCK_TIMEOUT}" in
    ""|*[!0-9]*)
      log "ERROR: SEQDESK_RUNTIME_SETUP_LOCK_TIMEOUT must be a non-negative integer."
      exit 1
      ;;
  esac

  RUNTIME_SETUP_LOCK_DIR="${SEQDESK_RUNTIME_SETUP_LOCK_DIR:-${EXEC_CWD}/.seqdesk-runtime-setup.lock}"
  RUNTIME_SETUP_LOCK_TOKEN="$(date +%s)-${RANDOM}-${RANDOM}"
  owner_file="${RUNTIME_SETUP_LOCK_DIR}/owner"
  wait_started="${SECONDS}"
  wait_announced=0

  while true; do
    if mkdir "${RUNTIME_SETUP_LOCK_DIR}" 2>/dev/null; then
      if ! printf '%s\n' "$$:${RUNTIME_SETUP_LOCK_TOKEN}" > "${owner_file}"; then
        rmdir "${RUNTIME_SETUP_LOCK_DIR}" 2>/dev/null || true
        log "ERROR: Could not initialize runtime setup lock: ${RUNTIME_SETUP_LOCK_DIR}"
        exit 1
      fi
      RUNTIME_SETUP_LOCK_ACQUIRED=1
      trap cleanup_runtime_setup EXIT
      return
    fi

    if [[ -L "${RUNTIME_SETUP_LOCK_DIR}" || ! -d "${RUNTIME_SETUP_LOCK_DIR}" ]]; then
      log "ERROR: Runtime setup lock path is not a directory: ${RUNTIME_SETUP_LOCK_DIR}"
      log "Move that path aside and rerun the SeqDesk command."
      exit 1
    fi

    owner_line=""
    if [[ -f "${owner_file}" && ! -L "${owner_file}" ]]; then
      IFS= read -r owner_line < "${owner_file}" || true
    fi
    owner_pid="${owner_line%%:*}"
    owner_token="${owner_line#*:}"

    if [[ "${owner_line}" == *:* && "${owner_pid}" != *[!0-9]* && -n "${owner_pid}" && -n "${owner_token}" ]]; then
      if ! kill -0 "${owner_pid}" 2>/dev/null; then
        current_owner=""
        IFS= read -r current_owner < "${owner_file}" || true
        if [[ "${current_owner}" == "${owner_line}" ]]; then
          rm -f "${owner_file}" 2>/dev/null || true
          if rmdir "${RUNTIME_SETUP_LOCK_DIR}" 2>/dev/null; then
            log "Recovered stale runtime setup lock from process ${owner_pid}."
            continue
          fi
          log "ERROR: Stale runtime setup lock contains unexpected files: ${RUNTIME_SETUP_LOCK_DIR}"
          log "Inspect that directory, remove only stale lock files, and rerun the SeqDesk command."
          exit 1
        fi
      fi
    fi

    if (( SECONDS - wait_started >= RUNTIME_SETUP_LOCK_TIMEOUT )); then
      if [[ -n "${owner_pid}" ]]; then
        log "ERROR: Timed out waiting for runtime setup lock held by process ${owner_pid}."
      else
        log "ERROR: Timed out waiting for runtime setup lock: ${RUNTIME_SETUP_LOCK_DIR}"
      fi
      exit 1
    fi

    if [[ "${wait_announced}" -eq 0 ]]; then
      log "Another SeqDesk runtime setup is already running. Waiting for it to finish..."
      wait_announced=1
    fi
    sleep 1
  done
}

install_managed_miniconda() {
  local install_base="$1"
  local installer_name
  local installer_url
  local temp_root

  if path_exists_or_symlink "${install_base}"; then
    log "ERROR: Conda target exists but is not a working Conda base: ${install_base}"
    log "Choose a new unused path with SEQDESK_CONDA_PATH=/path and rerun the SeqDesk command."
    log "When using this setup script directly, you can instead pass --conda-path."
    exit 1
  fi

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "Dry run: would install Miniconda to ${install_base}"
    exit 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    log "ERROR: curl is required to download Miniconda."
    exit 1
  fi

  if [[ -n "${SEQDESK_MINICONDA_INSTALLER}" ]]; then
    installer_name="${SEQDESK_MINICONDA_INSTALLER}"
  elif ! installer_name="$(select_miniconda_installer "$(uname -s)" "$(uname -m)")"; then
    log "ERROR: No supported Miniconda installer is available for $(uname -s)/$(uname -m)."
    log "Install Conda manually and set SEQDESK_CONDA_PATH to its base path."
    exit 1
  fi

  temp_root="${TMPDIR:-/tmp}"
  temp_root="${temp_root%/}"
  MINICONDA_TEMP_DIR="$(mktemp -d "${temp_root}/seqdesk-miniconda.XXXXXX")"
  # Constructor installers reject filenames without a .sh suffix as if they
  # had been sourced. Keep the download private while retaining that suffix.
  MINICONDA_TEMP_FILE="${MINICONDA_TEMP_DIR}/Miniconda-installer.sh"
  installer_url="${SEQDESK_MINICONDA_BASE_URL%/}/${installer_name}"

  log "Downloading Miniconda: ${installer_url}"
  if ! curl -fsSL \
    --connect-timeout "${SEQDESK_CURL_CONNECT_TIMEOUT}" \
    --retry "${SEQDESK_CURL_RETRIES}" \
    --retry-delay 2 \
    -o "${MINICONDA_TEMP_FILE}" \
    "${installer_url}"; then
    log "ERROR: Miniconda download failed."
    exit 1
  fi

  if ! mkdir -p "$(dirname "${install_base}")"; then
    log "ERROR: Cannot create the parent directory for ${install_base}."
    exit 1
  fi

  log "Installing managed Miniconda to ${install_base}"
  if ! bash "${MINICONDA_TEMP_FILE}" -b -p "${install_base}"; then
    log "ERROR: Miniconda installation failed."
    log "A partial prefix may remain at ${install_base}; SeqDesk will not overwrite it."
    exit 1
  fi

  cleanup_miniconda_download

  if ! CONDA_BIN="$(find_conda_in_prefix "${install_base}")"; then
    log "ERROR: Miniconda finished but no working conda executable was found in ${install_base}."
    exit 1
  fi
  CONDA_PATH="${install_base}"
  log "Managed Miniconda installed: ${install_base}"
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
    --install-miniconda)
      INSTALL_MINICONDA=1
      shift
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
    local|slurm)
      ;;
    *)
      log "ERROR: --mode must be local or slurm"
      exit 1
      ;;
  esac
fi

acquire_runtime_setup_lock

CONDA_BIN=""
if [[ -n "${CONDA_PATH}" ]]; then
  CONDA_PATH="$(absolute_conda_path "${CONDA_PATH}")"
  if ! CONDA_BIN="$(find_conda_in_prefix "${CONDA_PATH}")"; then
    CONDA_BIN=""
    if path_exists_or_symlink "${CONDA_PATH}"; then
      log "ERROR: --conda-path exists but is not a working Conda base: ${CONDA_PATH}"
      log "SeqDesk will not delete or overwrite that path."
      log "Set SEQDESK_CONDA_PATH to a new unused base and rerun the SeqDesk command."
      exit 1
    fi
    if [[ "${INSTALL_MINICONDA}" -eq 1 ]]; then
      install_managed_miniconda "${CONDA_PATH}"
    else
      log "ERROR: conda not found at ${CONDA_PATH}."
      log "Install it first or rerun with --install-miniconda."
      exit 1
    fi
  fi
fi

if [[ -z "${CONDA_BIN}" ]]; then
  if command -v conda >/dev/null 2>&1 && conda --version >/dev/null 2>&1; then
    CONDA_BIN="conda"
  fi
fi

if [[ -z "${CONDA_BIN}" && -n "${CONDA_EXE:-}" ]]; then
  if [[ -x "${CONDA_EXE}" ]] && "${CONDA_EXE}" --version >/dev/null 2>&1; then
    CONDA_BIN="${CONDA_EXE}"
    CONDA_PATH="$("${CONDA_BIN}" info --base 2>/dev/null || true)"
  fi
fi

if [[ -z "${CONDA_BIN}" ]]; then
  for candidate in \
    "${HOME}/miniconda3" \
    "${HOME}/seqdesk-miniconda3" \
    "${HOME}/miniforge3" \
    "${HOME}/mambaforge" \
    "${HOME}/anaconda3"; do
    if CONDA_BIN="$(find_conda_in_prefix "${candidate}")"; then
      CONDA_PATH="${candidate}"
      break
    fi
    CONDA_BIN=""
  done
fi

if [[ -z "${CONDA_BIN}" && "${INSTALL_MINICONDA}" -eq 1 ]]; then
  if ! path_exists_or_symlink "${HOME}/miniconda3"; then
    install_managed_miniconda "${HOME}/miniconda3"
  elif ! path_exists_or_symlink "${HOME}/seqdesk-miniconda3"; then
    log "WARNING: ${HOME}/miniconda3 exists but is not a working Conda base."
    log "It will be left untouched."
    install_managed_miniconda "${HOME}/seqdesk-miniconda3"
  else
    log "ERROR: ${HOME}/miniconda3 and ${HOME}/seqdesk-miniconda3 both exist without a working conda executable."
    log "Set SEQDESK_CONDA_PATH to a new unused base and rerun the SeqDesk command."
    exit 1
  fi
fi

if [[ -z "${CONDA_BIN}" ]]; then
  log "ERROR: conda not found. Install Miniconda/Anaconda first or use --install-miniconda."
  exit 1
fi

log "Using conda: ${CONDA_BIN}"
log "Environment: ${ENV_NAME}"

# conda addresses an environment by NAME (-n) or by PREFIX PATH (-p). A path-style
# env — one that contains a slash, e.g. a shared /net/... env a facility points the
# installer at — MUST use -p; -n rejects it with "Environment names cannot contain
# path separators". Pick the selector once and reuse it for every env operation.
if [[ "${ENV_NAME}" == */* ]]; then
  ENV_SELECTOR=(-p "${ENV_NAME}")
else
  ENV_SELECTOR=(-n "${ENV_NAME}")
fi

CONDA_BASE="$("$CONDA_BIN" info --base 2>/dev/null || true)"
if [[ -n "${CONDA_PATH}" ]]; then
  CONDA_BASE="${CONDA_PATH}"
fi
if [[ -z "${CONDA_BASE}" ]]; then
  log "WARNING: Could not resolve conda base path."
fi

CHANNEL_ARGS=(-c conda-forge -c bioconda)
if [[ "$REMOVE_DEFAULTS" -eq 1 ]]; then
  # Ignore inherited/global defaults channels to avoid Conda ToS gating.
  CHANNEL_ARGS=(--override-channels "${CHANNEL_ARGS[@]}")
  log "Using --override-channels for environment package operations."
fi
if [[ "$STRICT_PRIORITY" -eq 1 ]]; then
  CHANNEL_ARGS=(--strict-channel-priority "${CHANNEL_ARGS[@]}")
fi
log "Pipeline environment channels: conda-forge, bioconda"

ENV_EXISTS=0
if "$CONDA_BIN" env list | awk '{print $1}' | grep -qx "${ENV_NAME}"; then
  ENV_EXISTS=1
  if [[ "$FORCE_RECREATE" -eq 1 ]]; then
    log "Removing existing env: ${ENV_NAME}"
    run "$CONDA_BIN" env remove "${ENV_SELECTOR[@]}"
    ENV_EXISTS=0
  else
    log "Env ${ENV_NAME} already exists. Updating packages."
    run "$CONDA_BIN" install -y "${ENV_SELECTOR[@]}" \
      "${CHANNEL_ARGS[@]}" \
      "python=${PYTHON_VERSION}" \
      "openjdk=17" \
      nodejs \
      coreutils \
      nextflow \
      nf-core
  fi
fi

if [[ "$ENV_EXISTS" -eq 0 ]]; then
  log "Creating env ${ENV_NAME}..."
  run "$CONDA_BIN" create -y "${ENV_SELECTOR[@]}" \
    "${CHANNEL_ARGS[@]}" \
    "python=${PYTHON_VERSION}" \
    "openjdk=17" \
    nodejs \
    coreutils \
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

const configPath = process.env.SEQDESK_CONFIG_PATH || 'settings.json';
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
    run "$CONDA_BIN" run "${ENV_SELECTOR[@]}" nextflow -version
    run "$CONDA_BIN" run "${ENV_SELECTOR[@]}" nf-core --version
    run "$CONDA_BIN" run "${ENV_SELECTOR[@]}" java -version
  fi

  if [[ "$RUN_PIPELINE_TEST" -eq 1 ]]; then
    if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
      log "WARNING: Running pipeline test on macOS ARM may fail."
    else
      :
    fi
    if [[ "$DRY_RUN" -eq 0 ]]; then
      run env NXF_SYNTAX_PARSER=v1 "$CONDA_BIN" run "${ENV_SELECTOR[@]}" nextflow run nf-core/mag -profile test,conda -stub --outdir "${TEST_OUTDIR}"
    fi
  fi
fi
