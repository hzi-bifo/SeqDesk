#!/usr/bin/env bash
# Restore a scripts/backup.sh backup into a FRESH database and directory, then
# verify it. Never restores over an existing database or a non-empty directory.
#
# Usage: scripts/restore.sh BACKUP_DIR --db-url URL --dir DIR [--keep-paths]
#   BACKUP_DIR    a seqdesk-<stamp> folder written by backup.sh
#   --db-url URL  the database to create and restore into (must not exist yet;
#                 the server in URL must accept CREATE DATABASE)
#   --dir DIR     where to unpack: DIR/explore (storage) and DIR/runs (run folders)
#   --keep-paths  keep the stored absolute paths as they were (restore onto the
#                 original host); by default the paths in the restored database
#                 (dataset versions, run folders, artifacts, capsules) are moved
#                 from the backed-up roots to DIR/explore and DIR/runs
#
# Verification (exit 1 on any failure):
#   1. SHA256SUMS of the backup
#   2. row counts of the Explore tables equal counts.tsv
#   3. every dataset version with a storage path has its files on disk
#   4. every ready capsule's file matches its recorded sha256
#   5. every run folder the database names has its folder, and every artifact
#      of a run whose outputs were not pruned has its file with the recorded
#      checksum (skipped for a --manifests-only backup)
# Then point SeqDesk at it: DATABASE_URL=URL SEQDESK_EXPLORE_DIR=DIR/explore
# SEQDESK_EXPLORE_RUN_DIR=DIR/runs.
set -euo pipefail

BACKUP=${1:-}
[[ -n $BACKUP && -d $BACKUP ]] || { sed -n '2,24p' "$0"; exit 2; }
shift
DB_URL=""; DIR=""; KEEP_PATHS=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --db-url) DB_URL=${2%%\?*}; shift 2 ;;
    --dir) DIR=$2; shift 2 ;;
    --keep-paths) KEEP_PATHS=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -n $DB_URL && -n $DIR ]] || { echo "--db-url and --dir are required" >&2; exit 2; }
BACKUP=$(cd "$BACKUP" && pwd)

echo "[restore] 1/5 checksums"
( cd "$BACKUP" && shasum -a 256 -c SHA256SUMS --quiet ) || { echo "[restore] checksum mismatch: the backup is damaged" >&2; exit 1; }

if [[ -e $DIR && -n $(ls -A "$DIR" 2>/dev/null) ]]; then echo "[restore] $DIR is not empty; choose a fresh directory" >&2; exit 1; fi
mkdir -p "$DIR/explore" "$DIR/runs"
DIR=$(cd "$DIR" && pwd)

