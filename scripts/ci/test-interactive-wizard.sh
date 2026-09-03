#!/usr/bin/env bash
#
# Unit test for the installer's --interactive guided wizard.
#
# Sources scripts/install-dist.sh in library-only mode (SEQDESK_INSTALL_LIB_ONLY=1)
# so the helper/wizard functions are loaded without running the installer, then
# drives run_interactive_wizard with scripted answers and asserts the captured
# configuration. read_input/read_secret are redefined to read from stdin so the
# test is deterministic regardless of whether a /dev/tty exists; db_tcp_reachable
# is stubbed so no real network is touched. Real URL parsing (postgres_url_host_port,
# via node), email/password validation, and password generation run unchanged.
#
# Exits non-zero on the first failed assertion.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck disable=SC1091
SEQDESK_INSTALL_LIB_ONLY=1 source "$REPO_ROOT/scripts/install-dist.sh"

# Deterministic, tty-independent input + controllable reachability.
read_input() { local r; IFS= read -r r || true; printf '%s' "$r"; }
read_secret() { local r; IFS= read -r r || true; printf '%s' "$r"; }
db_tcp_reachable() { [ "${TEST_DB_REACHABLE:-0}" = "1" ]; }

FAILURES=0
assert_eq() {
    # assert_eq <label> <expected> <actual>
    if [ "$2" != "$3" ]; then
        echo "FAIL: $1: expected [$2], got [$3]" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_nonempty() {
    if [ -z "$2" ]; then
        echo "FAIL: $1: expected a non-empty value" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_contains() {
    if ! grep -qF -- "$2" "$3"; then
        echo "FAIL: $1: output did not contain [$2]" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}
assert_not_contains() {
    if grep -qF -- "$2" "$3"; then
        echo "FAIL: $1: output unexpectedly contained [$2]" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}

reset_state() {
    SEQDESK_INTERACTIVE=1
    SEQDESK_YES=""
    SEQDESK_CONFIG=""
    SEQDESK_PROFILE=""
    SEQDESK_DEPLOYMENT_PROFILE=""
    SEQDESK_ACCESS_AUDIENCE=""
    SEQDESK_BIND_HOST=""
    SEQDESK_PORT=""
    SEQDESK_NEXTAUTH_URL=""
    SEQDESK_DATA_PATH=""
    SEQDESK_RUN_DIR=""
    SEQDESK_PIPELINE_DATABASE_DIR=""
    SEQDESK_DIR="$TEST_TMP_DIR/install"
    SEQDESK_DATABASE_URL=""
    SEQDESK_DATABASE_DIRECT_URL=""
    SEQDESK_BOOTSTRAP_ADMIN_EMAIL=""
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD=""
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH=""
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="false"
    SEQDESK_GENERATED_ADMIN_PASSWORD=""
    SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL=""
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD=""
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH=""
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="false"
    SEQDESK_GENERATED_RESEARCHER_PASSWORD=""
    SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED=""
    SEQDESK_RECONFIGURE=""
    SEQDESK_RESEED_DB=""
    SEQDESK_UPDATE_EXISTING=""
    SEQDESK_OVERWRITE_EXISTING=""
    SEQDESK_EMPTY_TARGET="false"
    SEQDESK_PREFLIGHT_READ_ONLY="false"
    SEQDESK_ONBOARDING_VERSION=""
    SEQDESK_RUN_DOCTOR=""
    SEQDESK_USE_PM2=""
    SEQDESK_WITH_PIPELINES=""
    PIPELINES_ENABLED="false"
    PM2_CONFIGURED="false"
    INSTALL_LOCK_DIR=""
    INSTALL_LOCK_HELD="false"
    INSTALL_CHECKPOINT_PATH=""
}

OUT="$(mktemp)"
TEST_TMP_DIR="$(mktemp -d)"
TEST_TMP_DIR="$(cd "$TEST_TMP_DIR" && pwd -P)"
trap 'rm -f "$OUT"; rm -rf "$TEST_TMP_DIR"' EXIT

# Never let a test touch the real ~/.seqdesk: the preflight can provision a
# private PostgreSQL cluster, and a unit test must not create one in $HOME.
# Individual cases stub provision_private_postgres, but this is the backstop.
export SEQDESK_PG_HOME="$TEST_TMP_DIR/pg"

echo "== Case 1: managed DB (unreachable -> use anyway), validation re-prompts, accounts =="
reset_state
TEST_DB_REACHABLE=0
# Input order matches the wizard's reads: deployment profile; local access/port;
# database; pipeline support; storage; then the initial administrator.
run_interactive_wizard >"$OUT" 2>&1 <<'EOF'
1


2
not-a-url
postgresql://u:secret@db.example.com:5432/seqdesk
y

n

admin@lab.org
longpassword1
longpassword1
EOF

assert_eq "managed DATABASE_URL captured" \
    "postgresql://u:secret@db.example.com:5432/seqdesk" "$SEQDESK_DATABASE_URL"
assert_eq "sequencing center profile captured" \
    "sequencing-center" "$SEQDESK_DEPLOYMENT_PROFILE"
assert_eq "admin email captured" "admin@lab.org" "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL"
assert_eq "admin password captured" "longpassword1" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD"
assert_eq "generic researcher is disabled" "0" "$SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED"
assert_eq "researcher email is not captured" "" "$SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL"
assert_eq "sequencing center can defer pipeline setup" "0" "$SEQDESK_WITH_PIPELINES"
assert_eq "local access binds to loopback" "127.0.0.1" "$SEQDESK_BIND_HOST"
assert_eq "local browser URL is safe by default" "http://localhost:8000" "$SEQDESK_NEXTAUTH_URL"
assert_eq "guided storage stays outside the app directory" \
    "$TEST_TMP_DIR/install-data" "$SEQDESK_DATA_PATH"
assert_contains "rejected non-postgres URL" "does not look like a postgresql" "$OUT"
assert_contains "warned on unreachable host" "Could not reach" "$OUT"
assert_eq "an operator-supplied password is not flagged as generated" \
    "false" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED"
assert_eq "an operator-supplied password is never copied for display" \
    "" "$SEQDESK_GENERATED_ADMIN_PASSWORD"
assert_contains "members are deferred to authenticated invitations" \
    "Additional accounts are invited" "$OUT"

echo ""
echo "== Case 2: local DB choice, no researcher, reachable managed not used =="
reset_state
TEST_DB_REACHABLE=1
# deployment profile 1; local access/port; local DB; pipelines n; managed storage;
# admin email (blank -> default); admin pw; confirm
run_interactive_wizard >"$OUT" 2>&1 <<'EOF'
1


1
n


password123
password123
EOF
assert_eq "local choice leaves DATABASE_URL empty (installer defaults later)" "" "$SEQDESK_DATABASE_URL"
assert_eq "admin email defaulted" "admin@example.com" "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL"
assert_eq "admin password captured" "password123" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD"
assert_eq "researcher skipped (no email)" "" "$SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL"
assert_eq "researcher disabled" "0" "$SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED"
assert_eq "sequencing center pipeline default was explicitly declined" "0" "$SEQDESK_WITH_PIPELINES"

echo ""
echo "== Case 2b: Workbench explains the choice and creates only the first admin =="
reset_state
TEST_DB_REACHABLE=1
run_interactive_wizard >"$OUT" 2>&1 <<'EOF'

3


1


admin@workbench.test

EOF
assert_eq "workbench profile captured" "research-workbench" "$SEQDESK_DEPLOYMENT_PROFILE"
assert_eq "workbench enables the recommended pipeline runtime" "1" "$SEQDESK_WITH_PIPELINES"
assert_eq "workbench run directory is isolated" \
    "$TEST_TMP_DIR/install-data/pipeline-runs" "$SEQDESK_RUN_DIR"
assert_eq "workbench database cache is isolated from runs" \
    "$TEST_TMP_DIR/install-data/pipeline-databases" "$SEQDESK_PIPELINE_DATABASE_DIR"
assert_eq "workbench creates no bootstrap researcher" "0" "$SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED"
assert_eq "generated admin password is flagged for the final summary" \
    "true" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED"
assert_nonempty "generated admin password is retained for the final summary" \
    "$SEQDESK_GENERATED_ADMIN_PASSWORD"
assert_not_contains "generated admin password is not printed mid-wizard" \
    "$SEQDESK_GENERATED_ADMIN_PASSWORD" "$OUT"
clear_bootstrap_plaintext_passwords
assert_eq "clearing wipes the bootstrap plaintext" "" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD"
assert_nonempty "the summary copy survives the plaintext wipe" \
    "$SEQDESK_GENERATED_ADMIN_PASSWORD"
assert_contains "wizard explains one shared application" \
    "does not install a separate edition" "$OUT"
assert_contains "wizard requires an explicit profile choice" \
    "Choose 1, 2, or 3" "$OUT"
assert_contains "wizard explains how to choose a profile" \
    "External requesters" "$OUT"
assert_contains "workbench defers member creation to onboarding" \
    "Additional accounts are invited" "$OUT"

echo ""
echo "== Case 2c: team-server access requires HTTPS and keeps the app on loopback =="
reset_state
prompt_access_topology >"$OUT" 2>&1 <<'EOF'
2

http://seqdesk.lab.example
https://user:secret@seqdesk.lab.example/private
https://seqdesk.lab.example
EOF
assert_eq "team-server audience is captured" "team-server" "$SEQDESK_ACCESS_AUDIENCE"
assert_eq "same-host reverse proxy keeps the app on loopback" "127.0.0.1" "$SEQDESK_BIND_HOST"
assert_eq "team-server canonical URL is retained" \
    "https://seqdesk.lab.example" "$SEQDESK_NEXTAUTH_URL"
assert_contains "team-server rejects an unencrypted browser URL" \
    "requires the canonical HTTPS URL" "$OUT"
assert_contains "team-server explains the reverse-proxy boundary" \
    "behind an HTTPS reverse proxy" "$OUT"

echo ""
echo "== Case 2c.1: advanced network listeners require explicit consent =="
reset_state
prompt_access_topology >"$OUT" 2>&1 <<'EOF'
3
0.0.0.0

https://seqdesk.lab.example
y
EOF
assert_eq "advanced audience is captured" "advanced" "$SEQDESK_ACCESS_AUDIENCE"
assert_eq "confirmed advanced listener is retained" "0.0.0.0" "$SEQDESK_BIND_HOST"
assert_contains "non-loopback listener explains TLS responsibility" \
    "installer does not configure TLS" "$OUT"

echo ""
echo "== Case 2d: guided storage rejects application-directory overlap =="
reset_state
SEQDESK_DEPLOYMENT_PROFILE="research-workbench"
SEQDESK_WITH_PIPELINES="1"
SEQDESK_DATA_PATH="$SEQDESK_DIR/data"
SEQDESK_RUN_DIR="$SEQDESK_DATA_PATH/pipeline-runs"
SEQDESK_PIPELINE_DATABASE_DIR="$SEQDESK_DATA_PATH/pipeline-databases"
if validate_guided_storage_layout >"$OUT" 2>&1; then
    echo "FAIL: storage inside the application directory was accepted" >&2
    FAILURES=$((FAILURES + 1))
else
    echo "ok: storage inside the application directory is rejected"
fi
assert_contains "storage rejection explains update/rollback isolation" \
    "out of application update/rollback operations" "$OUT"

SEQDESK_DATA_PATH="$TEST_TMP_DIR/custom-data"
SEQDESK_RUN_DIR="$SEQDESK_DATA_PATH/pipeline-runs"
SEQDESK_PIPELINE_DATABASE_DIR="$SEQDESK_DATA_PATH/pipeline-databases"
if validate_guided_storage_layout >"$OUT" 2>&1; then
    echo "ok: dedicated sibling storage is accepted"
else
    echo "FAIL: dedicated sibling storage was rejected" >&2
    FAILURES=$((FAILURES + 1))
fi

echo ""
echo "== Case 2e: the normalized install plan is versioned and secret-free =="
reset_state
SEQDESK_DEPLOYMENT_PROFILE="research-workbench"
SEQDESK_ACCESS_AUDIENCE="team-server"
SEQDESK_BIND_HOST="127.0.0.1"
SEQDESK_PORT="8443"
SEQDESK_NEXTAUTH_URL="https://seqdesk.lab.example"
SEQDESK_DATABASE_URL="postgresql://seqdesk:database-secret@db.example/seqdesk"
SEQDESK_DATABASE_DIRECT_URL="postgresql://owner:direct-secret@db.example/seqdesk"
SEQDESK_BOOTSTRAP_ADMIN_EMAIL="admin@lab.example"
SEQDESK_BOOTSTRAP_ADMIN_PASSWORD="account-secret"
SEQDESK_WITH_PIPELINES="1"
PIPELINES_ENABLED="true"
SEQDESK_DATA_PATH="$TEST_TMP_DIR/plan-data"
SEQDESK_RUN_DIR="$SEQDESK_DATA_PATH/pipeline-runs"
SEQDESK_PIPELINE_DATABASE_DIR="$SEQDESK_DATA_PATH/pipeline-databases"
PLAN_RELEASE_VERSION="9.8.7"
PLAN_RELEASE_CHECKSUM="sha256:abcdef"
PLAN_RELEASE_SIZE="123456"
plan_json="$(build_install_plan_json)"
assert_contains "plan schema is versioned" '"schemaVersion": 1' <(printf '%s\n' "$plan_json")
assert_contains "plan carries the selected profile" \
    '"profile": "research-workbench"' <(printf '%s\n' "$plan_json")
assert_contains "plan separates browser and bind values" \
    '"bindHost": "127.0.0.1"' <(printf '%s\n' "$plan_json")
assert_contains "plan contains a protected database reference" \
    '"runtimeUrlRef": "protected-input:database-url"' <(printf '%s\n' "$plan_json")
assert_contains "plan contains a protected password reference" \
    '"passwordRef": "protected-operator-input"' <(printf '%s\n' "$plan_json")
assert_not_contains "plan omits the database password" \
    "database-secret" <(printf '%s\n' "$plan_json")
assert_not_contains "plan omits the migration password" \
    "direct-secret" <(printf '%s\n' "$plan_json")
assert_not_contains "plan omits the administrator password" \
    "account-secret" <(printf '%s\n' "$plan_json")

SEQDESK_USE_PM2=""
resolve_service_mode_for_plan >"$OUT" 2>&1 <<'EOF'

EOF
assert_eq "guided service choice defaults to PM2 before review" "true" "$SEQDESK_USE_PM2"
service_plan_json="$(build_install_plan_json)"
assert_contains "plan records the reviewed service manager" \
    '"manager": "pm2"' <(printf '%s\n' "$service_plan_json")
assert_contains "guided service choice explains when manual startup fits" \
    "short evaluations" "$OUT"

echo ""
echo "== Case 2f: --plan --json leaves an existing installation unchanged =="
PLAN_FIXTURE_DIR="$TEST_TMP_DIR/existing-plan-install"
mkdir -p "$PLAN_FIXTURE_DIR"
cat >"$PLAN_FIXTURE_DIR/package.json" <<'EOF'
{"name":"seqdesk","version":"9.8.7"}
EOF
cat >"$PLAN_FIXTURE_DIR/settings.json" <<EOF
{
  "deployment": {"profile": "shared-lab"},
  "app": {"port": 8123},
  "runtime": {
    "nextAuthUrl": "https://seqdesk.lab.example",
    "databaseUrl": "postgresql://seqdesk:fixture-secret@db.example/seqdesk"
  },
  "site": {"dataBasePath": "$TEST_TMP_DIR/existing-data"},
  "pipelines": {"enabled": false}
}
EOF
before_plan_hash="$(shasum -a 256 "$PLAN_FIXTURE_DIR/package.json" "$PLAN_FIXTURE_DIR/settings.json")"
plan_cli_json="$(env -u SEQDESK_INSTALL_LIB_ONLY \
    bash "$REPO_ROOT/scripts/install-dist.sh" --plan --json --reconfigure \
    --dir "$PLAN_FIXTURE_DIR" --without-pipelines 2>"$OUT")"
plan_cli_status=$?
after_plan_hash="$(shasum -a 256 "$PLAN_FIXTURE_DIR/package.json" "$PLAN_FIXTURE_DIR/settings.json")"
assert_eq "plan CLI exits successfully" "0" "$plan_cli_status"
if printf '%s' "$plan_cli_json" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))'; then
    echo "ok: plan CLI stdout is one JSON document"
