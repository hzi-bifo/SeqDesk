#!/usr/bin/env bash
# Drain every process/allocation recorded by one temporary SeqDesk database.
#
# Usage: bash cleanup-db-pipeline-runs.sh <database-name> <pipeline-run-root>
#
# Database status is intentionally ignored: a detached process can outlive a
# terminal PipelineRun row. Signals require an exact run.sh process identity or
# exact SLURM JobName + WorkDir identity. Any lookup uncertainty is a failure so
# callers preserve the database and run tree for recovery.
set -uo pipefail

db_name="${1:-}"
run_root="${2:-}"
cleanup_rc=0
remaining=0

if [ -z "$db_name" ] || [ -z "$run_root" ]; then
  echo "ERROR: database name and pipeline run root are required for cleanup." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is unavailable; PipelineRun identities cannot be resolved." >&2
  exit 1
fi

resolved_root="$(realpath -m "$run_root" 2>/dev/null || true)"
if [ -z "$resolved_root" ]; then
  echo "ERROR: could not resolve pipeline run root $run_root." >&2
  exit 1
fi

queue_file="$(mktemp "${RUNNER_TEMP:-/tmp}/seqdesk-alma-queue.XXXXXX")" || exit 1
identity_file="$(mktemp "${RUNNER_TEMP:-/tmp}/seqdesk-alma-identity.XXXXXX")" || {
  rm -f "$queue_file"
  exit 1
}
marker_file="$(mktemp "${RUNNER_TEMP:-/tmp}/seqdesk-alma-markers.XXXXXX")" || {
  rm -f "$queue_file" "$identity_file"
  exit 1
}
cleanup_temp_files() {
  rm -f "$queue_file" "$identity_file" "$marker_file"
}
trap cleanup_temp_files EXIT

process_group_identity_state() {
  local group_id="${1:-}"
  local run_folder="${2:-}"
  local expected_script processes identity_state
  if [[ ! "$group_id" =~ ^[0-9]+$ ]] || [ -z "$run_folder" ]; then
    printf '%s\n' unknown
    return 0
  fi
  expected_script="$run_folder/run.sh"
  if ! processes="$(ps -eo pgid=,args= 2>/dev/null)"; then
    printf '%s\n' unknown
    return 0
  fi
  if ! identity_state="$(printf '%s\n' "$processes" | awk \
    -v expected="$group_id" -v script="$expected_script" '
      $1 == expected {
        for (field = 2; field <= NF; field += 1) {
          if ($field == script) found = 1
        }
      }
      END { print(found ? "matches" : "mismatch") }
    ')"; then
    printf '%s\n' unknown
  else
    printf '%s\n' "$identity_state"
  fi
}

process_group_state() {
  local group_id="${1:-}"
  local processes group_state
  if [[ ! "$group_id" =~ ^[0-9]+$ ]]; then
    printf '%s\n' unknown
    return 0
  fi
  if ! processes="$(ps -eo pgid=,stat= 2>/dev/null)"; then
    printf '%s\n' unknown
    return 0
  fi
  if ! group_state="$(printf '%s\n' "$processes" | awk \
    -v expected="$group_id" '
      $1 == expected && $2 !~ /^Z/ { active = 1 }
      END { print(active ? "active" : "inactive") }
    ')"; then
    printf '%s\n' unknown
  else
    printf '%s\n' "$group_state"
  fi
}

slurm_job_state() {
  local job_id="${1:-}"
  local queue_ids
  if [[ ! "$job_id" =~ ^[0-9]+$ ]]; then
    printf '%s\n' unknown
  elif ! queue_ids="$(squeue -h -o '%i' 2>/dev/null)"; then
    printf '%s\n' unknown
  elif printf '%s\n' "$queue_ids" | grep -qx "$job_id"; then
    printf '%s\n' active
  else
    printf '%s\n' inactive
  fi
}

