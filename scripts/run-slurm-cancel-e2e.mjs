#!/usr/bin/env node
//
// SLURM CANCEL/STOP E2E
// ---------------------
// Proves the "stop run" control works end to end: starting a SLURM run and then
// cancelling it (DELETE /api/pipelines/runs/{id}) must scancel the SLURM job AND
// reconcile the run to status='cancelled' in the database. This exercises the same
// status-control machinery behind the app's stop button.
//
// Determinism: we start a SLURM fastq-checksum run and issue the DELETE immediately,
// while the job is still queued/running (cancel is only valid for pending/queued/
// running). SLURM scheduling + Nextflow JVM startup give a comfortable window before
// the short job could finish, so the cancel lands reliably. cancelPipelineRunForOperator
// sets status='cancelled' synchronously, so the run is terminal as soon as DELETE
// returns; we then confirm the SLURM job is gone via sacct (CANCELLED*).
//
// Reads the same env as the SLURM smoke (SEQDESK_SLURM_E2E_BASE_URL / EMAIL /
// PASSWORD / TIMEOUT_SECONDS). Not wired into package.json or the workflow by itself;
// the integrator wires it.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assertSlurmAccountingIdentity,
  assertSlurmAccountingRecord,
  assertSlurmLaunchIdentity,
  parsePrimarySacctRecord,
  parsePrimarySqueueRecord,
} from "./lib/pipeline-e2e-proof.mjs";

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
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length <= 1000 ? compact : `${compact.slice(0, 997)}...`;
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

function toOptionalString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
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
    await execFileAsync(
      "sh",
      ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", command],
      { timeout: 5000 }
    );
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

async function requestJson(client, pathname, init, context) {
  const response = await client.request(pathname, init);
  if (!response.ok) {
    const body = await response.text();
    fail(`${context} failed (${response.status})`, summarizeBody(body));
  }
  return parseJson(response, context);
}

function assertSuccessfulSyncPayload(payload, context) {
  const validBase =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.success === true &&
    typeof payload.synced === "boolean";
  const validShape = payload?.synced
    ? [payload.progress, payload.processes, payload.tasks].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    : typeof payload?.status === "string" &&
      payload.status.trim().length > 0 &&
      typeof payload?.message === "string" &&
      payload.message.trim().length > 0;

  if (!validBase || !validShape) {
    fail(`${context} returned an invalid success payload`, JSON.stringify(payload, null, 2));
  }
  return payload;
}

async function loginAdmin({ client, baseUrl, email, password }) {
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
    fail(`Credentials login failed (${loginResponse.status})`, summarizeBody(body));
  }

  const sessionResponse = await client.request("/api/auth/session");
  if (!sessionResponse.ok) {
    fail(`Failed to fetch session after login (${sessionResponse.status})`);
  }
  const sessionPayload = await parseJson(sessionResponse, "Session endpoint");
  if (sessionPayload?.user?.email !== email || sessionPayload?.user?.role !== "FACILITY_ADMIN") {
    fail("Login did not produce the expected admin session", JSON.stringify(sessionPayload, null, 2));
  }
}

async function findOrderId(client, explicitOrderId) {
  if (explicitOrderId) return explicitOrderId;
  const payload = await requestJson(client, "/api/orders", {}, "List orders");
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  const order = orders.find((item) => item?._count?.samples > 0) || orders[0];
  if (!order?.id) {
    fail("No order was available for the SLURM cancel E2E. Pass --order-id for a seeded order.");
  }
  return order.id;
}

function buildSlurmOverride(args) {
  const slurm = {};
  const queue = toOptionalString(args["slurm-queue"] || process.env.SEQDESK_SLURM_E2E_QUEUE);
  const cores = toOptionalInt(args["slurm-cores"] || process.env.SEQDESK_SLURM_E2E_CORES);
  const memory = toOptionalString(args["slurm-memory"] || process.env.SEQDESK_SLURM_E2E_MEMORY);
  const timeLimit = toOptionalInt(args["slurm-time-limit"] || process.env.SEQDESK_SLURM_E2E_TIME_LIMIT);
  const configuredOptions = toOptionalString(
    args["slurm-options"] || process.env.SEQDESK_SLURM_E2E_OPTIONS
  );

  if (queue) slurm.queue = queue;
  if (cores && cores > 0) slurm.cores = cores;
  if (memory) slurm.memory = memory;
  if (timeLimit && timeLimit > 0) slurm.timeLimit = timeLimit;
  // A running job can remain in COMPLETING longer than the API's bounded
  // verification window after scancel. Submit this throwaway cancellation
  // target held so no payload starts and scheduler cancellation is immediate.
  slurm.options = [configuredOptions, "--hold"].filter(Boolean).join(" ");
  return Object.keys(slurm).length > 0 ? slurm : undefined;
}