else
    echo "FAIL: plan CLI stdout is not valid JSON" >&2
    FAILURES=$((FAILURES + 1))
fi
assert_contains "plan CLI classifies the existing installation" \
    '"classification": "existing-seqdesk"' <(printf '%s\n' "$plan_cli_json")
assert_not_contains "plan CLI redacts settings-file credentials" \
    "fixture-secret" <(printf '%s\n' "$plan_cli_json")
assert_eq "plan CLI does not rewrite existing files" "$before_plan_hash" "$after_plan_hash"

echo ""
echo "== Case 2g: existing target classification selects a safe maintenance journey =="
TARGET_NEW="$TEST_TMP_DIR/target-new"
TARGET_EMPTY="$TEST_TMP_DIR/target-empty"
TARGET_VALID="$TEST_TMP_DIR/target-valid"
TARGET_PARTIAL="$TEST_TMP_DIR/target-partial"
TARGET_UNRELATED="$TEST_TMP_DIR/target-unrelated"
mkdir -p "$TARGET_EMPTY" "$TARGET_VALID/current" "$TARGET_PARTIAL/releases" "$TARGET_UNRELATED"
printf '{"name":"seqdesk","version":"1.2.3"}\n' > "$TARGET_VALID/current/package.json"
printf 'keep me\n' > "$TARGET_UNRELATED/research-notes.txt"

