#!/usr/bin/env node
//
// PIPELINE APP-BEHAVIOUR E2E (--check nodata | access | stuck)
// -----------------------------------------------------------
// Exercises app-level behaviour around pipeline runs that the per-pipeline
// runtime E2E does not cover. One self-contained script, three independent
// checks (wired as separate workflow steps so each is bisectable):
//
//   --check nodata   Starting a run on an order whose sample has NO reads must
//                    be rejected with a clean validation error (4xx), never a
//                    500/crash. Creates a throwaway DRAFT order + a read-less
//                    sample, POSTs a run, asserts the rejection, cleans up.
//                    (pure HTTP; no SLURM, no pipeline execution.)
//
//   --check access   Run a fast LOCAL fastq-checksum run to completion as the
//                    admin, then assert TWO things about it:
//                      (a) Notifications — a 'pipeline.completed' in-app
//                          notification fired for the run.
//                      (b) Permissions — a non-admin researcher cannot READ or
//                          CANCEL the admin's run (403), and an unauthenticated
//                          request is rejected (401).
//
//   --check stuck    Guards the original "99%-stuck" regression: start a SLURM
//                    run, let it reach running/queued, then scancel the job
//                    OUT OF BAND (behind the app's back). POST /sync and assert
//                    the app RECONCILES the vanished scheduler job to a terminal
//                    status instead of leaving the run wedged. (Distinct from the
//                    cancel test, which reconciles via the app's own DELETE.)
//                    Requires SLURM (sbatch/squeue/sacct/scancel).
//
// Env: SEQDESK_APPCHECK_BASE_URL / EMAIL / PASSWORD (admin), plus
// SEQDESK_APPCHECK_RESEARCHER_EMAIL / _PASSWORD (defaults user@example.com / user),
// SEQDESK_APPCHECK_PIPELINE_ID (default fastq-checksum), SEQDESK_APPCHECK_TIMEOUT_SECONDS.
// Falls back to the SLURM/runtime E2E env names so it slots into the same job.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function fail(message, details) {
  const parts = [message];
  if (details) parts.push(details);
  throw new Error(parts.join("\n"));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) fail(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

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
      this.#cookies.set(
        firstPart.slice(0, separatorIndex).trim(),
        firstPart.slice(separatorIndex + 1).trim()
      );
    }
  }

  headerValue() {
    return Array.from(this.#cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }
}

function summarizeBody(body) {
  if (!body) return "";
  const compact = typeof body === "string" ? body : JSON.stringify(body);
  const trimmed = compact.replace(/\s+/g, " ").trim();
  return trimmed.length <= 1000 ? trimmed : `${trimmed.slice(0, 997)}...`;
}

async function parseJson(response, context) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    fail(
      `${context} returned invalid JSON`,
      error instanceof Error ? `${error.message}\n${summarizeBody(text)}` : summarizeBody(text)
    );
  }
}

function toOptionalInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function commandExists(command) {
  try {
    await execFileAsync("command", ["-v", command], { shell: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function createClient(baseUrl) {
  const jar = new CookieJar();
  async function request(pathname, init = {}) {
    const headers = new Headers(init.headers || {});
    const cookieHeader = jar.headerValue();
    if (cookieHeader) headers.set("cookie", cookieHeader);

    const response = await fetch(new URL(pathname, baseUrl), {
      ...init,
      headers,
      redirect: init.redirect || "manual",
    });
    jar.update(response);
    return response;
  }
  return { request };
}

// Throws on non-2xx (for the happy path).
async function requestJson(client, pathname, init, context) {
  const response = await client.request(pathname, init);
  if (!response.ok) {
    const body = await response.text();
    fail(`${context} failed (${response.status})`, summarizeBody(body));
  }
  return parseJson(response, context);
}

// Never throws on status: returns { status, ok, body } so a check can assert a
// specific 4xx without the request helper aborting first.
async function requestRaw(client, pathname, init, context) {
  const response = await client.request(pathname, init);
  let body = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, ok: response.ok, body, context };
}

// Generalised login. expectAdmin=true requires FACILITY_ADMIN; expectAdmin=false
// requires a non-admin session (the researcher). Returns the session payload.
async function login({ client, baseUrl, email, password, expectAdmin }) {
  const csrfResponse = await client.request("/api/auth/csrf");
  if (!csrfResponse.ok) fail(`Failed to fetch CSRF token (${csrfResponse.status})`);
  const csrfPayload = await parseJson(csrfResponse, "CSRF endpoint");
  const csrfToken = csrfPayload?.csrfToken;
  if (typeof csrfToken !== "string" || !csrfToken) {
    fail("CSRF endpoint did not return a csrfToken");
  }

  const form = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: new URL("/analysis", baseUrl).toString(),
    json: "true",
  });
  const loginResponse = await client.request("/api/auth/callback/credentials?json=true", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json, text/plain, */*",
    },
    body: form.toString(),
  });
  if (!loginResponse.ok && ![302, 303].includes(loginResponse.status)) {
    const body = await loginResponse.text();
    fail(`Credentials login failed for ${email} (${loginResponse.status})`, summarizeBody(body));
  }

  const sessionResponse = await client.request("/api/auth/session");
  if (!sessionResponse.ok) {
    fail(`Failed to fetch session after login for ${email} (${sessionResponse.status})`);
  }
  const session = await parseJson(sessionResponse, "Session endpoint");
  if (session?.user?.email !== email) {
    fail(`Login did not produce a session for ${email}`, JSON.stringify(session, null, 2));
  }
  const isAdmin = session?.user?.role === "FACILITY_ADMIN";
  if (expectAdmin && !isAdmin) {
    fail(`Expected ${email} to be FACILITY_ADMIN`, JSON.stringify(session?.user, null, 2));
  }
  if (!expectAdmin && isAdmin) {
    fail(`Expected ${email} to be a non-admin researcher`, JSON.stringify(session?.user, null, 2));
  }
  return session;
}

async function pickOrder(client, { requireSamples = true } = {}) {
  const payload = await requestJson(client, "/api/orders", {}, "List orders");
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  const withSamples = orders.filter((order) => Number(order?._count?.samples || 0) > 0);
  const submitted = withSamples.filter(
    (order) => String(order?.status || "").toUpperCase() === "SUBMITTED"
  );
  const chosen = submitted[0] || withSamples[0] || (requireSamples ? null : orders[0]);
  if (!chosen?.id) {
    fail("No suitable order was available. Seed dummy data or pass an order with samples.");
  }
  return chosen;
}

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "canceled"]);

// Poll a run to a terminal status, nudging the operator /sync each iteration so
// status transitions (and their notifications) are applied promptly.
async function pollUntilTerminal({ client, runId, timeoutSeconds, want }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    await client.request(`/api/pipelines/runs/${runId}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = await requestJson(client, `/api/pipelines/runs/${runId}`, {}, "Fetch run");
    last = payload?.run || payload;
    const status = String(last?.status || "").toLowerCase();
    if (TERMINAL_STATES.has(status)) {
      if (want && status !== want) {
        fail(
          `Run ${runId} reached terminal status '${status}' but the check expected '${want}'`,
          JSON.stringify({ runId, status, currentStep: last?.currentStep }, null, 2)
        );
      }
      return last;
    }
    await sleep(4000);
  }
  fail(
    `Run ${runId} did not reach a terminal status within ${timeoutSeconds}s`,
    JSON.stringify({ runId, status: last?.status, currentStep: last?.currentStep }, null, 2)
  );
}

function buildSlurmOverride(args) {
  const slurm = {};
  const queue = args["slurm-queue"] || process.env.SEQDESK_SLURM_E2E_QUEUE;
  const cores = toOptionalInt(args["slurm-cores"] || process.env.SEQDESK_SLURM_E2E_CORES);
  const memory = args["slurm-memory"] || process.env.SEQDESK_SLURM_E2E_MEMORY;
  const timeLimit = toOptionalInt(args["slurm-time-limit"] || process.env.SEQDESK_SLURM_E2E_TIME_LIMIT);
  const options = args["slurm-options"] || process.env.SEQDESK_SLURM_E2E_OPTIONS;
  if (queue) slurm.queue = queue;
  if (cores && cores > 0) slurm.cores = cores;
  if (memory) slurm.memory = memory;
  if (timeLimit && timeLimit > 0) slurm.timeLimit = timeLimit;
  if (options !== undefined) slurm.options = options;
  return Object.keys(slurm).length > 0 ? slurm : undefined;
}

// ---------------------------------------------------------------------------
// CHECK: nodata
// ---------------------------------------------------------------------------
async function checkNoData({ client, baseUrl, pipelineId }) {
  await login({ client, baseUrl, email: ctx.email, password: ctx.password, expectAdmin: true });

  // 1. Throwaway DRAFT order with enough metadata that input (not metadata)
  //    validation is what trips. Reads are imported separately, so the sample
  //    we add below has none.
  const order = await requestJson(
    client,
    "/api/orders",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "E2E appcheck no-data",
        platform: "ILLUMINA",
        instrumentModel: "Illumina NovaSeq 6000",
        librarySource: "GENOMIC",
        libraryStrategy: "WGS",
        librarySelection: "RANDOM",
        numberOfSamples: 1,
      }),
    },
    "Create throwaway DRAFT order"
  );
  const orderId = order?.id;
  if (!orderId) fail("Throwaway order creation did not return an id", JSON.stringify(order, null, 2));

  try {
    // 2. Add a single sample with NO reads.
    await requestJson(
      client,
      `/api/orders/${orderId}/samples`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          samples: [
            {
              isNew: true,
              sampleId: "NODATA-1",
              scientificName: "Escherichia coli",
              taxId: "562",
            },
          ],
        }),
      },
      "Add read-less sample"
    );

    // 3. Attempt to start a run. Must be a clean validation rejection, not a 500.
    const result = await requestRaw(
      client,
      "/api/pipelines/runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipelineId, orderId, config: {} }),
      },
      "Create run on read-less order"
    );

    if (result.status === 500) {
      fail(
        `Starting a run on a read-less order returned 500 (server crash) — expected a clean validation error`,
        summarizeBody(result.body)
      );
    }
    if (result.status !== 400) {
      fail(
        `Expected 400 for a read-less order, got ${result.status}. A run must NOT be accepted without reads.`,
        summarizeBody(result.body)
      );
    }

    const body = result.body || {};
    const errorText = typeof body.error === "string" ? body.error : "";
    const detailsText = Array.isArray(body.details) ? body.details.join(" | ") : "";
    const combined = `${errorText} ${detailsText}`;
    if (!/validation|no reads|no active|required/i.test(combined)) {
      fail(
        `Read-less order was rejected (400) but without a coherent validation message`,
        summarizeBody(body)
      );
    }
    const sawNoReads = /no reads|no active|no paired/i.test(detailsText);

    return {
      check: "nodata",
      success: true,
      assertion: "read-less order rejected with a clean validation error (4xx, not 500)",
      pipelineId,
      orderId,
      status: result.status,
      error: errorText || null,
      sawNoReadsMessage: sawNoReads,
      details: Array.isArray(body.details) ? body.details : null,
    };
  } finally {
    // Best-effort cleanup of the throwaway DRAFT order.
    try {
      await client.request(`/api/orders/${orderId}`, { method: "DELETE" });
    } catch (error) {
      console.warn(`WARN: failed to delete throwaway order ${orderId}: ${error?.message || error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CHECK: access  (notifications + permissions)
// ---------------------------------------------------------------------------
async function checkAccess({ baseUrl, pipelineId, timeoutSeconds }) {
  const adminClient = createClient(baseUrl);
  await login({ client: adminClient, baseUrl, email: ctx.email, password: ctx.password, expectAdmin: true });

  const order = await pickOrder(adminClient, { requireSamples: true });

  // 1. Run a fast LOCAL run to completion (notifications fire on terminal status).
  const createPayload = await requestJson(
    adminClient,
    "/api/pipelines/runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pipelineId, orderId: order.id, config: {}, executionMode: "local" }),
    },
    "Create local run (access)"
  );
  const runId = createPayload?.run?.id;
  if (!runId) fail("Create local run did not return run.id", JSON.stringify(createPayload, null, 2));

  await requestJson(
    adminClient,
    `/api/pipelines/runs/${runId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionMode: "local" }),
    },
    "Start local run (access)"
  );

  const run = await pollUntilTerminal({ client: adminClient, runId, timeoutSeconds, want: "completed" });

  // 2. Notifications: a 'pipeline.completed' in-app notification must exist for
  //    this run (recipients include the owner + facility admins; the admin is both).
  let notification = null;
  for (let attempt = 0; attempt < 8 && !notification; attempt += 1) {
    const payload = await requestJson(
      adminClient,
      "/api/notifications?limit=50",
      {},
      "List notifications"
    );
    if (payload?.enabled === false) {
      fail("In-app notifications are disabled — cannot assert the completion notification");
    }
    const notifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
    notification = notifications.find(
      (item) =>
        item?.sourceType === "pipelineRun" &&
        item?.sourceId === runId &&
        String(item?.eventType || "").toLowerCase() === "pipeline.completed"
    );
    if (!notification) await sleep(2000);
  }
  if (!notification) {
    fail(
      `No 'pipeline.completed' notification was found for run ${runId} after it completed`,
      JSON.stringify({ runId, status: run?.status }, null, 2)
    );
  }
  if (notification.severity && notification.severity !== "success") {
    fail(
      `Completion notification had unexpected severity '${notification.severity}' (expected 'success')`,
      JSON.stringify(notification, null, 2)
    );
  }

  // 3. Permissions: a non-admin researcher must not be able to READ or CANCEL the
  //    admin's (unpublished) run, and an unauthenticated request must be rejected.
  const researcherClient = createClient(baseUrl);
  await login({
    client: researcherClient,
    baseUrl,
    email: ctx.researcherEmail,
    password: ctx.researcherPassword,
    expectAdmin: false,
  });

  const researcherGet = await requestRaw(
    researcherClient,
    `/api/pipelines/runs/${runId}`,
    {},
    "Researcher GET admin's run"
  );
  if (researcherGet.status !== 403) {
    fail(
      `A non-admin researcher could read the admin's run (expected 403, got ${researcherGet.status})`,
      summarizeBody(researcherGet.body)
    );
  }

  const researcherDelete = await requestRaw(
    researcherClient,
    `/api/pipelines/runs/${runId}`,
    { method: "DELETE" },
    "Researcher DELETE admin's run"
  );
  if (researcherDelete.status !== 403) {
    fail(
      `A non-admin researcher could cancel the admin's run (expected 403, got ${researcherDelete.status})`,
      summarizeBody(researcherDelete.body)
    );
  }

  const anonClient = createClient(baseUrl);
  const anonGet = await requestRaw(
    anonClient,
    `/api/pipelines/runs/${runId}`,
    {},
    "Unauthenticated GET run"
  );
  if (anonGet.status !== 401) {
    fail(
      `An unauthenticated request could read a run (expected 401, got ${anonGet.status})`,
      summarizeBody(anonGet.body)
    );
  }

  // 4. Confirm the run is still terminal/intact after the rejected researcher DELETE.
  const after = await requestJson(adminClient, `/api/pipelines/runs/${runId}`, {}, "Fetch run after access checks");
  const afterStatus = String((after?.run || after)?.status || "").toLowerCase();
  if (afterStatus !== "completed") {
    fail(
      `Run status changed to '${afterStatus}' after a rejected researcher DELETE — it must stay completed`,
      JSON.stringify({ runId, afterStatus }, null, 2)
    );
  }

  return {
    check: "access",
    success: true,
    pipelineId,
    runId,
    notificationEventType: notification.eventType,
    notificationSeverity: notification.severity || null,
    researcherGetStatus: researcherGet.status,
    researcherDeleteStatus: researcherDelete.status,
    anonGetStatus: anonGet.status,
    statusAfterRejectedDelete: afterStatus,
  };
}

// ---------------------------------------------------------------------------
// CHECK: stuck  (out-of-band scancel -> /sync reconciliation)
// ---------------------------------------------------------------------------
async function sacctState(jobId) {
  if (!/^\d+$/.test(String(jobId || ""))) return { ok: false, reason: "no numeric job id" };
  try {
    const { stdout } = await execFileAsync(
      "sacct",
      ["-j", String(jobId), "--noheader", "-o", "State", "-P"],
      { timeout: 15000 }
    );
    const states = stdout
      .split(/\r?\n/)
      .map((line) => line.trim().toUpperCase())
      .filter(Boolean);
    const cancelled = states.some((s) => s.startsWith("CANCELLED") || s.startsWith("CANCELED"));
    return { ok: cancelled, states };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function checkStuck({ baseUrl, pipelineId, timeoutSeconds, slurm }) {
  for (const command of ["sbatch", "squeue", "sacct", "scancel"]) {
    if (!(await commandExists(command))) {
      fail(`Required SLURM command is not available on this host: ${command}`);
    }
  }

  const client = createClient(baseUrl);
  await login({ client, baseUrl, email: ctx.email, password: ctx.password, expectAdmin: true });
  const order = await pickOrder(client, { requireSamples: true });

  // 1. Start a SLURM run.
  const createPayload = await requestJson(
    client,
    "/api/pipelines/runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pipelineId, orderId: order.id, config: {}, executionMode: "slurm", ...(slurm ? { slurm } : {}) }),
    },
    "Create SLURM run (stuck)"
  );
  const runId = createPayload?.run?.id;
  if (!runId) fail("Create SLURM run did not return run.id", JSON.stringify(createPayload, null, 2));

  const startPayload = await requestJson(
    client,
    `/api/pipelines/runs/${runId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionMode: "slurm", ...(slurm ? { slurm } : {}) }),
    },
    "Start SLURM run (stuck)"
  );
  let jobId = startPayload?.jobId || startPayload?.queueJobId;

  // 2. Wait until the run is non-terminally active (running/queued) with a job id.
  const activeDeadline = Date.now() + Math.min(timeoutSeconds, 180) * 1000;
  let stateBefore = null;
  while (Date.now() < activeDeadline) {
    const payload = await requestJson(client, `/api/pipelines/runs/${runId}`, {}, "Fetch run (stuck)");
    const current = payload?.run || payload;
    stateBefore = String(current?.status || "").toLowerCase();
    jobId = jobId || current?.queueJobId || current?.jobId;
    if (TERMINAL_STATES.has(stateBefore)) {
      fail(
        `Run ${runId} finished before it could be wedged (status='${stateBefore}'). The smoke pipeline is too fast; re-run.`,
        JSON.stringify({ runId, jobId, stateBefore }, null, 2)
      );
    }
    if (["running", "queued", "pending"].includes(stateBefore) && /^\d+$/.test(String(jobId || ""))) {
      break;
    }
    await sleep(3000);
  }
  if (!/^\d+$/.test(String(jobId || ""))) {
    fail(`Could not obtain a numeric SLURM job id for run ${runId}`, JSON.stringify({ stateBefore }, null, 2));
  }

  // 3. Kill the scheduler job OUT OF BAND — the app still believes it is active.
  await execFileAsync("scancel", [String(jobId)], { timeout: 15000 });

  // 4. The app must reconcile the vanished job to a terminal status via /sync,
  //    NOT leave the run wedged at running/queued (the 99%-stuck regression).
  let reconciled = null;
  for (let attempt = 0; attempt < 12 && !reconciled; attempt += 1) {
    await client.request(`/api/pipelines/runs/${runId}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    await sleep(3000);
    const payload = await requestJson(client, `/api/pipelines/runs/${runId}`, {}, "Fetch run after scancel");
    const current = payload?.run || payload;
    if (TERMINAL_STATES.has(String(current?.status || "").toLowerCase())) {
      reconciled = current;
    }
  }
  if (!reconciled) {
    fail(
      `Run ${runId} stayed wedged (non-terminal) after its SLURM job ${jobId} was scancelled out of band — the monitor did not reconcile it`,
      JSON.stringify({ runId, jobId, stateBefore }, null, 2)
    );
  }
  if (!reconciled.completedAt) {
    fail(`Reconciled run ${runId} did not record completedAt`, JSON.stringify({ runId }, null, 2));
  }

  let sacct = { ok: false };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    sacct = await sacctState(jobId);
    if (sacct.ok) break;
    await sleep(2000);
  }

  return {
    check: "stuck",
    success: true,
    assertion: "out-of-band scancel reconciled to terminal via /sync (not wedged)",
    pipelineId,
    runId,
    jobId,
    stateBeforeScancel: stateBefore,
    statusAfterReconcile: String(reconciled.status || "").toLowerCase(),
    statusSource: reconciled.statusSource || null,
    sacctCancelled: sacct.ok,
  };
}

const ctx = {};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const check = args.check || process.env.SEQDESK_APPCHECK;
  if (!check || !["nodata", "access", "stuck"].includes(check)) {
    fail("Pass --check <nodata|access|stuck>");
  }

  const baseUrl =
    args["base-url"] ||
    process.env.SEQDESK_APPCHECK_BASE_URL ||
    process.env.SEQDESK_SLURM_E2E_BASE_URL ||
    process.env.SEQDESK_RUNTIME_E2E_BASE_URL ||
    "http://localhost:3000";
  ctx.email =
    args.email || process.env.SEQDESK_APPCHECK_EMAIL || process.env.SEQDESK_SLURM_E2E_EMAIL || "admin@example.com";
  ctx.password =
    args.password || process.env.SEQDESK_APPCHECK_PASSWORD || process.env.SEQDESK_SLURM_E2E_PASSWORD || "admin";
  ctx.researcherEmail =
    args["researcher-email"] || process.env.SEQDESK_APPCHECK_RESEARCHER_EMAIL || "user@example.com";
  ctx.researcherPassword =
    args["researcher-password"] || process.env.SEQDESK_APPCHECK_RESEARCHER_PASSWORD || "user";
  const pipelineId =
    args["pipeline-id"] || process.env.SEQDESK_APPCHECK_PIPELINE_ID || "fastq-checksum";
  const timeoutSeconds =
    toOptionalInt(args.timeout || process.env.SEQDESK_APPCHECK_TIMEOUT_SECONDS) || 600;

  let summary;
  if (check === "nodata") {
    summary = await checkNoData({ client: createClient(baseUrl), baseUrl, pipelineId });
  } else if (check === "access") {
    summary = await checkAccess({ baseUrl, pipelineId, timeoutSeconds });
  } else {
    summary = await checkStuck({ baseUrl, pipelineId, timeoutSeconds, slurm: buildSlurmOverride(args) });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
