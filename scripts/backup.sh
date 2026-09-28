#!/usr/bin/env bash
# Consistent backup of a SeqDesk installation's analysis data.
#
# What it saves, in <backup-root>/seqdesk-<UTC stamp>/:
#   db.dump          pg_dump custom format of the whole database (one snapshot:
#                    pg_dump runs in a single repeatable-read transaction)
#   explore.tar.gz   Explore storage: datasets/ (table versions), imports/,
#                    capsules/ and the environment specs (environments/*.yml,
#                    *.lock*), but never the built conda prefixes (rebuilt from
#                    the specs on first use)
#   runs.tar.gz      every Explore run folder without its bulk: outputs (the
#                    figures and tables reports cite; pruned runs keep only
#                    outputs/manifest.json), manifests, params, code,
#                    environment.json, inputs.json, control/ and logs/, but not
#                    staged inputs (copies of dataset versions), tmp, home or lib
#   run-manifests.tar.gz  outputs/manifest.json of every run folder, always
#   counts.tsv       row counts of the Explore tables at backup time
#   MANIFEST.json    what was backed up, from where, by which tool versions
#   SHA256SUMS       checksums of all of the above
#
# The database is dumped first, then the files: a table version written in
# between is on disk without its row, which is harmless; the other way round
# cannot happen. Stop the explore monitor for a strictly quiet copy.
#
# Usage: scripts/backup.sh [--out DIR] [--keep N] [--manifests-only]
#   --out DIR        backup root (default $SEQDESK_BACKUP_DIR or ./backups)
#   --keep N         keep the newest N backups in the root (default 14; 0 keeps all)
#   --manifests-only leave run output files out (smaller; restored reports then
#                    show "figure could not be read" for figures of runs)
# Environment:
#   DATABASE_URL            the SeqDesk database (required; ?schema=... is dropped)
#   SEQDESK_EXPLORE_DIR     Explore storage root (default <data base path>/explore)
#   SEQDESK_EXPLORE_RUN_DIR run folder root (default $SEQDESK_PIPELINE_RUN_DIR/explore)
# Restore with scripts/restore.sh. Documented in mail2 docs/flow-module-plan.md, "Backups".
set -euo pipefail

OUT=${SEQDESK_BACKUP_DIR:-./backups}
KEEP=14
WITH_OUTPUTS=1
while [[ $# -gt 0 ]]; do
  case $1 in
    --out) OUT=$2; shift 2 ;;
    --keep) KEEP=$2; shift 2 ;;
    --manifests-only) WITH_OUTPUTS=0; shift ;;
    -h|--help) sed -n '2,35p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

: "${DATABASE_URL:?DATABASE_URL must name the SeqDesk database}"
DB_URL=${DATABASE_URL%%\?*}
# Compute's own default: <data base path>/explore when SEQDESK_DATA_PATH is set (the Linux kit's compute.env).
# A folder chosen in Admin › Settings › Report analysis is not visible here: pass it as SEQDESK_EXPLORE_DIR.
EXPLORE_DIR=${SEQDESK_EXPLORE_DIR:-${SEQDESK_DATA_PATH:+${SEQDESK_DATA_PATH%/}/explore}}
RUN_DIR=${SEQDESK_EXPLORE_RUN_DIR:-${SEQDESK_PIPELINE_RUN_DIR:+$SEQDESK_PIPELINE_RUN_DIR/explore}}
[[ -n $EXPLORE_DIR && -d $EXPLORE_DIR ]] || { echo "Set SEQDESK_EXPLORE_DIR (or SEQDESK_DATA_PATH) to the Explore storage root (it holds datasets/)." >&2; exit 1; }
[[ -n $RUN_DIR ]] || echo "No run folder root (SEQDESK_EXPLORE_RUN_DIR / SEQDESK_PIPELINE_RUN_DIR): runs are not backed up." >&2

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$OUT/seqdesk-$STAMP"
mkdir -p "$DEST.partial"
trap 'rm -rf "$DEST.partial"' ERR

# One snapshot for the dump and the row counts: a psql session exports a repeatable-read
# snapshot, counts in it, and pg_dump reads the same snapshot while the session holds it.
echo "[backup] database → db.dump, counts.tsv (one snapshot)"
COUNT_SQL="SELECT t, n FROM (
  SELECT 'ExploreFlow' AS t, COUNT(*) AS n FROM \"ExploreFlow\" UNION ALL
  SELECT 'ExploreFlowRun', COUNT(*) FROM \"ExploreFlowRun\" UNION ALL
  SELECT 'ExploreAnalysis', COUNT(*) FROM \"ExploreAnalysis\" UNION ALL
  SELECT 'ExploreAnalysisRun', COUNT(*) FROM \"ExploreAnalysisRun\" UNION ALL
  SELECT 'ExploreArtifact', COUNT(*) FROM \"ExploreArtifact\" UNION ALL
  SELECT 'ExploreDataset', COUNT(*) FROM \"ExploreDataset\" UNION ALL
  SELECT 'ExploreDatasetVersion', COUNT(*) FROM \"ExploreDatasetVersion\" UNION ALL
  SELECT 'ExploreDatasetRow', COUNT(*) FROM \"ExploreDatasetRow\" UNION ALL
  SELECT 'ExploreReport', COUNT(*) FROM \"ExploreReport\" UNION ALL
  SELECT 'ExploreCapsule', COUNT(*) FROM \"ExploreCapsule\" UNION ALL
  SELECT 'ExploreRunHold', COUNT(*) FROM \"ExploreRunHold\") c;"