SEQDESK_DIR="$TARGET_NEW"
assert_eq "a missing path is a new install" "new" "$(classify_install_target)"
SEQDESK_DIR="$TARGET_EMPTY"
assert_eq "an existing empty directory is safe for a fresh install" \
    "empty-directory" "$(classify_install_target)"
SEQDESK_DIR="$TARGET_VALID"
assert_eq "a versioned SeqDesk install is recognized" \
    "existing-seqdesk" "$(classify_install_target)"
SEQDESK_DIR="$TARGET_PARTIAL"
assert_eq "an interrupted release layout is recognized" \
    "partial-seqdesk" "$(classify_install_target)"
SEQDESK_DIR="$TARGET_UNRELATED"
assert_eq "unrelated files are not mistaken for SeqDesk" \
    "unrelated-existing" "$(classify_install_target)"

maintenance_result="$(
    (
        reset_state
        SEQDESK_DIR="$TARGET_VALID"
        resolve_install_operation <<'EOF'
1
EOF
        printf 'update=%s\noverwrite=%s\n' "$SEQDESK_UPDATE_EXISTING" "$SEQDESK_OVERWRITE_EXISTING"
    ) 2>&1
)"
assert_contains "existing install offers and selects update" \
    "update=1" <(printf '%s\n' "$maintenance_result")
assert_contains "guided update authorizes only the update operation" \
    "overwrite=1" <(printf '%s\n' "$maintenance_result")

maintenance_result="$(
    (
        reset_state
        SEQDESK_DIR="$TARGET_VALID"
        resolve_install_operation <<'EOF'
2
EOF
        printf 'reconfigure=%s\n' "$SEQDESK_RECONFIGURE"
    ) 2>&1
)"
assert_contains "existing install can select reconfigure" \
    "reconfigure=1" <(printf '%s\n' "$maintenance_result")

partial_recovery_result="$(
    (
        reset_state
        SEQDESK_DIR="$TARGET_PARTIAL"
        resolve_install_operation <<'EOF'
2
EOF
        printf 'overwrite=%s\n' "$SEQDESK_OVERWRITE_EXISTING"
    ) 2>&1
)"
assert_contains "partial target offers explicit backup-and-restart recovery" \
    "overwrite=1" <(printf '%s\n' "$partial_recovery_result")

partial_diagnosis_result="$(
    (
        reset_state
        SEQDESK_DIR="$TARGET_PARTIAL"
        resolve_install_operation <<'EOF'
1
EOF
    ) 2>&1
)"
assert_contains "partial target receives diagnosis guidance" \
    "doctor --dir" <(printf '%s\n' "$partial_diagnosis_result")

if ( reset_state; SEQDESK_DIR="$TARGET_UNRELATED"; resolve_install_operation ) >"$OUT" 2>&1; then
    echo "FAIL: unrelated target entered a fresh install without explicit overwrite" >&2
    FAILURES=$((FAILURES + 1))
else
    echo "ok: unrelated target stops before setup questions"
fi
assert_contains "unrelated target is described honestly" \
    "is not a SeqDesk installation" "$OUT"

echo ""
echo "== Case 2h: update/reconfigure preserve the installed deployment profile =="
cat >"$TARGET_VALID/settings.json" <<'EOF'
{
  "deployment": {"profile": "shared-lab"},
  "runtime": {"databaseUrl": "postgresql://seqdesk:secret@localhost/seqdesk"}
}
EOF
if (
    reset_state
    SEQDESK_DIR="$TARGET_VALID"
    SEQDESK_DEPLOYMENT_PROFILE="research-workbench"
    load_existing_install_values "$TARGET_VALID"
) >"$OUT" 2>&1; then
    echo "FAIL: maintenance accepted a conflicting deployment profile" >&2
    FAILURES=$((FAILURES + 1))
else
    echo "ok: maintenance rejects a profile switch"
fi
assert_contains "profile conflict requires a future migration command" \
    "profile change requires a future explicit migration command" "$OUT"