slurm_identity_state() {
  local job_id="${1:-}"
  local run_folder="${2:-}"
  local expected_job_name="${3:-}"
  local info actual_job_name actual_work_dir
  local resolved_expected_work_dir resolved_actual_work_dir
  if [[ ! "$job_id" =~ ^[0-9]+$ ]] ||
     [ -z "$run_folder" ] || [ -z "$expected_job_name" ]; then
    printf '%s\n' unknown
    return 0
  fi
  if ! info="$(scontrol show job -o "$job_id" 2>/dev/null)"; then
    printf '%s\n' unknown
    return 0
  fi
  actual_job_name="$(printf '%s\n' "$info" | tr ' ' '\n' | sed -n 's/^JobName=//p' | head -n 1)"
  actual_work_dir="$(printf '%s\n' "$info" | tr ' ' '\n' | sed -n 's/^WorkDir=//p' | head -n 1)"
  resolved_expected_work_dir="$(realpath -m "$run_folder" 2>/dev/null || true)"
  resolved_actual_work_dir="$(realpath -m "$actual_work_dir" 2>/dev/null || true)"
  if [ -z "$actual_job_name" ] || [ -z "$actual_work_dir" ]; then
    printf '%s\n' unknown
  elif [ -z "$resolved_expected_work_dir" ] ||
       [ -z "$resolved_actual_work_dir" ]; then
    printf '%s\n' unknown
  elif [ "$actual_job_name" = "$expected_job_name" ] &&
       [ "$resolved_actual_work_dir" = "$resolved_expected_work_dir" ]; then
    printf '%s\n' matches
  else
    printf '%s\n' mismatch
  fi
}

if ! PGPASSWORD="${DB_PASSWORD:-seqdesk}" psql \
  -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-seqdesk}" -d "$db_name" -At -F '|' \
  -c "select id, \"queueJobId\", coalesce(\"runFolder\", '') from \"PipelineRun\" where coalesce(\"queueJobId\", '') <> '' order by \"createdAt\"" \
  > "$queue_file" 2>/dev/null; then
  echo "ERROR: could not query PipelineRun queue identities from $db_name." >&2
  # Keep the failure status so callers preserve the database/run tree, but
  # still drain any atomic launch markers that do not depend on PostgreSQL.
  : > "$queue_file"
  cleanup_rc=1
fi

while IFS='|' read -r run_id queue_id run_folder; do
  resolved_run="$(realpath -m "$run_folder" 2>/dev/null || true)"
  if [ -z "$run_id" ] || [ -z "$queue_id" ] || [ -z "$resolved_run" ] ||
     [[ "$resolved_run" != "$resolved_root/"* ]]; then
    echo "ERROR: refusing unscoped PipelineRun identity (run=${run_id:-<missing>} queue=${queue_id:-<missing>} folder=${run_folder:-<missing>})." >&2
    cleanup_rc=1
    continue
  fi
  case "$queue_id" in
    local-*)
      process_id="${queue_id#local-}"
      if [[ "$process_id" =~ ^[0-9]+$ ]]; then
        printf 'local|%s|%s|-\n' "$process_id" "$run_folder" >> "$identity_file"
      else
        echo "ERROR: malformed local queue id: $queue_id" >&2
        cleanup_rc=1
      fi
      ;;
    *[!0-9]*)
      echo "ERROR: unrecognized queue id: $queue_id" >&2
      cleanup_rc=1
      ;;
    *)
      safe_run_id="$(printf '%s' "$run_id" | sed 's/[^A-Za-z0-9_-]/-/g' | cut -c1-48)"
      printf 'slurm|%s|%s|seqdesk-%s\n' \
        "$queue_id" "$run_folder" "$safe_run_id" >> "$identity_file"
      ;;
  esac
done < "$queue_file"