DB_NAME=${DB_URL##*/}
ADMIN_URL=${DB_URL%/*}/postgres
if [[ $(psql "$ADMIN_URL" -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'") == 1 ]]; then
  echo "[restore] database $DB_NAME exists; restore only into a fresh database" >&2; exit 1
fi
psql "$ADMIN_URL" -qc "CREATE DATABASE \"$DB_NAME\""
echo "[restore] database → $DB_NAME"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DB_URL" "$BACKUP/db.dump"

echo "[restore] files → $DIR"
tar -xzf "$BACKUP/explore.tar.gz" -C "$DIR/explore"
[[ -f $BACKUP/runs.tar.gz ]] && tar -xzf "$BACKUP/runs.tar.gz" -C "$DIR/runs"
[[ -f $BACKUP/run-manifests.tar.gz ]] && tar -xzf "$BACKUP/run-manifests.tar.gz" -C "$DIR/runs"

manifest_field() { sed -nE "s/^  \"$1\": \"(.*)\",?$/\1/p" "$BACKUP/MANIFEST.json"; }
OLD_EXPLORE=$(manifest_field exploreDir)
OLD_RUNS=$(manifest_field runDir)
if (( ! KEEP_PATHS )); then
  echo "[restore] moving stored paths: $OLD_EXPLORE → $DIR/explore, ${OLD_RUNS:-(none)} → $DIR/runs"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
BEGIN;
UPDATE "ExploreDatasetVersion" SET "storagePath" = '$DIR/explore' || substr("storagePath", length('$OLD_EXPLORE') + 1) WHERE "storagePath" LIKE '$OLD_EXPLORE/%';
UPDATE "ExploreCapsule" SET "path" = '$DIR/explore' || substr("path", length('$OLD_EXPLORE') + 1) WHERE "path" LIKE '$OLD_EXPLORE/%';
$( [[ -n $OLD_RUNS ]] && cat <<RUNS
UPDATE "ExploreAnalysisRun" SET "runFolder" = '$DIR/runs' || substr("runFolder", length('$OLD_RUNS') + 1) WHERE "runFolder" LIKE '$OLD_RUNS/%';
UPDATE "ExploreArtifact" SET "path" = '$DIR/runs' || substr("path", length('$OLD_RUNS') + 1) WHERE "path" LIKE '$OLD_RUNS/%';
RUNS
)
COMMIT;
SQL
fi

fail=0
echo "[restore] 2/5 row counts"
while IFS=$'\t' read -r table expected; do
  got=$(psql "$DB_URL" -Atc "SELECT COUNT(*) FROM \"$table\"")
  if [[ $got != "$expected" ]]; then echo "  $table: expected $expected, restored $got" >&2; fail=1; else echo "  $table $got"; fi
done < "$BACKUP/counts.tsv"

echo "[restore] 3/5 dataset version files"
missing=0; total=0
while IFS= read -r storage; do
  [[ -z $storage ]] && continue
  total=$((total + 1))
  [[ -e $storage ]] || { missing=$((missing + 1)); (( missing <= 5 )) && echo "  missing: $storage" >&2; }
done < <(psql "$DB_URL" -Atc 'SELECT "storagePath" FROM "ExploreDatasetVersion" WHERE "storagePath" IS NOT NULL')
echo "  $((total - missing)) of $total present"
(( missing == 0 )) || fail=1

echo "[restore] 4/5 capsules"
bad=0; capsules=0
while IFS=$'\t' read -r file sum; do
  [[ -z $file ]] && continue
  capsules=$((capsules + 1))
  [[ -f $file && $(shasum -a 256 "$file" | cut -d' ' -f1) == "$sum" ]] || { bad=$((bad + 1)); echo "  capsule differs or is missing: $file" >&2; }
done < <(psql "$DB_URL" -At -F $'\t' -c "SELECT \"path\", \"sha256\" FROM \"ExploreCapsule\" WHERE status = 'ready' AND \"path\" IS NOT NULL AND \"sha256\" IS NOT NULL")
echo "  $((capsules - bad)) of $capsules verified"
(( bad == 0 )) || fail=1

echo "[restore] 5/5 run folders"
gone=0; folders=0
while IFS= read -r folder; do
  [[ -z $folder ]] && continue
  folders=$((folders + 1))
  [[ -d $folder ]] || gone=$((gone + 1))
done < <(psql "$DB_URL" -Atc 'SELECT DISTINCT "runFolder" FROM "ExploreAnalysisRun" WHERE "runFolder" IS NOT NULL')
echo "  $((folders - gone)) of $folders present"
# Run folders removed on purpose (a deleted flow) have no row; any row without a folder is a loss.
(( gone == 0 )) || { echo "  $gone run folders named by the database are missing" >&2; fail=1; }

if grep -q '"withOutputs": true' "$BACKUP/MANIFEST.json"; then
  echo "[restore] artifacts of unpruned runs: files and checksums"
  lost=0; checked=0
  while IFS=$'\t' read -r file sum; do
    [[ -z $file ]] && continue
    checked=$((checked + 1))
    if [[ ! -f $file ]] || [[ -n $sum && $(shasum -a 256 "$file" | cut -d' ' -f1) != "$sum" ]]; then lost=$((lost + 1)); (( lost <= 5 )) && echo "  missing or changed: $file" >&2; fi
  done < <(psql "$DB_URL" -At -F $'\t' -c "SELECT a.path, coalesce(a.checksum, '') FROM \"ExploreArtifact\" a JOIN \"ExploreAnalysisRun\" r ON r.id = a.\"runId\" LEFT JOIN \"ExploreFlowRun\" f ON f.id = r.\"flowRunId\" WHERE a.path LIKE '$DIR/runs/%' AND f.\"outputsPrunedAt\" IS NULL")
  echo "  $((checked - lost)) of $checked verified"
  (( lost == 0 )) || fail=1
fi

if (( fail )); then echo "[restore] verification FAILED" >&2; exit 1; fi
echo "[restore] verified. Use: DATABASE_URL='$DB_URL' SEQDESK_EXPLORE_DIR='$DIR/explore' SEQDESK_EXPLORE_RUN_DIR='$DIR/runs'"