reset_state
SEQDESK_DIR="$TARGET_VALID"
load_existing_install_values "$TARGET_VALID" >"$OUT" 2>&1
assert_eq "maintenance loads the installed profile" "shared-lab" "$SEQDESK_DEPLOYMENT_PROFILE"
SEQDESK_UPDATE_EXISTING="1"
PIPELINES_ENABLED="false"
PLAN_RELEASE_VERSION="1.2.4"
PLAN_RELEASE_CHECKSUM="sha256:abcdef"
PLAN_RELEASE_SIZE="123"
update_plan_json="$(build_install_plan_json)"
assert_contains "update plan has no bootstrap credential operation" \
    '"passwordRef": "not-applicable"' <(printf '%s\n' "$update_plan_json")

echo ""
echo "== Case 2i: versioned update layout preserves shared profile and scientific state =="
UPDATE_LAYOUT="$TEST_TMP_DIR/update-layout"
UPDATE_RELEASE="$UPDATE_LAYOUT/releases/1.2.4"
mkdir -p "$UPDATE_LAYOUT/data" "$UPDATE_LAYOUT/pipelines/private-package" \
    "$UPDATE_LAYOUT/pipeline_runs" "$UPDATE_RELEASE/data" "$UPDATE_RELEASE/pipelines/public-package"
printf '{"deployment":{"profile":"shared-lab"}}\n' > "$UPDATE_LAYOUT/settings.json"
printf 'scientific-data\n' > "$UPDATE_LAYOUT/data/existing.fastq"
printf 'private-pipeline\n' > "$UPDATE_LAYOUT/pipelines/private-package/manifest.json"
printf '{"deployment":{"profile":"sequencing-center"}}\n' > "$UPDATE_RELEASE/settings.json"
printf 'bundled-data\n' > "$UPDATE_RELEASE/data/bundled.txt"
printf 'public-pipeline\n' > "$UPDATE_RELEASE/pipelines/public-package/manifest.json"
SEQDESK_DIR="$UPDATE_LAYOUT"
sync_release_shared_paths "$UPDATE_RELEASE"
activate_current_release "1.2.4"
assert_contains "shared deployment profile survives release staging" \
    '"profile":"shared-lab"' "$UPDATE_LAYOUT/settings.json"
assert_contains "existing scientific data survives release staging" \
    "scientific-data" "$UPDATE_LAYOUT/data/existing.fastq"
assert_contains "installed private pipeline survives release staging" \
    "private-pipeline" "$UPDATE_LAYOUT/pipelines/private-package/manifest.json"
assert_eq "new release reads the shared settings file" \
    "../../settings.json" "$(readlink "$UPDATE_RELEASE/settings.json")"
assert_eq "new release reads the shared data directory" \
    "../../data" "$(readlink "$UPDATE_RELEASE/data")"
assert_eq "activation uses the versioned release" \
    "releases/1.2.4" "$(readlink "$UPDATE_LAYOUT/current")"

echo ""
echo "== Case 2j: apply lock and recovery checkpoint are safe and secret-free =="
reset_state
SEQDESK_DIR="$TEST_TMP_DIR/locked-install"
SEQDESK_DEPLOYMENT_PROFILE="research-workbench"
SEQDESK_DATABASE_URL="postgresql://seqdesk:CHECKPOINT_DB_SECRET@localhost/seqdesk"
SEQDESK_BOOTSTRAP_ADMIN_PASSWORD="CHECKPOINT_ADMIN_SECRET"
LATEST_VERSION="1.2.4"
acquire_install_lock
assert_eq "installer lock records the owning process" \
    "$$" "$(cat "$INSTALL_LOCK_DIR/pid")"
if acquire_install_lock >"$OUT" 2>&1; then
    echo "FAIL: a second install operation acquired the same target lock" >&2
    FAILURES=$((FAILURES + 1))
else
    echo "ok: concurrent install operation is refused"
fi
assert_contains "lock conflict identifies the active process" \
    "already running" "$OUT"
write_install_checkpoint "database-ready" "Database target prepared and reachable"
assert_contains "checkpoint records the selected profile" \
    '"deploymentProfile": "research-workbench"' "$INSTALL_CHECKPOINT_PATH"
assert_contains "checkpoint records the current apply phase" \
    '"phase": "database-ready"' "$INSTALL_CHECKPOINT_PATH"
assert_not_contains "checkpoint omits the database password" \
    "CHECKPOINT_DB_SECRET" "$INSTALL_CHECKPOINT_PATH"
assert_not_contains "checkpoint omits the administrator password" \
    "CHECKPOINT_ADMIN_SECRET" "$INSTALL_CHECKPOINT_PATH"
complete_install_checkpoint
assert_eq "successful completion removes the lock" \
    "absent" "$([ -e "$INSTALL_LOCK_DIR" ] && printf present || printf absent)"
assert_eq "successful completion removes the checkpoint" \
    "absent" "$([ -e "$INSTALL_CHECKPOINT_PATH" ] && printf present || printf absent)"

reset_state
PM2_CONFIGURED="true"
enable_doctor_for_persistent_service
assert_eq "persistent services enable automatic doctor verification" \
    "1" "$SEQDESK_RUN_DOCTOR"
SEQDESK_RUN_DOCTOR="0"
enable_doctor_for_persistent_service
assert_eq "automation can explicitly opt out of automatic doctor" \
    "0" "$SEQDESK_RUN_DOCTOR"

echo ""
echo "== Case 3: wizard is a no-op under -y (unattended must be untouched) =="
reset_state
SEQDESK_YES="1"
SEQDESK_BOOTSTRAP_ADMIN_EMAIL=""
run_interactive_wizard >"$OUT" 2>&1 <<'EOF'
2
postgresql://should:not@be.used:5432/db
EOF
assert_eq "no prompts consumed under -y (admin email stays empty)" "" "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL"
assert_eq "no DATABASE_URL set under -y" "" "$SEQDESK_DATABASE_URL"

echo ""
echo "== Case 3a: unattended fresh install gets a secure admin and no generic member =="
reset_state
SEQDESK_YES="1"
ensure_secure_bootstrap_accounts >"$OUT" 2>&1
assert_eq "unattended admin email defaults safely" "admin@example.com" "$SEQDESK_BOOTSTRAP_ADMIN_EMAIL"
assert_nonempty "unattended admin password generated" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD"
assert_eq "unattended generated password is flagged" "true" "$SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED"
assert_eq "unattended generic researcher disabled" "0" "$SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED"

echo ""
echo "== Case 3b: generated macOS socket URLs remain usable by installer helpers =="
socket_url_result="$(
    (
        OS="macos"
        MACOS_POSTGRES_SOCKET_DIR="/tmp"
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        configure_postgres_urls >/dev/null
        load_postgres_url_parts
        printf 'url=%s\n' "$SEQDESK_DATABASE_URL"
        printf 'direct=%s\n' "$SEQDESK_DATABASE_DIRECT_URL"
        printf 'host=%s\n' "$PG_HOST"
        printf 'port=%s\n' "$PG_PORT"
        printf 'target=%s\n' "$(postgres_url_host_port "$SEQDESK_DATABASE_URL")"
    )
)"
assert_contains "generated URL selects the encoded /tmp socket" \
    "host=%2Ftmp" <(printf '%s\n' "$socket_url_result")
socket_database_url="$(printf '%s\n' "$socket_url_result" | sed -n 's/^url=//p')"
socket_direct_url="$(printf '%s\n' "$socket_url_result" | sed -n 's/^direct=//p')"
assert_eq "generated socket URL is also used for DIRECT_URL" \
    "$socket_database_url" "$socket_direct_url"
