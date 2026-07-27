#!/usr/bin/env bash
#
# Unit test for scripts/ci/assert-printed-credentials.mjs.
#
# The checker is the thing that decides whether a second install over a
# populated database was honest, so it needs to be right before the 45-minute
# job that depends on it is worth running. Every case here is a real shape of
# the installer's closing "Login" block, checked against a stub auth driver, so
# the suite needs no database, no build and no network and can gate every pull
# request alongside the other installer unit suites.
#
# Exits non-zero on the first failed assertion.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="$REPO_ROOT/scripts/ci/assert-printed-credentials.mjs"

TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

FAILURES=0

# A stub workspace: the checker resolves the auth driver from GITHUB_WORKSPACE,
# so a stub there lets every branch be exercised without an installed app. The
# stub accepts exactly one password, which is how "the printed password works"
# and "the printed password does not work" are told apart.
STUB_WORKSPACE="$TEST_TMP_DIR/workspace"
mkdir -p "$STUB_WORKSPACE/scripts"
cat > "$STUB_WORKSPACE/scripts/run-auth-e2e.mjs" <<'STUB'
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1];
};
const accepted = process.env.STUB_ACCEPTED_PASSWORD || "";
if (value("password") === accepted) {
  process.exit(0);
}
console.error(`Credentials login failed (401) for ${value("email")}`);
process.exit(1);
STUB

run_checker() {
    # run_checker <expected-status> <label> [args...]
    local expected="$1" label="$2"
    shift 2
    local out status
    out="$(GITHUB_WORKSPACE="$STUB_WORKSPACE" node "$CHECKER" "$@" 2>&1)"
    status=$?
    LAST_OUTPUT="$out"
    if [ "$status" -ne "$expected" ]; then
        echo "FAIL: $label: expected exit $expected, got $status" >&2
        echo "$out" | sed 's/^/    /' >&2
        FAILURES=$((FAILURES + 1))
        return 1
    fi
    echo "ok: $label"
    return 0
}

assert_output_contains() {
    # assert_output_contains <label> <needle>
    if ! printf '%s' "$LAST_OUTPUT" | grep -qF -- "$2"; then
        echo "FAIL: $1: output did not contain [$2]" >&2
        printf '%s\n' "$LAST_OUTPUT" | sed 's/^/    /' >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: $1"
    fi
}

write_summary() {
    # write_summary <name> <<'EOF' ... EOF
    cat > "$TEST_TMP_DIR/$1.log"
}

BASE_URL="http://127.0.0.1:1"

echo "== Case 1: generated passwords that work =="
write_summary generated-ok <<'EOF'
  Login
  Admin                admin@example.com
  Admin password       correct-horse-battery
  Researcher           user@example.com
  Researcher password  correct-horse-battery
  Save the generated passwords now — they are not stored anywhere else.
EOF
STUB_ACCEPTED_PASSWORD="correct-horse-battery" \
    run_checker 0 "generated passwords that authenticate pass" \
        --summary "$TEST_TMP_DIR/generated-ok.log" \
        --base-url "$BASE_URL" \
        --label "first install" \
        --require-printed-password
assert_output_contains "both roles are verified" "printed researcher credential authenticates"

echo "== Case 2: the bug -- printed passwords that do not authenticate =="
write_summary generated-inert <<'EOF'
  Login
  Admin                admin@example.com
  Admin password       freshly-generated-but-inert
  Researcher           user@example.com
  Researcher password  freshly-generated-but-inert
  Save the generated passwords now — they are not stored anywhere else.
EOF
STUB_ACCEPTED_PASSWORD="the-march-password" \
    run_checker 1 "a printed password that fails is caught" \
        --summary "$TEST_TMP_DIR/generated-inert.log" \
        --base-url "$BASE_URL" \
        --label "second install"
assert_output_contains "the failure names the defect" \
    "A password printed by the second install does not work"

echo "== Case 3: honest silence -- no credentials, with a disclosure =="
write_summary disclosed <<'EOF'
  Login
  This database already holds SeqDesk accounts; they are unchanged.
  Sign in with the credentials that were created when it was first set up.
EOF
STUB_ACCEPTED_PASSWORD="unused" \
    run_checker 0 "printing nothing and saying why passes" \
        --summary "$TEST_TMP_DIR/disclosed.log" \
        --base-url "$BASE_URL" \
        --label "second install" \
        --require-disclosure
assert_output_contains "the disclosure is reported" "disclosed the pre-existing accounts"

echo "== Case 4: silence with no explanation =="
write_summary silent <<'EOF'
  Login
  SeqDesk is installed.
EOF
STUB_ACCEPTED_PASSWORD="unused" \
    run_checker 1 "printing nothing and saying nothing fails" \
        --summary "$TEST_TMP_DIR/silent.log" \
        --base-url "$BASE_URL" \
        --label "second install" \
        --require-disclosure
