#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/release.sh [version] [--skip-build] [--skip-upload] [--offline-fonts] [--webpack]

Builds and publishes a SeqDesk release:
  1) Builds and packages the release tarball
  2) Uploads to Vercel Blob and publishes to seqdesk.com

Options:
  --skip-build     Skip `npm run build` (use existing .next/standalone)
  --skip-upload    Skip upload/publish step (build only)
  --offline-fonts  Generate mocked Google Fonts data for offline builds
  --webpack        Build with webpack instead of Turbopack
EOF
}

VERSION=""
SKIP_BUILD=0
SKIP_UPLOAD=0
OFFLINE_FONTS=0
USE_WEBPACK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-upload)
      SKIP_UPLOAD=1
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

BUILD_ARGS=("$VERSION")
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  BUILD_ARGS+=("--skip-build")
fi
if [[ "$OFFLINE_FONTS" -eq 1 ]]; then
  BUILD_ARGS+=("--offline-fonts")
fi
if [[ "$USE_WEBPACK" -eq 1 ]]; then
  BUILD_ARGS+=("--webpack")
fi

scripts/build-release.sh "${BUILD_ARGS[@]}"

if [[ "$SKIP_UPLOAD" -eq 1 ]]; then
  echo ""
  echo "Skipped upload. Tarball ready for manual publishing."
  exit 0
fi

node scripts/upload-release.js "$VERSION"