assert_contains "URL parser exposes the socket directory to psql helpers" \
    "host=/tmp" <(printf '%s\n' "$socket_url_result")
assert_contains "target parser classifies the Unix socket" \
    $'target=/tmp\t5432' <(printf '%s\n' "$socket_url_result")

echo ""
echo "== Case 3c: local database bootstrap uses the configured socket explicitly =="
socket_bootstrap_result="$(
    (
        SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@localhost:5432/seqdesk?schema=public&host=%2Ftmp"
        TEST_CONNECTION_CALLS=0
        postgres_connection_ready() {
            TEST_CONNECTION_CALLS=$((TEST_CONNECTION_CALLS + 1))
            [ "$TEST_CONNECTION_CALLS" -ge 2 ]
        }
        sudo_postgres_ready() { return 0; }
        find_postgres_binary() { printf '/mock/bin/psql'; }
        run_with_spinner() {
            printf 'command='
            printf ' %s' "$@"
            printf '\n'
            return 0
        }
        ensure_local_postgres_database
    )
)"
assert_contains "bootstrap passes the socket directory to psql" \
    "-h /tmp -p 5432" <(printf '%s\n' "$socket_bootstrap_result")

echo ""
echo "== Case 4: macOS PostgreSQL recovery never recommends sudo Homebrew startup =="
OS="macos"
DISTRO="macos"
SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk"
SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
SEQDESK_DIR="/tmp/seqdesk-test-install"
load_postgres_url_parts() { return 0; }
print_postgres_setup_instructions >"$OUT" 2>&1
assert_contains "macOS recovery names normal login user" "normal macOS login user" "$OUT"
assert_contains "macOS recovery explicitly rejects sudo" "do not use sudo" "$OUT"
assert_not_contains "macOS recovery does not invoke launcher with sudo" "sudo env SEQDESK_DATABASE_URL" "$OUT"

echo ""
echo "== Case 5: explicit TCP URLs remain explicit when only the socket works =="
FAKE_PG_ISREADY="$TEST_TMP_DIR/pg_isready"
cat > "$FAKE_PG_ISREADY" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "-h" ] && [ "${2:-}" = "/tmp" ]; then
    exit 0
fi
exit 2
EOF
chmod +x "$FAKE_PG_ISREADY"
find_postgres_binary() { printf '%s' "$FAKE_PG_ISREADY"; }
TEST_DB_REACHABLE=1
if postgres_server_ready; then
    ready_status=0
else
    ready_status=$?
fi
assert_eq "failed pg_isready remains a preflight failure" "2" "$ready_status"
print_macos_postgres_protocol_diagnosis >"$OUT" 2>&1
assert_contains "socket-only health is classified explicitly" \
    "answers on its Unix socket, but not over TCP" "$OUT"
assert_contains "explicit URLs are not silently rewritten" \
    "left unchanged" "$OUT"
assert_contains "socket URL recovery is shown" \
    "host=%2Ftmp" "$OUT"
assert_contains "socket-only health points to endpoint filtering" \
    "endpoint-security tool" "$OUT"
assert_contains "socket-only health links to exact troubleshooting instructions" \
    "https://seqdesk.org/docs/installation/macos#postgresql-unix-socket-works-but-tcp-does-not" "$OUT"

alternate_socket_diagnosis="$(
    (
        PG_HOST="/var/run/postgresql"
        PG_PORT="5432"
        SEQDESK_DATABASE_URL="postgresql:///seqdesk?schema=public&host=%2Fvar%2Frun%2Fpostgresql"
        print_macos_postgres_protocol_diagnosis
    )
)"
assert_contains "an unavailable explicit socket is labeled as a socket" \
    "configured PostgreSQL Unix socket is unavailable" \
    <(printf '%s\n' "$alternate_socket_diagnosis")
assert_not_contains "an explicit socket is not mislabeled as TCP" \
    "configured PostgreSQL TCP" <(printf '%s\n' "$alternate_socket_diagnosis")

echo ""
echo "== Case 5a: review-time PostgreSQL preflight performs no mutations =="
readonly_preflight_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        SEQDESK_PREFLIGHT_READ_ONLY="true"
        postgres_server_ready() { return 1; }
        try_reuse_local_postgres_socket() { return 2; }
        find_postgres_binary() { printf '/mock/bin/initdb'; }
        try_adopt_registered_brew_postgres() {
            echo "UNEXPECTED service start"
            return 0
        }
        install_postgres_packages_if_possible() {
            echo "UNEXPECTED package install"
            return 0
        }
        provision_private_postgres() {
            echo "UNEXPECTED private provisioning"
            return 0
        }
        preflight_local_postgres
    )
)"
assert_contains "read-only preflight defers database preparation" \
    "after confirmation" <(printf '%s\n' "$readonly_preflight_result")
assert_not_contains "read-only preflight does not start a service" \
    "UNEXPECTED service start" <(printf '%s\n' "$readonly_preflight_result")
assert_not_contains "read-only preflight does not install a package" \
    "UNEXPECTED package install" <(printf '%s\n' "$readonly_preflight_result")
assert_not_contains "read-only preflight does not provision a cluster" \
    "UNEXPECTED private provisioning" <(printf '%s\n' "$readonly_preflight_result")

echo ""
echo "== Case 5b: fresh macOS installs automatically reuse a healthy socket =="
socket_fallback_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        MACOS_POSTGRES_SOCKET_DIR=""
        postgres_server_ready() { return 1; }
        # Only /tmp is healthy here, so the candidate search has to reach it
        # rather than stopping at the first directory it probes.
        postgres_socket_server_ready() { [ "${1:-}" = "/tmp" ]; }
        postgres_socket_owned_by_current_user() { return 0; }
        postgres_socket_admin_ready() { return 0; }
        install_postgres_packages_if_possible() {
            echo "UNEXPECTED package install"
            return 1
        }
        try_adopt_registered_brew_postgres() {
            echo "UNEXPECTED service start"
            return 1
        }
        provision_private_postgres() {
            echo "UNEXPECTED private provisioning"
            return 1
        }

        preflight_local_postgres
        configure_postgres_urls >/dev/null
        printf 'selected=%s\n' "$MACOS_POSTGRES_SOCKET_DIR"
        printf 'url=%s\n' "$SEQDESK_DATABASE_URL"
        printf 'direct=%s\n' "$SEQDESK_DATABASE_DIRECT_URL"
    )
)"
assert_contains "fresh install reports safe socket reuse" \
    "Reusing PostgreSQL via Unix socket /tmp:5432" <(printf '%s\n' "$socket_fallback_result")
assert_contains "fresh install records the selected socket" \
    "selected=/tmp" <(printf '%s\n' "$socket_fallback_result")
assert_contains "fresh install persists the socket in DATABASE_URL" \
    "host=%2Ftmp" <(printf '%s\n' "$socket_fallback_result")
assert_not_contains "healthy socket avoids another Homebrew install" \
    "UNEXPECTED package install" <(printf '%s\n' "$socket_fallback_result")
assert_not_contains "healthy socket avoids starting another PostgreSQL version" \
    "UNEXPECTED service start" <(printf '%s\n' "$socket_fallback_result")
assert_not_contains "healthy socket avoids provisioning a private instance" \
    "UNEXPECTED private provisioning" <(printf '%s\n' "$socket_fallback_result")