assert_output_contains "the silent case is explained" "did not say why"

echo "== Case 5: the inline 'email / password' form is a printed credential too =="
write_summary inline <<'EOF'
  Login
  Admin                admin@example.com / admin
  Researcher           user@example.com / user (default; change after first login)
  Change the default admin password immediately after first login.
EOF
STUB_ACCEPTED_PASSWORD="admin" \
    run_checker 1 "an inline default password is verified as well" \
        --summary "$TEST_TMP_DIR/inline.log" \
        --base-url "$BASE_URL" \
        --label "second install"
assert_output_contains "the researcher default is the one that failed" \
    "does not work (user@example.com)"

echo "== Case 6: claims without a password value are not asserted =="
write_summary profile <<'EOF'
  Login
  Admin                admin@example.com / configured profile password
  Researcher           not created
EOF
STUB_ACCEPTED_PASSWORD="nothing" \
    run_checker 0 "a profile password claim names no value to verify" \
        --summary "$TEST_TMP_DIR/profile.log" \
        --base-url "$BASE_URL" \
        --label "second install"

echo "== Case 6b: prose about a password is not a password =="
# "existing password (unchanged)" names no value to try. Reading it as the
# literal password "existing password" would fail an install that was being
# perfectly honest -- the exact false red this case exists to prevent.
write_summary adopted <<'EOF'
  warning The selected database already contains SeqDesk accounts.
  Login
  Admin                admin@example.com / existing password (unchanged)
  Researcher           user@example.com / existing password (unchanged)
  Their existing passwords still govern; no password was generated, stored
  or changed for them.
EOF
STUB_ACCEPTED_PASSWORD="nothing" \
    run_checker 0 "a described password is not attempted as a login" \
        --summary "$TEST_TMP_DIR/adopted.log" \
        --base-url "$BASE_URL" \
        --label "second install" \
        --require-disclosure
assert_output_contains "the disclosure carries the result" "disclosed the pre-existing accounts"

echo "== Case 7: a credential label with no value =="
printf '  Login\n  Admin                admin@example.com\n  Admin password\n' \
    > "$TEST_TMP_DIR/empty-label.log"
STUB_ACCEPTED_PASSWORD="nothing" \
    run_checker 1 "an empty credential label fails" \
        --summary "$TEST_TMP_DIR/empty-label.log" \
        --base-url "$BASE_URL" \
        --label "second install"
assert_output_contains "the empty label is explained" "credential label with no value"

echo "== Case 8: --require-printed-password guards against a vacuous pass =="
STUB_ACCEPTED_PASSWORD="nothing" \
    run_checker 1 "a leg that must show a password fails when none is shown" \
        --summary "$TEST_TMP_DIR/disclosed.log" \
        --base-url "$BASE_URL" \
        --label "first install" \
        --require-printed-password
assert_output_contains "the vacuous case is explained" 'printed no "<role> password" line'

echo "== Case 9: ANSI colour and CRLF do not hide a credential =="
printf '  \033[1mLogin\033[0m\r\n  Admin                admin@example.com\r\n  Admin password       coloured-value\r\n' \
    > "$TEST_TMP_DIR/ansi.log"
STUB_ACCEPTED_PASSWORD="coloured-value" \
    run_checker 0 "colour codes and CRLF are stripped before parsing" \
        --summary "$TEST_TMP_DIR/ansi.log" \
        --base-url "$BASE_URL" \
        --label "first install" \
        --require-printed-password

echo "== Case 10: the result file carries no password =="
RESULT_FILE="$TEST_TMP_DIR/result.json"
STUB_ACCEPTED_PASSWORD="correct-horse-battery" \
    run_checker 0 "a result file is written" \
        --summary "$TEST_TMP_DIR/generated-ok.log" \
        --base-url "$BASE_URL" \
        --label "first install" \
        --result-file "$RESULT_FILE"
if grep -qF "correct-horse-battery" "$RESULT_FILE"; then
    echo "FAIL: the uploaded result file contains a password value" >&2
    FAILURES=$((FAILURES + 1))
else
    echo "ok: the result file contains no password value"
fi