# queueJobId is written after an external launch. If that database write and
# the immediate compensating stop both fail, the durable marker written beside
# run.sh is the only recovery identity. Discover those markers without
# following symlinks, then subject them to the same exact process/job checks as
# database identities.
if [ -d "$resolved_root" ]; then
  if ! find "$resolved_root" \
    -name '.seqdesk-launch-identity' -print0 > "$marker_file" 2>/dev/null; then
    echo "ERROR: could not scan pipeline launch identity markers under $resolved_root." >&2
    cleanup_rc=1
  fi

  while IFS= read -r -d '' marker_path; do
    resolved_run="$(realpath -m "$(dirname "$marker_path")" 2>/dev/null || true)"
    resolved_marker="$(realpath -m "$marker_path" 2>/dev/null || true)"
    if [ -z "$resolved_run" ] || [ -z "$resolved_marker" ] ||
       [[ "$resolved_run" != "$resolved_root/"* ]] ||
       [ "$resolved_marker" != "$resolved_run/.seqdesk-launch-identity" ] ||
       [ -L "$marker_path" ] || [ ! -f "$marker_path" ]; then
      echo "ERROR: refusing unscoped pipeline launch marker: $marker_path" >&2
      cleanup_rc=1
      continue
    fi
    if ! marker_size="$(wc -c < "$marker_path" 2>/dev/null)"; then
      echo "ERROR: could not size pipeline launch marker: $marker_path" >&2
      cleanup_rc=1
      continue
    fi
    marker_size="${marker_size//[[:space:]]/}"
    if [[ ! "$marker_size" =~ ^[0-9]+$ ]] ||
       [ "$marker_size" -lt 1 ] || [ "$marker_size" -gt 256 ]; then
      echo "ERROR: refusing malformed pipeline launch marker: $marker_path" >&2
      cleanup_rc=1
      continue
    fi
    if ! marker_contents="$(LC_ALL=C head -c 257 "$marker_path" 2>/dev/null)"; then
      echo "ERROR: could not read pipeline launch marker: $marker_path" >&2
      cleanup_rc=1
      continue
    fi

    if [[ "$marker_contents" =~ ^local\|([1-9][0-9]*)\|-$ ]]; then
      printf 'local|%s|%s|-\n' \
        "${BASH_REMATCH[1]}" "$resolved_run" >> "$identity_file"
    elif [[ "$marker_contents" =~ ^slurm\|([1-9][0-9]*)\|(seqdesk-[A-Za-z0-9_-]+)$ ]]; then
      printf 'slurm|%s|%s|%s\n' \
        "${BASH_REMATCH[1]}" "$resolved_run" "${BASH_REMATCH[2]}" >> "$identity_file"
    else
      echo "ERROR: refusing malformed pipeline launch marker contents at $marker_path." >&2
      cleanup_rc=1
    fi
  done < "$marker_file"
fi

if ! sort -u "$identity_file" -o "$identity_file"; then
  echo "ERROR: could not deduplicate pipeline cleanup identities." >&2
  cleanup_rc=1
fi

# Signal all exact identities first so the bounded waits apply to the set.
while IFS='|' read -r kind queue_id run_folder expected_job_name; do
  if [ "$kind" = "local" ]; then
    process_state="$(process_group_state "$queue_id")"
    if [ "$process_state" = "active" ]; then
      identity_state="$(process_group_identity_state "$queue_id" "$run_folder")"
      if [ "$identity_state" = "matches" ]; then
        kill -TERM -- "-$queue_id" >/dev/null 2>&1 ||
          kill -TERM "$queue_id" >/dev/null 2>&1 || cleanup_rc=1
      else
        process_state="$(process_group_state "$queue_id")"
        if [ "$process_state" != "inactive" ]; then
          echo "ERROR: refusing to signal process group $queue_id; state=$process_state identity=$identity_state." >&2
          cleanup_rc=1
        fi
      fi
    elif [ "$process_state" = "unknown" ]; then
      echo "ERROR: process-group state for $queue_id is unknown." >&2
      cleanup_rc=1
    fi
  else
    job_state="$(slurm_job_state "$queue_id")"
    if [ "$job_state" = "active" ]; then
      identity_state="$(slurm_identity_state \
        "$queue_id" "$run_folder" "$expected_job_name")"
      if [ "$identity_state" = "matches" ]; then
        scancel "$queue_id" >/dev/null 2>&1 || cleanup_rc=1
      else
        echo "ERROR: refusing scancel for $queue_id; identity=$identity_state." >&2
        cleanup_rc=1
      fi
    elif [ "$job_state" = "unknown" ]; then
      echo "ERROR: SLURM job $queue_id queue state is unknown." >&2
      cleanup_rc=1
    fi
  fi