const CANCELLED_STATES = new Set(["cancelled", "canceled"]);
const CANCELLABLE_STATES = new Set(["pending", "queued", "running"]);

// sacct reports a cancelled job's state starting with "CANCELLED" (optionally
// "CANCELLED by <uid>"). Confirms the SLURM job itself was actually scancel'd.
async function sacctShowsCancelled({ runId, jobId, runFolder }) {
  try {
    const { stdout } = await execFileAsync(
      "sacct",
      [
        "-X",
        "-P",
        "-j",
        String(jobId),
        "--noheader",
        "--format=JobIDRaw,JobName%128,State,ExitCode,WorkDir%1024,NodeList",
      ],
      { timeout: 15000 }
    );
    const record = parsePrimarySacctRecord(stdout, jobId);
    if (!record) return { ok: false, reason: "primary sacct row not visible yet" };
    if (record.state !== "CANCELLED" && record.state !== "CANCELED") {
      return {
        ok: false,
        state: record.state || null,
        rawState: record.rawState || null,
        record,
      };
    }
    assertSlurmAccountingRecord(record, {
      runId,
      jobId: String(jobId),
      runFolder,
      expectedOutcome: "cancelled",
      requireAllocatedNode: false,
    });
    return {
      ok: true,
      state: record.state,
      rawState: record.rawState,
      record,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function proveLiveJobIdentity({ runId, jobId, runFolder }) {
  let latest = null;
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        "squeue",
        [
          "-h",
          "-j",
          String(jobId),
          "-o",
          "%A|%.128j|%T|%.1024Z|%N",
        ],
        { timeout: 15000 },
      );
      latest = parsePrimarySqueueRecord(stdout, jobId);
      lastError = null;
      if (latest) {
        return assertSlurmAccountingIdentity(latest, {
          runId,
          jobId: String(jobId),
          runFolder,
        });
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  fail(
    `Could not prove held SLURM job ${jobId} belongs to PipelineRun ${runId} before DELETE`,
    JSON.stringify({ latest, lastError, runFolder }, null, 2),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args["base-url"] || process.env.SEQDESK_SLURM_E2E_BASE_URL || "http://localhost:3000";
  const email = args.email || process.env.SEQDESK_SLURM_E2E_EMAIL || "admin@example.com";
  const password = args.password || process.env.SEQDESK_SLURM_E2E_PASSWORD || "admin";
  const pipelineId = args["pipeline-id"] || process.env.SEQDESK_SLURM_E2E_PIPELINE_ID || "fastq-checksum";

  for (const command of ["sbatch", "squeue", "sacct", "scancel"]) {
    if (!(await commandExists(command))) {
      fail(`Required SLURM command is not available on this host: ${command}`);
    }
  }

  const client = createClient(baseUrl);
  await loginAdmin({ client, baseUrl, email, password });

  const orderId = await findOrderId(client, args["order-id"] || process.env.SEQDESK_SLURM_E2E_ORDER_ID);
  const slurm = buildSlurmOverride(args);

  // 1. Create + start a SLURM run.
  const createPayload = await requestJson(
    client,
    "/api/pipelines/runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pipelineId, orderId, config: {}, executionMode: "slurm", ...(slurm ? { slurm } : {}) }),
    },
    "Create SLURM pipeline run"
  );
  const runId = createPayload?.run?.id;
  if (typeof runId !== "string" || !runId) {
    fail("Create SLURM pipeline run did not return run.id", JSON.stringify(createPayload, null, 2));
  }

  const startPayload = await requestJson(
    client,
    `/api/pipelines/runs/${runId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionMode: "slurm", ...(slurm ? { slurm } : {}) }),
    },
    "Start SLURM pipeline run"
  );
  const jobId = startPayload?.jobId || startPayload?.queueJobId;
  if (!/^\d+$/.test(String(jobId || ""))) {
    fail(
      "SLURM start response did not include a submitted numeric job id",
      JSON.stringify({ runId, startPayload }, null, 2)
    );
  }

  // 2. Cancel immediately, while the job is still pending/queued/running. DELETE is
  //    synchronous: cancelPipelineRunForOperator scancels the job and sets the run to
  //    'cancelled' before responding.
  const runBeforeCancel = await requestJson(client, `/api/pipelines/runs/${runId}`, {}, "Fetch run before cancel");
  const beforeRun = runBeforeCancel?.run || runBeforeCancel;
  const stateBefore = beforeRun?.status;
  const launchIdentity = assertSlurmLaunchIdentity({
    runId,
    jobId,
    run: beforeRun,
    startPayload,
  });
  const liveIdentity = await proveLiveJobIdentity({
    runId,
    jobId,
    runFolder: launchIdentity.runFolder,
  });
  if (!CANCELLABLE_STATES.has(stateBefore)) {
    fail(
      `Run ${runId} was not in a cancellable state (was '${stateBefore}') — it finished before the cancel could be issued. Re-run; if persistent, the smoke pipeline is too fast to cancel reliably.`,
      JSON.stringify({ runId, jobId, stateBefore }, null, 2)
    );
  }

  const deleteResponse = await client.request(`/api/pipelines/runs/${runId}`, { method: "DELETE" });
  if (!deleteResponse.ok) {
    const body = await deleteResponse.text();
    fail(`Cancel (DELETE) failed (${deleteResponse.status}) for run ${runId}`, summarizeBody(body));
  }
  const deleteBody = await parseJson(deleteResponse, "Cancel run");
  if (deleteBody?.success !== true) {
    fail(`Cancel did not report success for run ${runId}`, JSON.stringify(deleteBody, null, 2));
  }

  // 3. Assert the DB reconciled to cancelled. Status is set synchronously, but a
  //    /sync + short settle makes the assertion robust to read timing.
  const syncPayload = assertSuccessfulSyncPayload(
    await requestJson(
      client,
      `/api/pipelines/runs/${runId}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      "Sync cancelled run",
    ),
    "Sync cancelled run",
  );
  const statusAfterSync = String(syncPayload.status || "").trim().toLowerCase() || null;
  if (statusAfterSync && !CANCELLED_STATES.has(statusAfterSync)) {
    fail(
      `Sync did not confirm the cancelled state for run ${runId}`,
      JSON.stringify(syncPayload, null, 2),
    );
  }
  await sleep(2000);
  const runAfter = await requestJson(client, `/api/pipelines/runs/${runId}`, {}, "Fetch run after cancel");
  const run = runAfter?.run || runAfter;
  const statusAfterCancel = String(run?.status || "").trim().toLowerCase();
  if (!CANCELLED_STATES.has(statusAfterCancel)) {
    fail(
      `Run ${runId} was not recorded as cancelled (status='${run?.status}') after DELETE`,
      JSON.stringify({ runId, jobId, status: run?.status, currentStep: run?.currentStep }, null, 2)
    );
  }
  if (!run?.completedAt) {
    fail(`Cancelled run ${runId} did not record completedAt`, JSON.stringify({ runId }, null, 2));
  }

  // 4. Confirm the exact top-level SLURM allocation reached CANCELLED. Accounting
  //    can lag briefly, so retry within a fixed window; failure to prove scheduler
  //    cancellation is a hard E2E failure.
  let sacct = { ok: false };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sacct = await sacctShowsCancelled({
      runId,
      jobId,
      runFolder: launchIdentity.runFolder,
    });
    if (sacct.ok) break;
    await sleep(2000);
  }
  if (!sacct.ok) {
    fail(
      `SLURM accounting did not prove job ${jobId} reached CANCELLED within the bounded retry window`,
      JSON.stringify(sacct, null, 2)
    );
  }

  const summary = {
    success: true,
    assertion: "app-and-slurm-cancellation-confirmed",
    pipelineId,
    runId,
    jobId: String(jobId),
    stateBeforeCancel: stateBefore,
    statusAfterSync,
    statusAfterCancel,
    currentStep: run?.currentStep || null,
    statusSource: run?.statusSource || null,
    liveIdentity,
    sacctCancelled: sacct.ok,
    accounting: sacct.record,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