echo ""
echo "== Case 5c: an untrusted /tmp socket is never sent generated credentials =="
untrusted_socket_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        postgres_server_ready() { return 1; }
        postgres_socket_server_ready() { return 0; }
        postgres_socket_owned_by_current_user() { return 1; }
        postgres_socket_admin_ready() {
            echo "UNEXPECTED credentialed query"
            return 0
        }
        start_postgres_if_possible() {
            echo "UNEXPECTED service start"
            return 1
        }
        try_adopt_registered_brew_postgres() { return 1; }
        # An unusable socket must not end the install: the ladder continues to a
        # server SeqDesk does own. Stopping here broke every Linux host whose
        # system PostgreSQL listens only on /var/run/postgresql, a socket owned
        # by the postgres account rather than the installing user.
        provision_private_postgres() {
            echo "fell through to a private instance"
            return 0
        }
        if preflight_local_postgres; then
            echo "status=0"
        else
            echo "status=$?"
        fi
    )
)"
assert_contains "an unusable socket does not abort the install" \
    "status=0" <(printf '%s\n' "$untrusted_socket_result")
assert_contains "the ladder continues to a private instance" \
    "fell through to a private instance" <(printf '%s\n' "$untrusted_socket_result")
assert_contains "untrusted socket ownership is explained" \
    "SeqDesk will not send generated database credentials" <(printf '%s\n' "$untrusted_socket_result")
assert_not_contains "untrusted socket receives no credentialed query" \
    "UNEXPECTED credentialed query" <(printf '%s\n' "$untrusted_socket_result")
assert_not_contains "untrusted socket does not trigger another service" \
    "UNEXPECTED service start" <(printf '%s\n' "$untrusted_socket_result")

echo ""
echo "== Case 5d: a socket discovered after a start attempt keeps the ownership error =="
post_start_untrusted_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL=""
        TEST_SOCKET_READY_CALLS=0
        postgres_server_ready() { return 1; }
        postgres_socket_server_ready() {
            TEST_SOCKET_READY_CALLS=$((TEST_SOCKET_READY_CALLS + 1))
            [ "$TEST_SOCKET_READY_CALLS" -ge 2 ]
        }
        postgres_socket_owned_by_current_user() { return 1; }
        install_postgres_packages_if_possible() { return 0; }
        start_postgres_if_possible() { return 1; }
        if preflight_local_postgres; then
            echo "status=0"
        else
            echo "status=$?"
        fi
    )
)"
assert_contains "post-start untrusted socket stops the preflight" \
    "status=1" <(printf '%s\n' "$post_start_untrusted_result")
assert_contains "post-start untrusted socket prints the ownership diagnosis" \
    "SeqDesk will not send generated database credentials" <(printf '%s\n' "$post_start_untrusted_result")

echo ""
echo "== Case 5e: the socket admin probe is isolated and bounded =="
ADMIN_PROBE_CAPTURE="$TEST_TMP_DIR/admin-probe"
if (
    find_postgres_binary() { printf '/mock/bin/psql'; }
    run_as_postgres() {
        printf 'timeout=%s\n' "${PGCONNECT_TIMEOUT:-}" > "$ADMIN_PROBE_CAPTURE"
        printf 'arg=%s\n' "$@" >> "$ADMIN_PROBE_CAPTURE"
        printf '160000\n'
    }
    postgres_socket_admin_ready /tmp 5432
); then
    admin_probe_status=0
else
    admin_probe_status=$?
fi
assert_eq "socket admin probe accepts a PostgreSQL 16 superuser result" \
    "0" "$admin_probe_status"
assert_contains "socket admin probe has a connection timeout" \
    "timeout=5" "$ADMIN_PROBE_CAPTURE"
assert_contains "socket admin probe ignores user psql startup files" \
    "arg=-X" "$ADMIN_PROBE_CAPTURE"

echo ""
echo "== Case 5f: DIRECT_URL alone is rejected before local provisioning =="
direct_only_result="$(
    (
        SEQDESK_DATABASE_URL=""
        SEQDESK_DATABASE_DIRECT_URL="postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk"
        install_postgres_packages_if_possible() {
            echo "UNEXPECTED package install"
            return 1
        }
        if preflight_local_postgres; then
            echo "status=0"
        else
            echo "status=$?"
        fi
    )
)"
assert_contains "DIRECT_URL-only input stops the preflight" \
    "status=1" <(printf '%s\n' "$direct_only_result")
assert_contains "DIRECT_URL-only input names the missing pair" \
    "DIRECT_URL was supplied without DATABASE_URL" <(printf '%s\n' "$direct_only_result")
assert_not_contains "DIRECT_URL-only input cannot start provisioning" \
    "UNEXPECTED package install" <(printf '%s\n' "$direct_only_result")

echo ""
echo "== Case 6: stale root service points to the healthy PostgreSQL 14 service =="
brew() {
    if [ "${1:-}" = "--prefix" ]; then
        printf '%s' "$TEST_TMP_DIR/brew"
        return 0
    fi
    if [ "${1:-}" = "services" ] && [ "${2:-}" = "list" ]; then
        printf 'Name Status User File\npostgresql@14 started tester test.plist\npostgresql@16 error 78 root.plist\n'
        return 0
    fi
    if [ "${1:-}" = "list" ] && [ "${2:-}" = "--versions" ]; then
        [ "${3:-}" = "postgresql@16" ] || [ "${3:-}" = "postgresql@14" ]
        return $?
    fi
    if [ "${1:-}" = "services" ] && [ "${2:-}" = "start" ] && [ "${3:-}" = "postgresql@14" ]; then
        return 0
    fi
    return 1
}
macos_brew_service_runs_as_root() { [ "$1" = "postgresql@16" ]; }
MACOS_ROOT_POSTGRES_WARNING_SHOWN=""
warn_macos_root_postgres_services >"$OUT" 2>&1
assert_contains "root service cause is explicit" "registered to run as root" "$OUT"
assert_contains "healthy supported service is reused" "'postgresql@14' is already running" "$OUT"
assert_not_contains "conflicting PostgreSQL 16 start is not recommended" "brew services start postgresql@16" "$OUT"
assert_eq "installed formula discovery prefers the running PostgreSQL major" \
    "postgresql@14" "$(find_installed_brew_postgres_formula)"

MACOS_ROOT_POSTGRES_WARNING_SHOWN=1
sudo_postgres_ready() { return 0; }
postgres_server_ready() { return 0; }
start_postgres_if_possible >"$OUT" 2>&1
assert_contains "already-running supported service is selected first" \
    "Starting PostgreSQL with Homebrew (postgresql@14)" "$OUT"
assert_not_contains "conflicting PostgreSQL 16 service is not started" \
    "Starting PostgreSQL with Homebrew (postgresql@16)" "$OUT"

echo ""
echo "== Case 7: historical PostgreSQL errors are not presented as current =="
mkdir -p "$TEST_TMP_DIR/brew/var/log"
printf '2000-01-01 FATAL: lock file "postmaster.pid" already exists\n' \
    > "$TEST_TMP_DIR/brew/var/log/postgresql@14.log"
touch -t 200001010000 "$TEST_TMP_DIR/brew/var/log/postgresql@14.log"
print_macos_brew_postgres_failure postgresql@14 >"$OUT" 2>&1
assert_contains "historical log errors are identified and omitted" \
    "historical errors omitted" "$OUT"