done < "$identity_file"

for _ in $(seq 1 30); do
  remaining=0
  while IFS='|' read -r kind queue_id run_folder expected_job_name; do
    if [ "$kind" = "local" ]; then
      process_state="$(process_group_state "$queue_id")"
      if [ "$process_state" = "active" ]; then
        remaining=1
      elif [ "$process_state" = "unknown" ]; then
        cleanup_rc=1
      fi
    else
      job_state="$(slurm_job_state "$queue_id")"
      if [ "$job_state" = "active" ]; then
        remaining=1
      elif [ "$job_state" = "unknown" ]; then
        cleanup_rc=1
      fi
    fi
  done < "$identity_file"
  [ "$remaining" = 0 ] && break
  sleep 1
done

# Escalate only identities that still match immediately before the signal.
while IFS='|' read -r kind queue_id run_folder expected_job_name; do
  if [ "$kind" = "local" ]; then
    process_state="$(process_group_state "$queue_id")"
    if [ "$process_state" = "active" ]; then
      identity_state="$(process_group_identity_state "$queue_id" "$run_folder")"
      if [ "$identity_state" = "matches" ]; then
        kill -KILL -- "-$queue_id" >/dev/null 2>&1 ||
          kill -KILL "$queue_id" >/dev/null 2>&1 || cleanup_rc=1
      else
        cleanup_rc=1
      fi
    elif [ "$process_state" = "unknown" ]; then
      cleanup_rc=1
    fi
  else
    job_state="$(slurm_job_state "$queue_id")"
    if [ "$job_state" = "active" ]; then
      identity_state="$(slurm_identity_state \
        "$queue_id" "$run_folder" "$expected_job_name")"
      if [ "$identity_state" = "matches" ]; then
        scancel "$queue_id" >/dev/null 2>&1 || cleanup_rc=1
      else
        cleanup_rc=1
      fi
    elif [ "$job_state" = "unknown" ]; then
      cleanup_rc=1
    fi
  fi
done < "$identity_file"

for _ in $(seq 1 10); do
  remaining=0
  while IFS='|' read -r kind queue_id run_folder expected_job_name; do
    if [ "$kind" = "local" ]; then
      process_state="$(process_group_state "$queue_id")"
      if [ "$process_state" = "active" ]; then
        remaining=1
      elif [ "$process_state" = "unknown" ]; then
        cleanup_rc=1
      fi
    else
      job_state="$(slurm_job_state "$queue_id")"
      if [ "$job_state" = "active" ]; then
        remaining=1
      elif [ "$job_state" = "unknown" ]; then
        cleanup_rc=1
      fi
    fi
  done < "$identity_file"
  [ "$remaining" = 0 ] && break
  sleep 1
done

while IFS='|' read -r kind queue_id run_folder expected_job_name; do
  if [ "$kind" = "local" ]; then
    process_state="$(process_group_state "$queue_id")"
    if [ "$process_state" != "inactive" ]; then
      echo "ERROR: final local process-group state for $queue_id is $process_state." >&2
      cleanup_rc=1
    fi
  else
    job_state="$(slurm_job_state "$queue_id")"
    if [ "$job_state" != "inactive" ]; then
      echo "ERROR: final SLURM state for $queue_id is $job_state." >&2
      cleanup_rc=1
    fi
  fi
done < "$identity_file"

exit "$cleanup_rc"
