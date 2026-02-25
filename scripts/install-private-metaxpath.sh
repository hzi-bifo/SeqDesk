#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Install private MetaxPath package into SeqDesk.

Usage:
  scripts/install-private-metaxpath.sh [options]

Options:
  --url <https://.../metaxpath.tar.gz>   Package tarball URL
  --token <token>                        Bearer token for private URL (optional)
  --sha256 <hex>                         Verify tarball checksum (optional)
  --dir <seqdesk-dir>                    SeqDesk root directory (default: repo root)
  --keep-existing                        Abort if pipelines/metaxpath already exists
  -h, --help                             Show this help

Environment variables:
  METAXPATH_PACKAGE_URL                  Default for --url
  METAXPATH_PACKAGE_TOKEN                Default for --token
  METAXPATH_PACKAGE_SHA256               Default for --sha256
  SEQDESK_DIR                            Default for --dir

Examples:
  METAXPATH_PACKAGE_URL="https://private.example/metaxpath-0.1.0.tar.gz" \
    METAXPATH_PACKAGE_TOKEN="..." \
    scripts/install-private-metaxpath.sh

  scripts/install-private-metaxpath.sh \
    --url "https://private.example/metaxpath-0.1.0.tar.gz" \
    --token "..." \
    --sha256 "<sha256>" \
    --dir /opt/seqdesk
USAGE
}

log() {
  echo "[metaxpath-install] $*"
}

error() {
  echo "[metaxpath-install] ERROR: $*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

download_file() {
  local url="$1"
  local output_path="$2"
  local token="$3"

  if command_exists curl; then
    if [[ -n "$token" ]]; then
      curl -fsSL -H "Authorization: Bearer ${token}" "$url" -o "$output_path"
    else
      curl -fsSL "$url" -o "$output_path"
    fi
    return 0
  fi

  if command_exists wget; then
    if [[ -n "$token" ]]; then
      wget --header="Authorization: Bearer ${token}" -qO "$output_path" "$url"
    else
      wget -qO "$output_path" "$url"
    fi
    return 0
  fi

  error "Neither curl nor wget is available"
}

verify_sha256() {
  local file_path="$1"
  local expected="$2"
  local actual=""

  if command_exists sha256sum; then
    actual="$(sha256sum "$file_path" | awk '{print $1}')"
  elif command_exists shasum; then
    actual="$(shasum -a 256 "$file_path" | awk '{print $1}')"
  else
    error "No SHA256 tool found (sha256sum/shasum)"
  fi

  if [[ "$actual" != "$expected" ]]; then
    error "Checksum mismatch. expected=${expected} actual=${actual}"
  fi
}

find_package_root() {
  local extract_dir="$1"

  if [[ -f "${extract_dir}/manifest.json" ]]; then
    echo "$extract_dir"
    return 0
  fi

  if [[ -f "${extract_dir}/metaxpath/manifest.json" ]]; then
    echo "${extract_dir}/metaxpath"
    return 0
  fi

  local manifest_file
  manifest_file="$(find "$extract_dir" -maxdepth 4 -type f -name manifest.json | head -n 1 || true)"
  if [[ -n "$manifest_file" ]]; then
    dirname "$manifest_file"
    return 0
  fi

  return 1
}

is_metaxpath_manifest() {
  local manifest_path="$1"
  grep -Eq '"id"[[:space:]]*:[[:space:]]*"metaxpath"' "$manifest_path"
}

PACKAGE_URL="${METAXPATH_PACKAGE_URL:-}"
PACKAGE_TOKEN="${METAXPATH_PACKAGE_TOKEN:-}"
PACKAGE_SHA256="${METAXPATH_PACKAGE_SHA256:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEQDESK_DIR_DEFAULT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SEQDESK_DIR="${SEQDESK_DIR:-${SEQDESK_DIR_DEFAULT}}"
REPLACE_EXISTING=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      [[ $# -lt 2 ]] && error "Missing value for --url"
      PACKAGE_URL="$2"
      shift
      ;;
    --token)
      [[ $# -lt 2 ]] && error "Missing value for --token"
      PACKAGE_TOKEN="$2"
      shift
      ;;
    --sha256)
      [[ $# -lt 2 ]] && error "Missing value for --sha256"
      PACKAGE_SHA256="$2"
      shift
      ;;
    --dir)
      [[ $# -lt 2 ]] && error "Missing value for --dir"
      SEQDESK_DIR="$2"
      shift
      ;;
    --keep-existing)
      REPLACE_EXISTING=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      ;;
  esac
  shift
done

PACKAGE_URL="$(trim "$PACKAGE_URL")"
PACKAGE_SHA256="$(trim "$PACKAGE_SHA256")"
SEQDESK_DIR="$(trim "$SEQDESK_DIR")"

[[ -z "$PACKAGE_URL" ]] && error "Package URL is required (--url or METAXPATH_PACKAGE_URL)"
[[ -z "$SEQDESK_DIR" ]] && error "SeqDesk directory is empty"
[[ ! -d "$SEQDESK_DIR" ]] && error "SeqDesk directory not found: $SEQDESK_DIR"

command_exists tar || error "tar is required"

PIPELINES_DIR="${SEQDESK_DIR}/pipelines"
TARGET_DIR="${PIPELINES_DIR}/metaxpath"

if [[ -d "$TARGET_DIR" && "$REPLACE_EXISTING" -eq 0 ]]; then
  error "Target already exists: $TARGET_DIR (use default replace behavior or remove --keep-existing)"
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE_PATH="${TMP_DIR}/metaxpath.tar.gz"
EXTRACT_DIR="${TMP_DIR}/extract"
mkdir -p "$EXTRACT_DIR"

log "Downloading private package"
download_file "$PACKAGE_URL" "$ARCHIVE_PATH" "$PACKAGE_TOKEN"

if [[ -n "$PACKAGE_SHA256" ]]; then
  log "Verifying checksum"
  verify_sha256 "$ARCHIVE_PATH" "$PACKAGE_SHA256"
fi

log "Extracting package"
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

PACKAGE_ROOT="$(find_package_root "$EXTRACT_DIR" || true)"
[[ -z "$PACKAGE_ROOT" ]] && error "Could not find package root with manifest.json"
[[ ! -f "${PACKAGE_ROOT}/manifest.json" ]] && error "manifest.json missing in extracted package"

if ! is_metaxpath_manifest "${PACKAGE_ROOT}/manifest.json"; then
  error "manifest.json is not for metaxpath"
fi

mkdir -p "$PIPELINES_DIR"
STAGE_DIR="${PIPELINES_DIR}/metaxpath.__tmp-$(date +%s)"
BACKUP_DIR=""

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp -a "${PACKAGE_ROOT}/." "$STAGE_DIR/"

if [[ -d "$TARGET_DIR" ]]; then
  BACKUP_DIR="${PIPELINES_DIR}/metaxpath.__backup-$(date +%s)"
  mv "$TARGET_DIR" "$BACKUP_DIR"
fi

mv "$STAGE_DIR" "$TARGET_DIR"

if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
  rm -rf "$BACKUP_DIR"
fi

log "Installed private MetaxPath package to: $TARGET_DIR"
log "Next step: open SeqDesk Admin > Settings > Pipelines and enable/configure metaxpath database paths."
