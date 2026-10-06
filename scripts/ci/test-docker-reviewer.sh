#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v docker >/dev/null || { echo 'Docker with the Compose plugin is required' >&2; exit 1; }
docker compose version >/dev/null
compose_files=(-f compose.yaml)
startup_flags=(--build)
if [ -n "${SEQDESK_DOCKER_TEST_IMAGE:-}" ]; then
  # Test the exact local app candidate without rebuilding or replacing it.
  export SEQDESK_DOCKER_IMAGE="$SEQDESK_DOCKER_TEST_IMAGE"
  startup_flags=(--no-build --pull never)
else
  compose_files+=(-f compose.build.yaml)
fi
compose() { docker compose "${compose_files[@]}" --env-file "$envfile" -p "$project" "$@"; }
# Each run owns an isolated project and destroys only its own test volumes.
project="seqdesk-smoke-$(date +%s)-$$"
testdir="$(mktemp -d "$PWD/.docker-reviewer-test.XXXXXX")"
envfile="$testdir/.env.docker"
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then compose logs --tail 100 || true; fi
  compose down --volumes --remove-orphans || true
  rm -f "$envfile"
  rmdir "$testdir"
  exit "$result"
}
trap cleanup EXIT
if [ -n "${SEQDESK_DOCKER_TEST_IMAGE:-}" ]; then
  # Exercise the Docker-only credential command used by reviewers.
  docker run --rm --entrypoint node --user "$(id -u):$(id -g)" \
    -v "$testdir:/workspace" "$SEQDESK_DOCKER_TEST_IMAGE" \
    docker/setup.mjs /workspace/.env.docker
  # Only the app must remain the local tested candidate. PostgreSQL is public
  # and may not yet be cached on a fresh runner.
  compose pull db
else
  node docker/setup.mjs "$envfile"
fi
export SEQDESK_DOCKER_PORT=0
compose up "${startup_flags[@]}" --wait --wait-timeout 600
compose exec -T app node docker/smoke.mjs before
compose down
compose up --no-build --pull never --wait --wait-timeout 600
compose exec -T app node docker/smoke.mjs after
