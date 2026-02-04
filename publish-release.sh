#!/usr/bin/env bash
set -euo pipefail

: "${ADMIN_SECRET:?Set ADMIN_SECRET env var first}"

curl -s -X POST "https://www.seqdesk.com/api/releases/publish" \
  -H "Authorization: Bearer ${ADMIN_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{
    "version":"1.1.11",
    "channel":"stable",
    "releaseDate":"2026-02-03",
    "downloadUrl":"https://hrvwvo4zhyhlyy73.public.blob.vercel-storage.com/releases/seqdesk-1.1.11.tar-bt57tGzDPhbPmAgmiFV09xWNaXa7y6.gz",
    "checksum":"sha256:728a18897f262e068daf6e2d8684d89e3a33c4a2476ba1e5c55030803e3daf87",
    "minNodeVersion":"18.0.0",
    "title":"Update Progress & Restart Detection",
    "releaseNotes":"More reliable in-app updates with progress, restart detection, and version display",
    "changelog":[
      "Persist update progress and show live status in Admin Settings",
      "Detect installed vs running version with restart pending state",
      "Show app version in the sidebar"
    ]
  }'
