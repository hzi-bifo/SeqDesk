#!/usr/bin/env node
//
// SLURM FAILURE-PATH E2E
// ----------------------
// This is a deterministic *failure* sibling of run-slurm-pipeline-e2e.mjs. Where
// the success smoke proves a SLURM run completes and writes back outputs, this
// script proves SeqDesk correctly records a *failed* SLURM run in the database --
// exercising the status reconciliation path that previously got stuck at 99%
// instead of moving the run to `failed`.
//
// DELIBERATE-FAILURE MECHANISM (genuine non-zero process exit, NOT a timeout or a
// cancellation):
//   We start the `fastq-checksum` pipeline against an order whose selected sample
//   FASTQ file does NOT exist on disk at submission time. The Nextflow process
//   CALCULATE_CHECKSUMS guards its input with:
//       if [ ! -f "${fastq_1}" ]; then echo "ERROR: FASTQ file not found ..."; exit 1; fi
//   (pipelines/fastq-checksum/workflow/main.nf), so the SLURM job exits non-zero
//   and the run must reconcile to status === 'failed'.
//
//   To make the FASTQ missing deterministically without depending on un-seeded
//   data, the script itself moves the on-disk FASTQ file(s) for the selected
//   read(s) aside before starting the run, then ALWAYS restores them in a finally
//   block once the run reaches a terminal state. The absolute on-disk path is
//   reconstructed from the resolved data base path
//   (GET /api/admin/settings/sequencing-files -> dataBasePath) joined with the
//   relative read path the run GET reports under inputFiles[].path. Start-time
//   prerequisite checks only validate that the data base path directory is
//   accessible (not each individual FASTQ), so the run still submits to SLURM and
//   fails at runtime -- which is exactly the path we want to assert on.
//
// The script reads the same env as the success sibling
// (SEQDESK_SLURM_E2E_BASE_URL / EMAIL / PASSWORD / TIMEOUT_SECONDS) and is NOT
// wired into package.json or the workflow; the integrator wires it.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assertPipelineExitMarker,
  assertSlurmAccountingRecord,
  assertSlurmLaunchIdentity,
  normalizeSlurmState,
  parsePrimarySacctRecord,
  pathIsWithin,
  SLURM_PROOF_VISIBILITY_POLL_INTERVAL_MS,
  SLURM_PROOF_VISIBILITY_TIMEOUT_MS,
  slurmCompletionAttestationPath,
  stageFilesMissing,
} from "./lib/pipeline-e2e-proof.mjs";
import { syncPipelineRunFailClosed } from "./lib/pipeline-e2e-sync.mjs";

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
    fail("No order was available for the SLURM failure E2E. Pass --order-id for a seeded order.");
  }
  return order.id;
}

// GET /api/admin/settings/sequencing-files exposes the resolved data base path so
// we can turn a read's relative file path into the absolute on-disk path.
async function getDataBasePath(client) {
  const payload = await requestJson(
    client,
    "/api/admin/settings/sequencing-files",
    {},
    "Fetch sequencing files settings"
  );
  const dataBasePath = toOptionalString(payload?.dataBasePath);
  if (!dataBasePath) {
    fail(
      "Sequencing files settings did not expose a resolved dataBasePath",
      JSON.stringify(payload, null, 2)
    );
  }
  return dataBasePath;
}

// Resolve a read path the run GET reports (typically a relative path stored on the
// Read row) into an absolute on-disk path under the data base path.
function resolveOnDiskPath(dataBasePath, reportedPath) {
  if (!reportedPath) return null;
  return path.isAbsolute(reportedPath)
    ? reportedPath
    : path.resolve(dataBasePath, reportedPath);
}

