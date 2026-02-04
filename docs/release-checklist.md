# SeqDesk Release Checklist

## Pre-flight
- Update `package.json` version.
- Review installer changes in `scripts/install-dist.sh`.
- Ensure `SeqDesk.com/public/install.sh` matches `scripts/install-dist.sh`.
- Run quick sanity checks (optional): `npm run lint`, `npm run pipeline:validate`.

## Build + Publish (recommended)
- Run: `scripts/release.sh`
  - Uses `package.json` version by default.
  - Uploads tarball to Vercel Blob and publishes release metadata.
- Optional offline build if Google Fonts are blocked:
  - `scripts/release.sh --offline-fonts`
  - Note: offline builds use fallback fonts (no Google Font downloads).
- If Turbopack cannot run (sandboxed CI), use webpack:
  - `scripts/release.sh --webpack`

## Manual Build Only
- `scripts/build-release.sh [version]`
- Upload/publish later with:
  - `node scripts/upload-release.js [version]`

## Verify
- `curl -fsSL https://seqdesk.com/api/version` shows the new version.
- `curl -fsSL https://seqdesk.com/install.sh | bash` pulls the latest release.
- Update `SeqDesk.com/src/data/releases.json` + deploy if the changelog page should show the new version.