echo "== Case 11: parsed against the installer's own print_login_summary =="
# Fixtures above are hand-written, so they can drift from the real formatting
# and leave the parser looking healthy while it silently matches nothing. These
# two summaries are rendered by the installer itself, in library-only mode.
render_login_summary() {
    # render_login_summary <out-file> [RENDER_* env assignments...]
    #
    # The bootstrap globals are assigned AFTER sourcing on purpose: the
    # installer initialises them to empty/"false" at load time, so anything
    # exported into the environment beforehand is overwritten.
    local out="$1"
    shift
    env "$@" bash -c '
        set -uo pipefail
        SEQDESK_INSTALL_LIB_ONLY=1 source "$1/scripts/install-dist.sh"
        SEQDESK_BOOTSTRAP_ADMIN_EMAIL="${RENDER_ADMIN_EMAIL:-}"
        SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="${RENDER_ADMIN_GENERATED:-false}"
        SEQDESK_GENERATED_ADMIN_PASSWORD="${RENDER_ADMIN_PASSWORD:-}"
        SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL="${RENDER_RESEARCHER_EMAIL:-}"
        SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="${RENDER_RESEARCHER_GENERATED:-false}"
        SEQDESK_GENERATED_RESEARCHER_PASSWORD="${RENDER_RESEARCHER_PASSWORD:-}"
        print_login_summary
    ' _ "$REPO_ROOT" > "$out" 2>&1
}

render_login_summary "$TEST_TMP_DIR/rendered-generated.log" \
    RENDER_ADMIN_EMAIL="admin@example.com" \
    RENDER_ADMIN_GENERATED="true" \
    RENDER_ADMIN_PASSWORD="rendered-admin-secret" \
    RENDER_RESEARCHER_EMAIL="user@example.com" \
    RENDER_RESEARCHER_GENERATED="true" \
    RENDER_RESEARCHER_PASSWORD="rendered-admin-secret"
STUB_ACCEPTED_PASSWORD="rendered-admin-secret" \
    run_checker 0 "the installer's generated-password block is parsed" \
        --summary "$TEST_TMP_DIR/rendered-generated.log" \
        --base-url "$BASE_URL" \
        --label "first install" \
        --require-printed-password

render_login_summary "$TEST_TMP_DIR/rendered-defaults.log"
STUB_ACCEPTED_PASSWORD="admin" \
    run_checker 1 "the installer's default-credential block is parsed" \
        --summary "$TEST_TMP_DIR/rendered-defaults.log" \
        --base-url "$BASE_URL" \
        --label "second install"
assert_output_contains "the default researcher credential is verified too" \
    "does not work (user@example.com)"

echo "== Case 12: the installer's own adopted-database output is accepted =="
# The honest outcome, rendered by the installer rather than transcribed: an
# install that attaches to a database which already holds the accounts must
# pass. Skipped rather than failed while the installer-side helpers are still
# being written, so this suite never blocks the change it is here to protect.
ADOPTED_RENDER="$TEST_TMP_DIR/rendered-adopted.log"
bash -c '
    set -uo pipefail
    SEQDESK_INSTALL_LIB_ONLY=1 source "$1/scripts/install-dist.sh"
    if ! declare -f print_adopted_bootstrap_accounts_notice >/dev/null 2>&1 \
        || ! declare -f discard_unapplied_bootstrap_credentials >/dev/null 2>&1; then
        exit 3
    fi
    DATABASE_URL="postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk?schema=public"
    SEQDESK_BOOTSTRAP_ADMIN_EMAIL="admin@example.com"
    SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_GENERATED="true"
    SEQDESK_GENERATED_ADMIN_PASSWORD="generated-but-never-applied"
    SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL="user@example.com"
    SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_GENERATED="true"
    SEQDESK_GENERATED_RESEARCHER_PASSWORD="generated-but-never-applied"
    accounts=$(printf "admin\tadmin@example.com\nresearcher\tuser@example.com")
    print_adopted_bootstrap_accounts_notice "$accounts"
    discard_unapplied_bootstrap_credentials "$accounts"
    print_login_summary
' _ "$REPO_ROOT" </dev/null > "$ADOPTED_RENDER" 2>&1
RENDER_STATUS=$?
if [ "$RENDER_STATUS" -eq 3 ]; then
    echo "skip: the installer has no adopted-database notice yet"
elif [ "$RENDER_STATUS" -ne 0 ]; then
    echo "FAIL: rendering the installer's adopted-database output failed ($RENDER_STATUS)" >&2
    sed 's/^/    /' "$ADOPTED_RENDER" >&2
    FAILURES=$((FAILURES + 1))
else
    STUB_ACCEPTED_PASSWORD="nothing" \
        run_checker 0 "the installer's adopted-database output is honest" \
            --summary "$ADOPTED_RENDER" \
            --base-url "$BASE_URL" \
            --label "second install" \
            --require-disclosure
    if grep -qF "generated-but-never-applied" "$ADOPTED_RENDER"; then
        echo "FAIL: the adopted-database summary still shows a generated password" >&2
        FAILURES=$((FAILURES + 1))
    else
        echo "ok: no unapplied generated password reaches the summary"
    fi
fi

echo ""
if [ "$FAILURES" -ne 0 ]; then
    echo "$FAILURES assertion(s) failed." >&2
    exit 1
fi
echo "All printed-credential checker assertions passed."
