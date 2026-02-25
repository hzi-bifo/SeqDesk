#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-release.sh [version] [--skip-build] [--offline-fonts] [--webpack]

Builds a standalone release tarball:
  seqdesk-<version>.tar.gz

Options:
  --skip-build    Skip `npm run build` (use existing .next/standalone)
  --offline-fonts Generate mocked Google Fonts data for offline builds
  --webpack       Build with webpack instead of Turbopack

Environment:
  SEQDESK_PRIVATE_PIPELINES   Comma-separated package IDs to exclude from public release
                              tarballs (default: metaxpath)
EOF
}

VERSION=""
SKIP_BUILD=0
OFFLINE_FONTS=0
USE_WEBPACK=0
PRIVATE_PIPELINES="${SEQDESK_PRIVATE_PIPELINES:-metaxpath}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --offline-fonts)
      OFFLINE_FONTS=1
      shift
      ;;
    --webpack)
      USE_WEBPACK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$VERSION" ]]; then
        VERSION="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
  if [[ -z "$VERSION" ]]; then
    usage
    exit 1
  fi
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/seqdesk-${VERSION}"
TARBALL="${ROOT_DIR}/seqdesk-${VERSION}.tar.gz"
FONT_MOCK_FILE=""
FONT_MOCK_DIR=""

cd "$ROOT_DIR"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  if [[ "$OFFLINE_FONTS" -eq 1 ]]; then
    if [[ -n "${TMPDIR:-}" ]]; then
      FONT_MOCK_DIR="$(mktemp -d "${TMPDIR%/}/seqdesk-font-mock.XXXXXX")"
    else
      FONT_MOCK_DIR="$(mktemp -d "/tmp/seqdesk-font-mock.XXXXXX")"
    fi
    FONT_MOCK_FILE="${FONT_MOCK_DIR}/font-mocks.json"
    node scripts/generate-font-mocks.cjs "$FONT_MOCK_FILE"
    export NEXT_FONT_GOOGLE_MOCKED_RESPONSES="$FONT_MOCK_FILE"
    trap '[[ -n "${FONT_MOCK_DIR}" && -d "${FONT_MOCK_DIR}" ]] && rm -rf "${FONT_MOCK_DIR}"' EXIT
  fi
  echo "Building app..."
  if [[ "$USE_WEBPACK" -eq 1 ]]; then
    npm run build -- --webpack
  else
    npm run build
  fi
fi

if [[ ! -d "${ROOT_DIR}/.next/standalone" ]]; then
  echo "ERROR: .next/standalone not found. Run npm run build first." >&2
  exit 1
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

echo "Copying standalone output..."
cp -R "${ROOT_DIR}/.next/standalone/." "$RELEASE_DIR/"

# Remove bundled release artifacts if file tracing pulled them in
rm -rf "${RELEASE_DIR}"/seqdesk-*/
rm -f "${RELEASE_DIR}"/seqdesk-*.tar.gz

for file in .env .env.local .env.production .env.development .env.test; do
  if [[ -f "${RELEASE_DIR}/${file}" ]]; then
    rm -f "${RELEASE_DIR}/${file}"
  fi
done
rm -f "${RELEASE_DIR}/dev.db" "${RELEASE_DIR}/seqdesk.config.json"

if [[ -d "${ROOT_DIR}/node_modules/@prisma/client" ]]; then
  echo "Copying Prisma client generator..."
  rm -rf "${RELEASE_DIR}/node_modules/@prisma/client"
  mkdir -p "${RELEASE_DIR}/node_modules/@prisma"
  cp -R "${ROOT_DIR}/node_modules/@prisma/client" "${RELEASE_DIR}/node_modules/@prisma/"
fi

if [[ -d "${ROOT_DIR}/node_modules/bcryptjs" ]]; then
  echo "Copying bcryptjs runtime dependency..."
  mkdir -p "${RELEASE_DIR}/node_modules"
  rm -rf "${RELEASE_DIR}/node_modules/bcryptjs"
  cp -R "${ROOT_DIR}/node_modules/bcryptjs" "${RELEASE_DIR}/node_modules/"
fi

