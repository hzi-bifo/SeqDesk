#!/usr/bin/env bash

# Resolve a SeqDesk pipeline Conda reference to the selector accepted by
# `conda run`. Install profiles may configure either a named environment or a
# full prefix on a shared cluster filesystem.
seqdesk_set_conda_environment() {
  local environment="${1:-seqdesk-pipelines}"
  SEQDESK_CONDA_ENVIRONMENT="$environment"
  if [[ "$environment" == /* ||
        "$environment" == ./* ||
        "$environment" == ../* ||
        "$environment" == *"/"* ||
        "$environment" == *"\\"* ]]; then
    SEQDESK_CONDA_ENV_SELECTOR="-p"
  else
    SEQDESK_CONDA_ENV_SELECTOR="-n"
  fi
}

seqdesk_conda_run() {
  conda run \
    "$SEQDESK_CONDA_ENV_SELECTOR" \
    "$SEQDESK_CONDA_ENVIRONMENT" \
    "$@"
}

seqdesk_assert_conda_environment() {
  if ! seqdesk_conda_run python -c 'import sys; raise SystemExit(0)' \
    >/dev/null 2>&1; then
    echo "Conda environment '$SEQDESK_CONDA_ENVIRONMENT' was not found or is not runnable" >&2
    return 1
  fi
}