assert_not_contains "historical lock error is not presented as current" \
    "lock file \"postmaster.pid\" already exists" "$OUT"

echo ""
echo "== Case 8: macOS preflight reuses a healthy local server before download =="
SEQDESK_DATABASE_URL=""
SEQDESK_DATABASE_DIRECT_URL=""
sudo_postgres_ready() { return 1; }
postgres_server_ready() { return 0; }
preflight_local_postgres >"$OUT" 2>&1
assert_contains "healthy server is reused" "PostgreSQL is already available" "$OUT"

echo ""
echo "== Case 9: failed macOS preflight clearly stops before installation =="
SEQDESK_DATABASE_URL=""
SEQDESK_DATABASE_DIRECT_URL=""
sudo_postgres_ready() { return 1; }
postgres_server_ready() { return 1; }
postgres_socket_server_ready() { return 1; }
install_postgres_packages_if_possible() { return 0; }
# Every rung of the ladder is exhausted, so the failure diagnosis is reached.
try_adopt_registered_brew_postgres() { return 1; }
provision_private_postgres() { return 1; }
if preflight_local_postgres >"$OUT" 2>&1; then
    preflight_status=0
else
    preflight_status=$?
fi
assert_eq "failed preflight returns non-zero" "1" "$preflight_status"
assert_contains "preflight failure says the target was not replaced" \
    "install target was not replaced" "$OUT"
assert_contains "preflight failure gives rerun guidance" "Rerun the same command" "$OUT"
assert_contains "preflight failure offers the managed-database escape hatch" \
    "--database-url" "$OUT"
assert_contains "preflight failure warns against deleting a live PID file" \
    "Do not remove postmaster.pid while a live postgres process owns it" "$OUT"

echo ""
echo "== Case 10: managed PostgreSQL skips local Homebrew provisioning =="
SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@db.example.org:5432/seqdesk"
preflight_local_postgres >"$OUT" 2>&1
assert_eq "managed database preflight is silent" "" "$(cat "$OUT")"

echo ""
echo "== Case 11: clean macOS preflight adopts an installed-but-idle Homebrew service =="
SEQDESK_DATABASE_URL=""
SEQDESK_DATABASE_DIRECT_URL=""
TEST_SERVER_READY_CALLS=0
postgres_server_ready() {
    TEST_SERVER_READY_CALLS=$((TEST_SERVER_READY_CALLS + 1))
    [ "$TEST_SERVER_READY_CALLS" -ge 2 ]
}
postgres_socket_server_ready() { return 1; }
install_postgres_packages_if_possible() {
    echo "mock install postgresql@16"
    return 0
}
try_adopt_registered_brew_postgres() {
    echo "mock adopt registered postgresql@16"
    return 0
}
provision_private_postgres() {
    echo "UNEXPECTED private provisioning"
    return 1
}
preflight_local_postgres >"$OUT" 2>&1
assert_contains "an existing Homebrew service is adopted" "mock adopt registered postgresql@16" "$OUT"
assert_contains "adopted service reaches ready state" "PostgreSQL is ready" "$OUT"
assert_not_contains "adoptable service is not replaced by a private instance" \
    "UNEXPECTED private provisioning" "$OUT"

echo ""
echo "== Case 11b: nothing usable falls back to a private instance =="
postgres_server_ready() { return 1; }
postgres_socket_server_ready() { return 1; }
try_adopt_registered_brew_postgres() { return 1; }
provision_private_postgres() {
    echo "mock provisioned private instance"
    return 0
}
if preflight_local_postgres >"$OUT" 2>&1; then
    preflight_status=0
else
    preflight_status=$?
fi
assert_eq "private fallback succeeds" "0" "$preflight_status"
assert_contains "private instance is provisioned when nothing else works" \
    "mock provisioned private instance" "$OUT"

echo ""
echo "== Case 11c: an explicit DATABASE_URL is never replaced by a private instance =="
SEQDESK_DATABASE_URL="postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk"
SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
load_postgres_url_parts() { PG_HOST="127.0.0.1"; PG_PORT="5432"; return 0; }
provision_private_postgres() {
    echo "UNEXPECTED private provisioning"
    return 0
}
if preflight_local_postgres >"$OUT" 2>&1; then
    preflight_status=0
else
    preflight_status=$?
fi
assert_eq "unreachable explicit URL fails instead of being replaced" "1" "$preflight_status"
assert_not_contains "explicit URL never triggers private provisioning" \
    "UNEXPECTED private provisioning" "$OUT"
SEQDESK_DATABASE_URL=""
SEQDESK_DATABASE_DIRECT_URL=""

echo ""
echo "== Case 12: local PostgreSQL recovery never prints database credentials =="
OS="linux"
DISTRO="debian"
SENTINEL_DB_PASSWORD="SEQDESK_SENTINEL_DB_PASSWORD_DO_NOT_PRINT"
SEQDESK_DATABASE_URL="postgresql://seqdesk:${SENTINEL_DB_PASSWORD}@127.0.0.1:5432/seqdesk"
SEQDESK_DATABASE_DIRECT_URL="$SEQDESK_DATABASE_URL"
SEQDESK_DIR="$TEST_TMP_DIR/existing-install"
mkdir -p "$SEQDESK_DIR"
printf '{}\n' >"$SEQDESK_DIR/settings.json"
load_postgres_url_parts() { return 0; }
print_postgres_setup_instructions >"$OUT" 2>&1
assert_contains "existing install reuses protected config" \
    "sudo npx -y seqdesk@latest -y --prepare-postgres --dir" "$OUT"
assert_contains "existing install keeps reconfigure recovery" \
    "npx -y seqdesk@latest -y --reconfigure --reseed-db --dir" "$OUT"
assert_not_contains "existing install recovery hides database password" \
    "$SENTINEL_DB_PASSWORD" "$OUT"

SEQDESK_DIR="$TEST_TMP_DIR/fresh-install"
print_postgres_setup_instructions >"$OUT" 2>&1
assert_contains "fresh-host recovery explains missing installed settings" \
    "expected when --prepare-postgres is run before a fresh install" "$OUT"
assert_contains "fresh-host recovery preserves private-shell guidance" \
    "SEQDESK_DATABASE_URL set in your private shell" "$OUT"
assert_not_contains "fresh-host recovery hides database password" \
    "$SENTINEL_DB_PASSWORD" "$OUT"

echo ""
echo "== Case 12b: generated credentials are shown but never written to the log =="
# The install log outlives the session and is easy to paste into an issue, so a
# generated password must reach the terminal (FD 3, duplicated before output is
# teed) without being recorded in the file.
secret_log="$TEST_TMP_DIR/secret-install.log"
: > "$secret_log"
secret_terminal="$(
    bash -c "SEQDESK_INSTALL_LIB_ONLY=1 source '$REPO_ROOT/scripts/install-dist.sh'
        # Set after sourcing: the installer assigns SEQDESK_LOG_ENABLED=false
        # unconditionally at load time.
        SEQDESK_LOG_ENABLED=true
        SEQDESK_LOG='$secret_log'
        exec 3>&1
        exec >>'$secret_log' 2>&1
        print_secret_kv 'Admin password' 'SENTINEL_GENERATED_PW'"
)"
assert_contains "the generated password reaches the terminal" \
    "SENTINEL_GENERATED_PW" <(printf '%s\n' "$secret_terminal")
