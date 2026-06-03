#!/usr/bin/env node
/**
 * drive-update-rollback-e2e.mjs
 *
 * Tier-2 in-app update + rollback driver. Runs against a LIVE SeqDesk install
 * (release-layout, PM2-supervised) whose SEQDESK_UPDATE_SERVER points at a local
 * mock release server advertising a "to" version. It exercises the real operator
 * path through the HTTP API and tolerates the PM2 restart window:
 *
 *   --phase update    login admin -> assert the update is offered -> create a
 *                     durable sentinel order -> POST /api/admin/updates/install ->
 *                     wait across the restart until the DURABLE state says the new
 *                     release is active and /api/version reports Vto -> re-login,
 *                     assert admin still works, the sentinel survived, version=Vto.
 *
 *   --phase rollback  login admin -> POST /api/admin/updates/rollback -> wait
 *                     across the restart until state.phase=rolled_back and
 *                     /api/version reports Vfrom -> re-login admin AND researcher,
 *                     assert the sentinel survived, version=Vfrom.
 *
 * Completion is judged ONLY on the disk-persisted UpdateState (phase +
 * activeRelease, written before restartApplication()) plus a boot-recomputed
 * /api/version, never on the self-clearing status.status. ECONNREFUSED / non-200
 * during the restart window means "keep waiting", never pass or fail.
 */

import fs from "node:fs";

function log(message) {
  process.stdout.write(`[update-e2e] ${message}\n`);
}