function buildSlurmOverride(args) {
  const slurm = {};
  const queue = toOptionalString(args["slurm-queue"] || process.env.SEQDESK_SLURM_E2E_QUEUE);
  const cores = toOptionalInt(args["slurm-cores"] || process.env.SEQDESK_SLURM_E2E_CORES);
  const memory = toOptionalString(args["slurm-memory"] || process.env.SEQDESK_SLURM_E2E_MEMORY);
  const timeLimit = toOptionalInt(
    args["slurm-time-limit"] || process.env.SEQDESK_SLURM_E2E_TIME_LIMIT
  );
  const options = toOptionalString(
    args["slurm-options"] || process.env.SEQDESK_SLURM_E2E_OPTIONS
  );

  if (queue) slurm.queue = queue;
  if (cores && cores > 0) slurm.cores = cores;
  if (memory) slurm.memory = memory;
  if (timeLimit && timeLimit > 0) slurm.timeLimit = timeLimit;
  if (options !== undefined) slurm.options = options;
  return Object.keys(slurm).length > 0 ? slurm : undefined;
}

function slurmLogPaths(runFolder, jobId) {
  if (!runFolder || !/^\d+$/.test(String(jobId || ""))) return [];
  return [
    `${runFolder}/logs/slurm-${jobId}.out`,
    `${runFolder}/logs/slurm-${jobId}.err`,
  ];
}

function failureContext({ baseUrl, runId, run, startPayload }) {
  const jobId = run?.queueJobId || startPayload?.jobId || "<none>";
  const runFolder = run?.runFolder || startPayload?.runFolder || "<unknown>";
  const logs = slurmLogPaths(runFolder, jobId);
  return JSON.stringify(
    {
      runId,
      jobId,
      status: run?.status,
      currentStep: run?.currentStep,
      completedAt: run?.completedAt,
      runFolder,
      slurmLogs: logs,
      debugEndpoint: `${baseUrl.replace(/\/$/, "")}/api/pipelines/runs/${runId}/debug`,
    },
    null,
    2
  );
}

// Fetch the run GET and collect the relative read paths the run will operate on.
// inputFiles entries of type read_1/read_2 carry the (relative) Read.file1/file2
// values for the selected samples -- exactly the FASTQ files CALCULATE_CHECKSUMS
// reads.
function collectInputReadPaths(run) {
  const inputFiles = Array.isArray(run?.inputFiles) ? run.inputFiles : [];
  return inputFiles
    .filter((file) => file?.type === "read_1" || file?.type === "read_2")
    .map((file) => file?.path)
    .filter((value) => typeof value === "string" && value.length > 0);
}

// Move the selected FASTQ file(s) aside so the run fails deterministically, and
// return a restore() that puts them back. Always call restore() in a finally.
function makeFastqMissing({ dataBasePath, reportedReadPaths }) {
  const resolvedPaths = [];
  for (const reportedPath of new Set(reportedReadPaths)) {
    const absolute = resolveOnDiskPath(dataBasePath, reportedPath);
    if (!absolute || !pathIsWithin(absolute, dataBasePath)) {
      fail(
        "Refusing to move a pipeline input outside the configured sequencing data root",
        JSON.stringify({ dataBasePath, reportedPath, resolvedPath: absolute }, null, 2),
      );
    }
    resolvedPaths.push(absolute);
  }
  return stageFilesMissing({
    root: dataBasePath,
    filePaths: resolvedPaths,
    stashSuffix: ".seqdesk-failure-e2e.bak",
  });
}

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "canceled"]);

async function pollUntilTerminal({ client, runId, timeoutSeconds }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let latestRun = null;

  while (Date.now() < deadline) {
    await syncPipelineRunFailClosed(client, runId, {
      context: "Reconcile failed pipeline run",
    });
    const runPayload = await requestJson(
      client,
      `/api/pipelines/runs/${runId}`,
      {},
      "Fetch pipeline run"
    );
    latestRun = runPayload?.run || runPayload;

    if (TERMINAL_STATES.has(latestRun?.status)) {
      await syncPipelineRunFailClosed(client, runId, {
        context: "Confirm failed pipeline state",
      });
      const confirmPayload = await requestJson(
        client,
        `/api/pipelines/runs/${runId}`,
        {},
        "Confirm failed pipeline terminal state",
      );
      const confirmedRun = confirmPayload?.run || confirmPayload;
      if (TERMINAL_STATES.has(confirmedRun?.status)) {
        return { run: confirmedRun, timedOut: false };
      }
      latestRun = confirmedRun;
    }

    await sleep(5000);
  }

  return { run: latestRun, timedOut: true };
}