echo "Copying Next.js static assets..."
mkdir -p "${RELEASE_DIR}/.next"
cp -R "${ROOT_DIR}/.next/static" "${RELEASE_DIR}/.next/"

echo "Copying runtime assets..."
for item in public prisma pipelines seqdesk.config.example.json package-lock.json next.config.ts .env.example; do
  if [[ -e "${ROOT_DIR}/${item}" ]]; then
    cp -R "${ROOT_DIR}/${item}" "$RELEASE_DIR/"
  fi
done

if [[ -d "${RELEASE_DIR}/pipelines" && -n "${PRIVATE_PIPELINES}" ]]; then
  IFS=',' read -r -a private_pipeline_list <<< "${PRIVATE_PIPELINES}"
  for pipeline in "${private_pipeline_list[@]}"; do
    pipeline="${pipeline#"${pipeline%%[![:space:]]*}"}"
    pipeline="${pipeline%"${pipeline##*[![:space:]]}"}"
    if [[ -z "${pipeline}" ]]; then
      continue
    fi
    if [[ -d "${RELEASE_DIR}/pipelines/${pipeline}" ]]; then
      echo "Excluding private pipeline from public release: ${pipeline}"
      rm -rf "${RELEASE_DIR}/pipelines/${pipeline}"
    fi
  done
fi

# Remove any database files from the release (CRITICAL: prevents data loss on update)
echo "Removing database files from release..."
rm -f "${RELEASE_DIR}/prisma/dev.db" "${RELEASE_DIR}/prisma/dev.db-wal" "${RELEASE_DIR}/prisma/dev.db-shm" "${RELEASE_DIR}/prisma/dev.db-journal"
rm -f "${RELEASE_DIR}/prisma/"*.db "${RELEASE_DIR}/prisma/"*.db-*

if [[ -f "${ROOT_DIR}/scripts/install-wizard.mjs" ]]; then
  mkdir -p "${RELEASE_DIR}/scripts"
  cp "${ROOT_DIR}/scripts/install-wizard.mjs" "${RELEASE_DIR}/scripts/"
fi

if [[ -f "${ROOT_DIR}/scripts/install-private-metaxpath.sh" ]]; then
  mkdir -p "${RELEASE_DIR}/scripts"
  cp "${ROOT_DIR}/scripts/install-private-metaxpath.sh" "${RELEASE_DIR}/scripts/"
  chmod +x "${RELEASE_DIR}/scripts/install-private-metaxpath.sh"
fi

mkdir -p "${RELEASE_DIR}/data"

cat > "${RELEASE_DIR}/start.sh" <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi
if [[ -n "${1:-}" ]]; then
  export PORT="$1"
elif [[ -z "${PORT:-}" ]]; then
  export PORT=3000
fi
APP_VERSION=""
if [[ -f package.json ]]; then
  APP_VERSION=$(node -p "try { require('./package.json').version || '' } catch (e) { '' }" 2>/dev/null || true)
fi
if [[ -n "$APP_VERSION" ]]; then
  echo "SeqDesk version: v${APP_VERSION}"
fi
exec node server.js
EOF
chmod +x "${RELEASE_DIR}/start.sh"

if [[ ! -f "${RELEASE_DIR}/server.js" ]]; then
  echo "ERROR: server.js not found in release output." >&2
  exit 1
fi

echo "Creating tarball: $(basename "$TARBALL")"
export COPYFILE_DISABLE=1
tar -czf "$TARBALL" -C "$ROOT_DIR" "seqdesk-${VERSION}"

size_bytes=$(wc -c < "$TARBALL" | tr -d ' ')
size_mb=$(awk "BEGIN {printf \"%.1f\", ${size_bytes}/1024/1024}")

if command -v sha256sum >/dev/null 2>&1; then
  checksum=$(sha256sum "$TARBALL" | awk '{print $1}')
else
  checksum=$(shasum -a 256 "$TARBALL" | awk '{print $1}')
fi

echo ""
echo "Release package ready:"
echo "  Directory: ${RELEASE_DIR}"
echo "  Tarball:   ${TARBALL}"
echo "  Size:      ${size_mb} MB"
echo "  Checksum:  ${checksum}"