assert_not_contains "the generated password is not written to the install log" \
    "SENTINEL_GENERATED_PW" "$secret_log"

echo ""
echo "== Case 12c: the rendered install summary shows a real password and next action =="
# Asserting the flag was true is not enough: the shipped v1.1.122 summary printed
# the credential labels with empty values because it read variables that had
# already been wiped. These assertions render the actual summary.
summary_cli="$TEST_TMP_DIR/bin/seqdesk"
mkdir -p "$(dirname "$summary_cli")"
printf '#!/usr/bin/env bash\nexit 0\n' > "$summary_cli"
chmod 755 "$summary_cli"
summary_out="$(
    (
        SEQDESK_LOG_ENABLED="false"
        SEQDESK_RECONFIGURE=""
        SEQDESK_DIR="/opt/seqdesk-test"
        INSTALLED_VERSION="9.9.9"
        PM2_CONFIGURED="false"
        SEQDESK_PORT="8000"
        SEQDESK_BIND_HOST="127.0.0.1"
        SEQDESK_BOOTSTRAP_ADMIN_EMAIL="admin@lab.org"
        SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="true"
        SEQDESK_GENERATED_ADMIN_PASSWORD="AAAAgeneratedAdminAAAA"
        SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED="1"
        SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL="r@lab.org"
        SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="true"
        SEQDESK_GENERATED_RESEARCHER_PASSWORD="BBBBgeneratedResearcherBBBB"
        SEQDESK_USER_CLI_PATH="$summary_cli"
        # The wipe that runs long before the summary in a real install.
        clear_bootstrap_plaintext_passwords
        print_login_summary
        print_success_footer
        print_next_steps
    ) 2>&1
)"
assert_contains "the admin password is rendered, not blank" \
    "AAAAgeneratedAdminAAAA" <(printf '%s\n' "$summary_out")
assert_contains "the researcher password is rendered, not blank" \
    "BBBBgeneratedResearcherBBBB" <(printf '%s\n' "$summary_out")
assert_contains "the summary ends with a success marker" \
    "SUCCESS" <(printf '%s\n' "$summary_out")
assert_contains "the start command is an absolute path" \
    "/opt/seqdesk-test/start.sh" <(printf '%s\n' "$summary_out")
assert_contains "the URL to open is shown" \
    "http://127.0.0.1:8000" <(printf '%s\n' "$summary_out")
assert_contains "the success report hands off to next steps" \
    "What's next" <(printf '%s\n' "$summary_out")
assert_contains "the next steps show the Data Storage CLI command" \
    "$summary_cli storage configure /opt/seqdesk-test/data" <(printf '%s\n' "$summary_out")
assert_contains "the next steps show Data Storage verification" \
    "$summary_cli storage status" <(printf '%s\n' "$summary_out")
assert_contains "the next steps link the Data Storage guide" \
    "https://seqdesk.org/docs/administration/data-storage" <(printf '%s\n' "$summary_out")
assert_contains "the next steps show the optional demo-data command" \
    "$summary_cli demo-data install" <(printf '%s\n' "$summary_out")
assert_contains "the next steps require writable Data Storage for demo data" \
    "Data Storage is configured and writable" <(printf '%s\n' "$summary_out")
assert_contains "the next steps describe the demo-data contents" \
    "example orders, studies, samples, metadata, and synthetic FASTQ files" <(printf '%s\n' "$summary_out")
assert_contains "the next steps show the in-app demo-data alternative" \
    "Admin > Settings > Demo data" <(printf '%s\n' "$summary_out")
assert_contains "the next steps show pipeline discovery" \
    "$summary_cli pipelines list" <(printf '%s\n' "$summary_out")
assert_contains "the next steps show a working first pipeline install" \
    "$summary_cli pipelines install simulate-reads --runtime" <(printf '%s\n' "$summary_out")
assert_contains "the next steps link the detailed pipeline guide" \
    "https://seqdesk.org/docs/pipelines/installing-pipelines" <(printf '%s\n' "$summary_out")

# Guard the general shape: any "<label> password" line must carry a value.
empty_secret_lines="$(printf '%s\n' "$summary_out" | grep -cE '^[[:space:]]+[A-Za-z]+ password[[:space:]]*$' || true)"
assert_eq "no password line is label-only" "0" "$empty_secret_lines"

echo ""
echo "== Case 12d: next steps do not advertise a missing local pipeline CLI =="
missing_cli_out="$(
    (
        SEQDESK_LOG_ENABLED="false"
        SEQDESK_DIR="/opt/seqdesk-test"
        PM2_CONFIGURED="true"
        SEQDESK_PORT="8000"
        SEQDESK_BIND_HOST="127.0.0.1"
        SEQDESK_USER_CLI_PATH=""
        print_next_steps
    ) 2>&1
)"
assert_contains "a missing local CLI is explained" \
    "the local SeqDesk CLI is not available" <(printf '%s\n' "$missing_cli_out")
assert_not_contains "a missing local CLI is not presented as runnable" \
    "pipelines install simulate-reads" <(printf '%s\n' "$missing_cli_out")
assert_not_contains "a missing local CLI does not advertise a missing demo-data command" \
    "demo-data install" <(printf '%s\n' "$missing_cli_out")
assert_contains "a missing local CLI keeps the in-app demo-data path" \
    "Admin > Settings > Demo data" <(printf '%s\n' "$missing_cli_out")
assert_contains "the guide remains available without a local CLI" \
    "https://seqdesk.org/docs/pipelines/installing-pipelines" <(printf '%s\n' "$missing_cli_out")

echo ""
echo "== Case 12e: configured Data Storage is verified instead of replaced =="
configured_storage_out="$(
    (
        SEQDESK_LOG_ENABLED="false"
        SEQDESK_DIR="/opt/seqdesk-test"
        SEQDESK_DATA_PATH="/srv/facility-sequencing"
        PM2_CONFIGURED="true"
        SEQDESK_PORT="8000"
        SEQDESK_BIND_HOST="127.0.0.1"
        SEQDESK_USER_CLI_PATH="$summary_cli"
        print_next_steps
    ) 2>&1
)"
assert_contains "configured storage is checked with status" \
    "$summary_cli storage status" <(printf '%s\n' "$configured_storage_out")
assert_not_contains "configured storage is not replaced with the install default" \
    "storage configure /opt/seqdesk-test/data" <(printf '%s\n' "$configured_storage_out")
assert_contains "configured storage still offers the optional demo dataset" \
    "$summary_cli demo-data install" <(printf '%s\n' "$configured_storage_out")

echo ""
echo "== Case 13: installer failures expose stable troubleshooting URLs =="
print_troubleshooting_url >"$OUT" 2>&1
assert_contains "generic failures link to the common-problems index" \
    "https://seqdesk.org/docs/installation/common-problems" "$OUT"
print_troubleshooting_url \
    "https://seqdesk.org/docs/installation/prerequisites#what-the-installer-checks" \
    >"$OUT" 2>&1
assert_contains "classified failures can link to exact recovery guidance" \
    "https://seqdesk.org/docs/installation/prerequisites#what-the-installer-checks" "$OUT"

echo ""
if [ "$FAILURES" -ne 0 ]; then
    echo "interactive-wizard test: $FAILURES assertion(s) failed" >&2
    exit 1
fi
echo "interactive-wizard test: all assertions passed"