async function assertFailedSlurmAccounting({ runId, jobId, runFolder }) {
  const deadline = Date.now() + 90_000;
  let latest = null;
  let lastError = null;
  while (Date.now() < deadline) {
    let stdout = "";
    try {
      ({ stdout } = await execFileAsync(
        "sacct",
        [
          "-X",
          "-P",
          "-j",
          String(jobId),
          "--noheader",
          "--format=JobIDRaw,JobName%128,State,ExitCode,WorkDir%1024,NodeList",
        ],
        { timeout: 10_000, maxBuffer: 1024 * 1024 },
      ));
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(2000);
      continue;
    }
    latest = parsePrimarySacctRecord(stdout, jobId);
    const state = normalizeSlurmState(latest?.state);
    if (state === "FAILED") {
      return assertSlurmAccountingRecord(latest, {
        runId,
        jobId: String(jobId),
        runFolder,
        expectedOutcome: "failure",
        requireAllocatedNode: true,
      });
    }
    if (state && TERMINAL_STATES.has(state.toLowerCase())) {
      fail(
        `Deliberately broken SLURM allocation ended in ${state}, expected FAILED`,
        JSON.stringify(latest, null, 2),
      );
    }
    await sleep(2000);
  }
  fail(
    `SLURM accounting did not prove failed allocation ${jobId} within 90 seconds`,
    JSON.stringify({ latest, lastError, runFolder }, null, 2),
  );
}