# (FIFOs rather than coproc: macOS ships bash 3.2.)
FIFO_DIR=$(mktemp -d)
mkfifo "$FIFO_DIR/in" "$FIFO_DIR/out"
psql "$DB_URL" -At -F $'\t' -q < "$FIFO_DIR/in" > "$FIFO_DIR/out" &
SNAP_PID=$!
exec 3>"$FIFO_DIR/in" 4<"$FIFO_DIR/out"
echo "BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_export_snapshot();" >&3
read -r SNAPSHOT <&4
[[ -n $SNAPSHOT ]] || { echo "[backup] could not export a snapshot" >&2; exit 1; }
echo "$COUNT_SQL SELECT '--end--', 0;" >&3
: > "$DEST.partial/counts.tsv"
while IFS= read -r line <&4; do [[ $line == --end--* ]] && break; printf '%s\n' "$line" >> "$DEST.partial/counts.tsv"; done
pg_dump --format=custom --no-owner --no-privileges --snapshot="$SNAPSHOT" --file="$DEST.partial/db.dump" "$DB_URL"
echo "COMMIT;" >&3
exec 3>&- 4<&-
wait "$SNAP_PID" 2>/dev/null || true
rm -rf "$FIFO_DIR"

echo "[backup] Explore storage → explore.tar.gz"
(
  cd "$EXPLORE_DIR"
  entries=()
  for dir in datasets imports capsules; do [[ -d $dir ]] && entries+=("$dir"); done
  if [[ -d environments ]]; then
    while IFS= read -r spec; do entries+=("$spec"); done < <(find environments -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' -o -name '*.lock*' -o -name '*.txt' \) | sort)
  fi
  tar -czf "$DEST.partial/explore.tar.gz" "${entries[@]}"
)

if [[ -n $RUN_DIR && -d $RUN_DIR ]]; then
  echo "[backup] run folders → runs.tar.gz"
  excludes=(--exclude='*/inputs/*' --exclude='*/tmp' --exclude='*/home' --exclude='*/lib')
  (( WITH_OUTPUTS )) || excludes+=(--exclude='*/outputs/*' )
  (
    cd "$RUN_DIR"
    # outputs/manifest.json always goes along, whatever the excludes drop.
    find . -mindepth 1 -maxdepth 1 -type d | sort > "$DEST.partial/.runs"
    tar -czf "$DEST.partial/runs.tar.gz" "${excludes[@]}" -T "$DEST.partial/.runs"
    find . -mindepth 3 -maxdepth 3 -path '*/outputs/manifest.json' | sort > "$DEST.partial/.manifests"
    [[ -s "$DEST.partial/.manifests" ]] && tar -czf "$DEST.partial/run-manifests.tar.gz" -T "$DEST.partial/.manifests"
    rm -f "$DEST.partial/.runs" "$DEST.partial/.manifests"
  )
fi

cat > "$DEST.partial/MANIFEST.json" <<JSON
{
  "kind": "seqdesk-backup",
  "format": 1,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname)",
  "database": "$(printf %s "$DB_URL" | sed -E 's#//[^@/]*@#//#')",
  "exploreDir": "$EXPLORE_DIR",
  "runDir": "${RUN_DIR:-}",
  "withOutputs": $([[ $WITH_OUTPUTS == 1 ]] && echo true || echo false),
  "pgDump": "$(pg_dump --version | head -1)",
  "seqdeskCommit": "$(git -C "$(dirname "$0")/.." rev-parse HEAD 2>/dev/null || echo unknown)"
}
JSON

( cd "$DEST.partial" && shasum -a 256 db.dump counts.tsv explore.tar.gz MANIFEST.json $(ls runs.tar.gz run-manifests.tar.gz 2>/dev/null) > SHA256SUMS )
mv "$DEST.partial" "$DEST"
trap - ERR
echo "[backup] done: $DEST ($(du -sh "$DEST" | cut -f1))"

if (( KEEP > 0 )); then
  ls -1d "$OUT"/seqdesk-*Z 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
    echo "[backup] retention: removing $old"
    rm -rf "$old"
  done
fi