function fail(message, details) {
  process.stderr.write(`[update-e2e] FAIL: ${message}\n`);
  if (details) process.stderr.write(`${details}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for --${key}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Cookie jar + request helper (mirrors scripts/run-auth-e2e.mjs).
// ---------------------------------------------------------------------------
function splitSetCookieHeader(headerValue) {
  if (!headerValue) return [];
  return headerValue.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g);
}

class CookieJar {
  #cookies = new Map();

  update(response) {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : splitSetCookieHeader(response.headers.get("set-cookie"));
    for (const entry of setCookies) {
      const firstPart = entry.split(";")[0];
      const separatorIndex = firstPart.indexOf("=");
      if (separatorIndex <= 0) continue;
      this.#cookies.set(firstPart.slice(0, separatorIndex).trim(), firstPart.slice(separatorIndex + 1).trim());
    }
  }

  headerValue() {
    return Array.from(this.#cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }
}

const args = parseArgs(process.argv.slice(2));
const phase = args.phase;
const baseUrl = args["base-url"];
const adminEmail = args["admin-email"] || "admin@example.com";
const adminPassword = args["admin-password"] || "admin";
const researcherEmail = args["researcher-email"] || "user@example.com";
const researcherPassword = args["researcher-password"] || "user";
const toVersion = args["to-version"];
const fromVersion = args["from-version"];
const resultFile = args["result-file"];
let sentinelOrderId = args["sentinel-order-id"] || null;
const timeoutMs = Number(args["timeout-ms"] || 360000);
const pollMs = Number(args["poll-ms"] || 2000);

if (!["update", "rollback"].includes(phase)) fail("--phase must be update or rollback");
if (!baseUrl) fail("missing --base-url");
if (!toVersion) fail("missing --to-version");
if (phase === "update" && !fromVersion) fail("update phase requires --from-version");

async function request(pathname, init = {}, jar) {
  const headers = new Headers(init.headers || {});
  if (jar) {
    const cookieHeader = jar.headerValue();
    if (cookieHeader) headers.set("cookie", cookieHeader);
  }
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers,
    redirect: init.redirect || "manual",
  });
  if (jar) jar.update(response);
  return response;
}

// Returns null on any network error (e.g. ECONNREFUSED during the restart
// window) so callers can treat "down" as "keep waiting".
async function tryRequest(pathname, init = {}, jar) {
  try {
    return await request(pathname, init, jar);
  } catch {
    return null;
  }
}

async function login(email, password, expectedRole) {
  const jar = new CookieJar();
  const csrfResponse = await request("/api/auth/csrf", {}, jar);
  if (!csrfResponse.ok) throw new Error(`csrf failed (${csrfResponse.status})`);
  const csrf = await csrfResponse.json();
  if (!csrf?.csrfToken) throw new Error("no csrfToken");

  const form = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email,
    password,
    callbackUrl: new URL("/orders", baseUrl).toString(),
    json: "true",
  });
  const loginResponse = await request(
    "/api/auth/callback/credentials?json=true",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json, text/plain, */*",
      },
      body: form.toString(),
    },
    jar
  );
  if (!loginResponse.ok && ![302, 303].includes(loginResponse.status)) {
    throw new Error(`credentials login failed (${loginResponse.status})`);
  }
  const sessionResponse = await request("/api/auth/session", {}, jar);
  if (!sessionResponse.ok) throw new Error(`session fetch failed (${sessionResponse.status})`);
  const session = await sessionResponse.json();
  if (session?.user?.email !== email) {
    throw new Error(`session email mismatch: ${JSON.stringify(session)}`);
  }
  if (expectedRole && session?.user?.role !== expectedRole) {
    throw new Error(`session role mismatch (want ${expectedRole}): ${JSON.stringify(session)}`);
  }
  return jar;
}

async function providersReady() {
  const response = await tryRequest("/api/auth/providers");
  return Boolean(response && response.status === 200);
}

async function getVersion() {
  const response = await tryRequest("/api/version");
  if (!response || response.status !== 200) return null;
  try {
    const body = await response.json();
    return typeof body?.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

async function getProgress(jar) {
  const response = await tryRequest("/api/admin/updates/progress", {}, jar);
  if (!response) return null;
  if (response.status === 401) return { unauthorized: true };
  if (response.status !== 200) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function endsWithRelease(value, version) {
  if (typeof value !== "string") return false;
  return value.replace(/\/+$/, "").endsWith(`/releases/${version}`);
}

async function waitForReadyAdmin(deadline) {
  while (Date.now() < deadline) {
    if (await providersReady()) {
      try {
        return await login(adminEmail, adminPassword, "FACILITY_ADMIN");
      } catch {
        // App reachable but session not ready yet; keep waiting.
      }
    }
    await sleep(pollMs);
  }
  fail("timed out waiting for the app to come back and admin login to succeed");
}

// Poll until the durable update state reports the expected terminal phase and
// the booted /api/version matches. Re-logins as admin each ready iteration
// because the restart drops the in-memory session route but the JWT cookie is
// re-mintable deterministically (NEXTAUTH_SECRET is fixed in config).
async function waitForTerminalState({ expectedVersion, expectedPhase, prevVersion }) {
  const deadline = Date.now() + timeoutMs;
  let lastObservation = "none";
  while (Date.now() < deadline) {
    const version = await getVersion();
    if (await providersReady()) {
      let jar = null;
      try {
        jar = await login(adminEmail, adminPassword, "FACILITY_ADMIN");
      } catch {
        jar = null;
      }
      if (jar) {
        const progress = await getProgress(jar);
        const state = progress && !progress.unauthorized ? progress.state : null;
        if (state?.phase === "error") {
          fail(`update entered error phase: ${state.error || "unknown error"}`);
        }
        lastObservation = `version=${version} phase=${state?.phase} active=${state?.activeRelease}`;
        if (
          version === expectedVersion &&
          state?.phase === expectedPhase &&
          endsWithRelease(state.activeRelease, expectedVersion) &&
          (prevVersion ? endsWithRelease(state.previousRelease, prevVersion) : true)
        ) {
          log(`terminal state reached: ${lastObservation}`);
          return state;
        }
      }
    }
    await sleep(pollMs);
  }
  fail(`timed out waiting for phase=${expectedPhase} version=${expectedVersion}`, `last: ${lastObservation}`);
}

async function assertAdminUsersReachable(jar) {
  const response = await request("/api/admin/users", {}, jar);
  if (response.status !== 200) {
    fail(`admin /api/admin/users not reachable after restart (${response.status})`);
  }
}

async function createSentinelOrder(jar) {
  const response = await request(
    "/api/orders",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-seqdesk-e2e": "playwright" },
      body: JSON.stringify({ name: `CI update sentinel ${fromVersion}->${toVersion}`, numberOfSamples: "1" }),
    },
    jar
  );
  if (!response.ok) fail(`failed to create sentinel order (${response.status})`);
  const order = await response.json();
  if (!order?.id) fail(`sentinel order response has no id: ${JSON.stringify(order)}`);
  return String(order.id);
}

async function assertSentinelSurvives(jar, label) {
  if (!sentinelOrderId) return;
  const response = await request(`/api/orders/${encodeURIComponent(sentinelOrderId)}`, {}, jar);
  if (response.status !== 200) {
    fail(`sentinel order ${sentinelOrderId} missing ${label} (${response.status}) — data was lost`);
  }
  log(`sentinel order ${sentinelOrderId} present ${label}`);
}

function writeResult(extra) {
  if (!resultFile) return;
  const payload = { phase, fromVersion, toVersion, sentinelOrderId, pass: true, ...extra };
  fs.writeFileSync(resultFile, `${JSON.stringify(payload, null, 2)}\n`);
}

async function runUpdate() {
  log(`update phase: ${fromVersion} -> ${toVersion} at ${baseUrl}`);
  const jar = await login(adminEmail, adminPassword, "FACILITY_ADMIN");

  // Pre-flight: the update must be offered (proves SEQDESK_UPDATE_SERVER
  // injection + manifest wiring + cache bypass via force).
  const checkResponse = await request("/api/admin/updates?force=true", {}, jar);
  if (checkResponse.status !== 200) fail(`update check failed (${checkResponse.status})`);
  const check = await checkResponse.json();
  if (check.updateAvailable !== true) fail(`updateAvailable !== true: ${JSON.stringify(check)}`);
  if (check.latest?.version !== toVersion) fail(`latest.version !== ${toVersion}: ${JSON.stringify(check.latest)}`);
  if (check.databaseCompatible !== true) fail(`databaseCompatible !== true: ${JSON.stringify(check)}`);
  log(`update offered: latest=${check.latest.version}, databaseCompatible=true`);

  // Durable sentinel so "no data loss" is a non-vacuous assertion.
  sentinelOrderId = await createSentinelOrder(jar);
  await assertSentinelSurvives(jar, "before update");

  // Trigger the real install route (NOT the GET-only /api/admin/updates).
  const installResponse = await request(
    "/api/admin/updates/install",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    jar
  );
  if (installResponse.status !== 200) {
    const body = await installResponse.text().catch(() => "");
    fail(`POST /api/admin/updates/install returned ${installResponse.status} (expected 200)`, body);
  }
  const installBody = await installResponse.json();
  if (installBody.success !== true || installBody.version !== toVersion) {
    fail(`install response unexpected: ${JSON.stringify(installBody)}`);
  }
  log("install accepted; waiting for the restart + activation");

  const state = await waitForTerminalState({
    expectedVersion: toVersion,
    expectedPhase: "complete",
    prevVersion: fromVersion,
  });

  const readyJar = await waitForReadyAdmin(Date.now() + timeoutMs);
  await assertAdminUsersReachable(readyJar);
  await assertSentinelSurvives(readyJar, "after update");
  const finalVersion = await getVersion();
  if (finalVersion !== toVersion) fail(`final version ${finalVersion} !== ${toVersion}`);
  log(`UPDATE OK: running ${finalVersion}, activeRelease=${state.activeRelease}`);
  writeResult({ finalVersion, activeRelease: state.activeRelease });
}

async function runRollback() {
  log(`rollback phase: ${toVersion} (=Vfrom) at ${baseUrl}`);
  // The restart from the update may still be settling; wait for a clean admin
  // session before issuing the rollback so we don't race the update lock.
  let jar = await waitForReadyAdmin(Date.now() + timeoutMs);
  await assertSentinelSurvives(jar, "before rollback");

  const rollbackResponse = await request(
    "/api/admin/updates/rollback",
    { method: "POST", headers: { "content-type": "application/json" } },
    jar
  );
  if (rollbackResponse.status !== 200) {
    const body = await rollbackResponse.text().catch(() => "");
    fail(`POST /api/admin/updates/rollback returned ${rollbackResponse.status} (expected 200)`, body);
  }
  const rollbackBody = await rollbackResponse.json();
  if (rollbackBody.success !== true || rollbackBody.rollback !== true) {
    fail(`rollback response unexpected: ${JSON.stringify(rollbackBody)}`);
  }
  log("rollback accepted; waiting for the restart + reactivation");

  const state = await waitForTerminalState({
    expectedVersion: toVersion,
    expectedPhase: "rolled_back",
  });

  jar = await waitForReadyAdmin(Date.now() + timeoutMs);
  await assertAdminUsersReachable(jar);
  await assertSentinelSurvives(jar, "after rollback");
  // Researcher login must also work on the restored release.
  await login(researcherEmail, researcherPassword, "RESEARCHER");
  const finalVersion = await getVersion();
  if (finalVersion !== toVersion) fail(`final version ${finalVersion} !== ${toVersion}`);
  log(`ROLLBACK OK: running ${finalVersion}, activeRelease=${state.activeRelease}`);
  writeResult({ finalVersion, activeRelease: state.activeRelease });
}

try {
  if (phase === "update") {
    await runUpdate();
  } else {
    await runRollback();
  }
  log(`${phase} phase passed`);
} catch (error) {
  fail(`${phase} phase threw`, error instanceof Error ? error.stack || error.message : String(error));
}