async function waitForRequiredRegularFiles(paths, context) {
  let missing = [...paths];
  const deadline = Date.now() + SLURM_PROOF_VISIBILITY_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    missing = paths.filter((filePath) => !fs.existsSync(filePath));
    if (missing.length === 0) break;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(
      Math.min(SLURM_PROOF_VISIBILITY_POLL_INTERVAL_MS, remainingMs),
    );
  }
  missing = paths.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    fail(
      `${context}: required files are missing after ${SLURM_PROOF_VISIBILITY_TIMEOUT_MS / 1000}s visibility timeout after accounting completed`,
      missing.join("\n"),
    );
  }
  for (const filePath of paths) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`${context}: required path is not a regular file`, filePath);
    }
  }
  return [...paths];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl =
    args["base-url"] || process.env.SEQDESK_SLURM_E2E_BASE_URL || "http://localhost:3000";
  const email = args.email || process.env.SEQDESK_SLURM_E2E_EMAIL || "admin@example.com";
  const password = args.password || process.env.SEQDESK_SLURM_E2E_PASSWORD || "admin";
  const timeoutSeconds =
    toOptionalInt(args.timeout || process.env.SEQDESK_SLURM_E2E_TIMEOUT_SECONDS) || 600;
  // The deliberate-failure mechanism is pinned to fastq-checksum (missing FASTQ ->
  // CALCULATE_CHECKSUMS exits non-zero). Branch on it so we never assert merge-mode
  // facts elsewhere; other pipelines lack this guaranteed-failure contract.
  const pipelineId = "fastq-checksum";

  for (const command of ["sbatch", "squeue", "sacct"]) {
    if (!(await commandExists(command))) {
      fail(`Required SLURM command is not available on this host: ${command}`);
    }
  }

  const client = createClient(baseUrl);
  await loginAdmin({ client, baseUrl, email, password });

  const orderId = await findOrderId(
    client,
    args["order-id"] || process.env.SEQDESK_SLURM_E2E_ORDER_ID
  );
  const dataBasePath = await getDataBasePath(client);
  const slurm = buildSlurmOverride(args);

  // 1. Create (but do not start) the run so we can read the resolved input read
  //    paths the run will operate on, then sabotage them on disk.
  const createPayload = await requestJson(
    client,
    "/api/pipelines/runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pipelineId,
        orderId,
        config: {},
        executionMode: "slurm",
        ...(slurm ? { slurm } : {}),
      }),
    },
    "Create SLURM pipeline run"
  );
  const runId = createPayload?.run?.id;
  if (typeof runId !== "string" || !runId) {
    fail("Create SLURM pipeline run did not return run.id", JSON.stringify(createPayload, null, 2));
  }

  const createdRunPayload = await requestJson(
    client,
    `/api/pipelines/runs/${runId}`,
    {},
    "Fetch created pipeline run"
  );
  const createdRun = createdRunPayload?.run || createdRunPayload;
  const reportedReadPaths = collectInputReadPaths(createdRun);
  if (reportedReadPaths.length === 0) {
    fail(
      "Created fastq-checksum run reported no input read files; cannot stage a deterministic FASTQ-missing failure. Pass --order-id for an order whose samples have active reads.",
      failureContext({ baseUrl, runId, run: createdRun })
    );
  }

  const sabotage = makeFastqMissing({ dataBasePath, reportedReadPaths });

  let result;
  let startPayload;
  let jobId;
  let restoreSummary;
  try {
    // 2. Start the run. Start-time prerequisite checks validate the data base path
    //    directory, not individual FASTQ files, so the SLURM job is submitted and
    //    fails at runtime inside CALCULATE_CHECKSUMS.
    startPayload = await requestJson(
      client,
      `/api/pipelines/runs/${runId}/start`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ executionMode: "slurm", ...(slurm ? { slurm } : {}) }),
      },
      "Start SLURM pipeline run"
    );

    jobId = startPayload?.jobId;
    if (typeof jobId !== "string" || !/^\d+$/.test(jobId)) {
      fail("Start response did not include a numeric SLURM job id", JSON.stringify(startPayload, null, 2));
    }

    // 3. Poll (POST /sync each loop) until the run reaches a terminal state.
    result = await pollUntilTerminal({ client, runId, timeoutSeconds });
  } finally {
    // Restoration is part of the gate. A green test must leave the seeded
    // order exactly usable for the pipeline checks that follow.
    restoreSummary = sabotage.restore();
  }

  const run = result.run;
  const debugEndpoint = `${baseUrl.replace(/\/$/, "")}/api/pipelines/runs/${runId}/debug`;

  // Never reached a terminal state in time -- the reconciliation is the thing under
  // test, so a hang (e.g. stuck at 99%) is itself a hard failure here.
  if (result.timedOut) {
    fail(
      `SLURM failure E2E: run ${runId} never reached a terminal state within ${timeoutSeconds}s (status=${run?.status}, currentStep=${run?.currentStep}). This is the stuck-at-99% regression.`,
      `${failureContext({ baseUrl, runId, run, startPayload })}\nDebug: ${debugEndpoint}`
    );
  }

  // The run must NOT have succeeded -- a deliberately broken input must never be
  // reported as completed.
  if (run?.status === "completed") {
    fail(
      `SLURM failure E2E: run ${runId} unexpectedly COMPLETED despite a missing input FASTQ. The failure path was not exercised.`,
      `${failureContext({ baseUrl, runId, run, startPayload })}\nDebug: ${debugEndpoint}`
    );
  }

  // 4. HARD ASSERTION: the DB-derived run state must show a genuine failure.
  if (run?.status !== "failed") {
    fail(
      `SLURM failure E2E: run ${runId} reached terminal status '${run?.status}', expected 'failed'.`,
      `${failureContext({ baseUrl, runId, run, startPayload })}\nDebug: ${debugEndpoint}`
    );
  }

  // completedAt must be stamped when a run is finalized as failed (so the UI/monitor
  // stop polling it). This is the field that previously stayed null while progress
  // hung at 99%.
  if (!run?.completedAt) {
    fail(
      `SLURM failure E2E: run ${runId} is 'failed' but completedAt is not set (${run?.completedAt}). Reconciliation did not finalize the run.`,
      `${failureContext({ baseUrl, runId, run, startPayload })}\nDebug: ${debugEndpoint}`
    );
  }

  // A corroborating failure indication. The reconciler sets currentStep='Failed' on
  // the failure path; errorTail / a failed-status event are additional signals when
  // present. currentStep==='Failed' is the reliable one carried on the run GET, so
  // require at least one genuine failure marker (hard), and surface the others as
  // diagnostics.
  const currentStep = typeof run?.currentStep === "string" ? run.currentStep : null;
  const errorTail = typeof run?.errorTail === "string" ? run.errorTail : null;
  const events = Array.isArray(run?.events) ? run.events : [];
  const hasFailedEvent = events.some(
    (event) => String(event?.status || "").toLowerCase() === "failed"
  );
  const failureMarkerPresent =
    currentStep === "Failed" || Boolean(errorTail) || hasFailedEvent;

  if (!failureMarkerPresent) {
    fail(
      `SLURM failure E2E: run ${runId} is 'failed' with completedAt set, but no failure marker is present (currentStep=${currentStep}, errorTail set=${Boolean(
        errorTail
      )}, failed events=${hasFailedEvent}). Cannot confirm a genuine process failure was recorded.`,
      `${failureContext({ baseUrl, runId, run, startPayload })}\nDebug: ${debugEndpoint}`
    );
  }

  if (currentStep !== "Failed") {
    console.warn(
      `WARN: run ${runId} is 'failed' but currentStep is '${currentStep}' (expected 'Failed'); relying on ${
        errorTail ? "errorTail" : "a failed-status event"
      } as the failure marker.`
    );
  }

  const launchIdentity = assertSlurmLaunchIdentity({
    runId,
    jobId,
    run,
    startPayload,
  });
  const pipelineOutPath = `${launchIdentity.runFolder}/logs/pipeline.out`;
  if (!fs.existsSync(pipelineOutPath)) {
    fail(
      `SLURM failure E2E: run ${runId} did not persist logs/pipeline.out`,
      pipelineOutPath,
    );
  }
  const pipelineExitCode = assertPipelineExitMarker(
    fs.readFileSync(pipelineOutPath, "utf8"),
    {
      expectedOutcome: "failure",
      context: `SLURM failure run ${runId}`,
    },
  );
  const accounting = await assertFailedSlurmAccounting({
    runId,
    jobId,
    runFolder: launchIdentity.runFolder,
  });
  const logs = await waitForRequiredRegularFiles(
    slurmLogPaths(launchIdentity.runFolder, jobId),
    `SLURM capture logs for failed run ${runId}`,
  );
  const successAttestationPath = slurmCompletionAttestationPath(
    launchIdentity.runFolder,
    jobId,
  );
  if (fs.existsSync(successAttestationPath)) {
    fail(
      `Failed SLURM run ${runId} unexpectedly wrote a success attestation`,
      successAttestationPath,
    );
  }

  return {
    success: true,
    assertion: "failed-run-recorded",
    pipelineId,
    orderId,
    runId,
    jobId,
    status: run.status,
    currentStep,
    completedAt: run.completedAt,
    errorTailPresent: Boolean(errorTail),
    failedEventPresent: hasFailedEvent,
    sabotagedReadPaths: reportedReadPaths,
    movedFastqCount: sabotage.moved.length,
    restoreSummary,
    pipelineExitCode,
    accounting,
    runFolder: run.runFolder,
    slurmLogs: logs,
    successAttestationAbsent: true,
    debugEndpoint,
  };
}

main()
  .then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
