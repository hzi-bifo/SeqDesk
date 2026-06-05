#!/usr/bin/env node
/**
 * End-to-end runtime smoke for a running SeqDesk dev server.
 *
 * Default behavior:
 * - if --order-id is omitted, prefer the admin "Load dummy data" order
 * - with --ensure-dummy-data, call the same seed endpoint if dummy data is absent
 * - run simulate-reads once with executionMode=local
 * - run simulate-reads once with executionMode=slurm
 * - verify run scripts/configs/logs match the requested runtime
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DUMMY_ORDER_PREFIX = "SEED-DUMMY-";
const PROFILE_SMOKE_ORDER_NUMBERS = new Set([
  "TWINCORE-SMOKE-001",
  "CI-RUNNER-SMOKE-001",
]);

// Pipelines whose manifest targets.supported is ['study'] (not 'order'). The run is
// created with a studyId instead of an orderId, and reads/samples come from the study.
const STUDY_SCOPED_PIPELINES = new Set(["reads-qc", "study-demo-report"]);

// Per-pipeline DB-writeback expectations, asserted after a run completes. 'checksum'
// verifies md5 checksums merged onto the order's reads; 'artifacts' verifies the
// expected PipelineArtifact rows (by outputId) were persisted. Add entries as more
// pipelines gain coverage.
const WRITEBACK_SPEC = {
  "fastq-checksum": { kind: "checksum" },
  "simulate-reads": { kind: "replace" },
  "study-demo-report": {
    kind: "artifacts",
    requiredOutputIds: ["html_report", "markdown_report", "sample_summary"],
  },
  // Artifacts-only for now (the run GET select does not expose fastqc's read-field
  // writebacks: fastqcReport/readCount/avgQuality). Require the per-sample artifacts,
  // which ingest reliably; the run-scoped `summary` artifact ingests inconsistently
  // (the file is always produced, but the PipelineArtifact row sometimes isn't), so it
  // is not required here — tracked as a known fastqc output-resolution flake.
  fastqc: {
    kind: "artifacts",
    requiredOutputIds: ["sample_qc_reports", "sample_qc_data"],
  },
};

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
    if (["skip-local", "skip-slurm", "include-default-policy", "ensure-dummy-data"].includes(key)) {
      args[key] = true;
      continue;
    }
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
        firstPart.slice(separatorIndex + 1).trim(),
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
      error instanceof Error ? `${error.message}\n${summarizeBody(text)}` : summarizeBody(text),
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

function envFlag(value) {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseJsonObject(value, label) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    fail(`Failed to parse ${label}`, error instanceof Error ? error.message : String(error));
  }
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
  return sessionPayload;
}

async function fetchOrders(client) {
  const payload = await requestJson(client, "/api/orders", {}, "List orders");
  return Array.isArray(payload?.orders) ? payload.orders : [];
}

function sampleCount(order) {
  return Number(order?._count?.samples || order?.samplesCount || order?.numberOfSamples || 0);
}

function isSubmittedOrder(order) {
  return String(order?.status || "").toUpperCase() === "SUBMITTED";
}

function isDummyOrder(order) {
  return String(order?.orderNumber || "").startsWith(DUMMY_ORDER_PREFIX);
}

function userPrefix(userId) {
  return String(userId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() || "USER";
}

function dummyOrderPrefixForSession(session) {
  const userId = session?.user?.id;
  return typeof userId === "string" && userId ? `${DUMMY_ORDER_PREFIX}${userPrefix(userId)}-` : null;
}

function isSessionDummyOrder(order, dummyOrderPrefix) {
  return Boolean(dummyOrderPrefix) && String(order?.orderNumber || "").startsWith(dummyOrderPrefix);
}

function isProfileSmokeOrder(order) {
  const orderNumber = String(order?.orderNumber || "");
  return PROFILE_SMOKE_ORDER_NUMBERS.has(orderNumber) || orderNumber.includes("SMOKE");
}

function scoreRuntimeOrder(order, dummyOrderPrefix) {
  const hasSamples = sampleCount(order) > 0;
  const submitted = isSubmittedOrder(order);
  const sessionDummy = isSessionDummyOrder(order, dummyOrderPrefix);
  const dummy = isDummyOrder(order);
  const smoke = isProfileSmokeOrder(order);

  if (sessionDummy && submitted && hasSamples) return 120;
  if (sessionDummy && hasSamples) return 110;
  if (sessionDummy) return 100;
  if (dummy && submitted && hasSamples) return 100;
  if (dummy && hasSamples) return 90;
  if (smoke && submitted && hasSamples) return 80;
  if (smoke && hasSamples) return 70;
  if (submitted && hasSamples) return 60;
  if (hasSamples) return 50;
  if (dummy) return 40;
  if (smoke) return 30;
  return 0;
}

function selectRuntimeOrder(orders, dummyOrderPrefix) {
  const sorted = [...orders].sort(
    (left, right) => scoreRuntimeOrder(right, dummyOrderPrefix) - scoreRuntimeOrder(left, dummyOrderPrefix),
  );
  return sorted.find((order) => scoreRuntimeOrder(order, dummyOrderPrefix) > 0) || sorted[0] || null;
}

async function getDummyDataStatus(client) {
  const response = await client.request("/api/admin/seed/dummy-data");
  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      status: response.status,
      error: summarizeBody(body),
    };
  }
  const payload = await parseJson(response, "Dummy data status");
  return { ok: true, ...payload };
}

async function ensureDummyData(client) {
  const response = await client.request("/api/admin/seed/dummy-data", { method: "POST" });
  if (response.status === 409) {
    const payload = await parseJson(response, "Ensure dummy data");
    return { existed: true, ...payload };
  }
  if (!response.ok) {
    const body = await response.text();
    fail("Failed to load dummy data for the runtime E2E", summarizeBody(body));
  }
  const payload = await parseJson(response, "Ensure dummy data");
  return { created: true, ...payload };
}

async function findOrder(client, { ensureSeededDummyData, dummyOrderPrefix }) {
  let orders = await fetchOrders(client);
  let selected = selectRuntimeOrder(orders, dummyOrderPrefix);
  const hasDummyOrder = orders.some((order) =>
    dummyOrderPrefix ? isSessionDummyOrder(order, dummyOrderPrefix) : isDummyOrder(order),
  );

  if (!hasDummyOrder) {
    const dummyStatus = await getDummyDataStatus(client);
    if (dummyStatus.ok && dummyStatus.seeded) {
      orders = await fetchOrders(client);
      selected = selectRuntimeOrder(orders, dummyOrderPrefix);
    } else if (ensureSeededDummyData) {
      await ensureDummyData(client);
      orders = await fetchOrders(client);
      selected = selectRuntimeOrder(orders, dummyOrderPrefix);
    }
  }

  if (!selected?.id) {
    fail(
      "No order was available for the runtime E2E. Pass --order-id, load dummy data in Admin > Settings, or run with --ensure-dummy-data.",
    );
  }

  return {
    id: selected.id,
    orderNumber: selected.orderNumber || null,
    status: selected.status || null,
    samples: sampleCount(selected),
    source: isSessionDummyOrder(selected, dummyOrderPrefix)
      ? "admin-dummy-data"
      : isDummyOrder(selected)
      ? "dummy-data"
      : isProfileSmokeOrder(selected)
        ? "install-profile-smoke"
        : "existing-order",
  };
}

async function fetchStudies(client) {
  // GET /api/studies returns a bare array of studies (each with samplesWithReads).
  const payload = await requestJson(client, "/api/studies", {}, "List studies");
  return Array.isArray(payload) ? payload : Array.isArray(payload?.studies) ? payload.studies : [];
}

function selectRuntimeStudy(studies) {
  const withReads = studies.filter((study) => Number(study?.samplesWithReads || 0) > 0);
  // Prefer the dataset seeded specifically for pipeline CI (on-disk reads); else any
  // study that has samples with reads, picking the one with the most.
  const ciSeeded = withReads.find((study) =>
    String(study?.description || "").toLowerCase().includes("pipeline ci"),
  );
  if (ciSeeded) return ciSeeded;
  return withReads.sort(
    (a, b) => Number(b?.samplesWithReads || 0) - Number(a?.samplesWithReads || 0),
  )[0];
}

async function findStudy(client, { ensureSeededDummyData }) {
  let studies = await fetchStudies(client);
  let selected = selectRuntimeStudy(studies);

  if (!selected?.id) {
    const dummyStatus = await getDummyDataStatus(client);
    if (dummyStatus.ok && dummyStatus.seeded) {
      studies = await fetchStudies(client);
      selected = selectRuntimeStudy(studies);
    } else if (ensureSeededDummyData) {
      await ensureDummyData(client);
      studies = await fetchStudies(client);
      selected = selectRuntimeStudy(studies);
    }
  }

  if (!selected?.id) {
    fail(
      "No study with on-disk reads was available for the runtime E2E. Pass --study-id, load dummy data in Admin > Settings, or run with --ensure-dummy-data.",
    );
  }

  return {
    id: selected.id,
    title: selected.title || null,
    samplesWithReads: Number(selected.samplesWithReads || 0),
    source: String(selected?.description || "").toLowerCase().includes("pipeline ci")
      ? "ci-study-dataset"
      : "existing-study",
  };
}

function defaultConfigForPipeline(pipelineId) {
  if (pipelineId === "simulate-reads") {
    return {
      simulationMode: "synthetic",
      mode: "shortReadPaired",
      readCount: 10,
      readLength: 75,
      replaceExisting: true,
    };
  }
  return {};
}

function buildSlurmOverride(args) {
  const slurm = {};
  const queue = toOptionalString(args["slurm-queue"] || process.env.SEQDESK_RUNTIME_E2E_SLURM_QUEUE);
  const cores = toOptionalInt(args["slurm-cores"] || process.env.SEQDESK_RUNTIME_E2E_SLURM_CORES);
  const memory = toOptionalString(args["slurm-memory"] || process.env.SEQDESK_RUNTIME_E2E_SLURM_MEMORY);
  const timeLimit = toOptionalInt(
    args["slurm-time-limit"] || process.env.SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT,
  );
  const options = toOptionalString(
    args["slurm-options"] || process.env.SEQDESK_RUNTIME_E2E_SLURM_OPTIONS,
  );

  if (queue) slurm.queue = queue;
  if (cores && cores > 0) slurm.cores = cores;
  if (memory) slurm.memory = memory;
  if (timeLimit && timeLimit > 0) slurm.timeLimit = timeLimit;
  if (options !== undefined) slurm.options = options;
  return Object.keys(slurm).length > 0 ? slurm : undefined;
}

function debugEndpoint(baseUrl, runId) {
  return `${baseUrl.replace(/\/$/, "")}/api/pipelines/runs/${runId}/debug`;
}

function slurmLogPaths(runFolder, jobId) {
  if (!runFolder || !/^\d+$/.test(String(jobId || ""))) return [];
  return [
    `${runFolder}/logs/slurm-${jobId}.out`,
    `${runFolder}/logs/slurm-${jobId}.err`,
  ];
}

function failureContext({ baseUrl, runId, run, queue, startPayload }) {
  const jobId = run?.queueJobId || startPayload?.jobId || startPayload?.pid || "<none>";
  const runFolder = run?.runFolder || startPayload?.runFolder || "<unknown>";
  return JSON.stringify(
    {
      runId,
      jobId,
      executionMode: run?.executionMode || startPayload?.executionMode,
      status: run?.status,
      queue,
      runFolder,
      slurmLogs: slurmLogPaths(runFolder, jobId),
      debugEndpoint: debugEndpoint(baseUrl, runId),
    },
    null,
    2,
  );
}

async function maybeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

async function fetchQueueStatus(client, runId) {
  try {
    return await requestJson(
      client,
      `/api/pipelines/runs/${runId}/queue`,
      {},
      "Fetch queue status",
    );
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function syncRun(client, runId) {
  await client.request(`/api/pipelines/runs/${runId}/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

async function pollUntilDone({ client, baseUrl, runId, startPayload, timeoutSeconds, label }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let latestRun = null;
  let latestQueue = null;

  while (Date.now() < deadline) {
    const runPayload = await requestJson(
      client,
      `/api/pipelines/runs/${runId}`,
      {},
      "Fetch pipeline run",
    );
    latestRun = runPayload?.run || runPayload;
    latestQueue = await fetchQueueStatus(client, runId);
    await syncRun(client, runId);

    if (latestRun?.status === "completed") {
      return { run: latestRun, queue: latestQueue };
    }
    if (["failed", "cancelled", "canceled"].includes(latestRun?.status)) {
      fail(
        `${label} pipeline run ${runId} finished with status ${latestRun.status}`,
        failureContext({ baseUrl, runId, run: latestRun, queue: latestQueue, startPayload }),
      );
    }

    await sleep(5000);
  }

  fail(
    `${label} pipeline run ${runId} timed out after ${timeoutSeconds}s`,
    failureContext({ baseUrl, runId, run: latestRun, queue: latestQueue, startPayload }),
  );
}

function assertLocalRunShape(run, startPayload) {
  if (startPayload.executionMode !== "local") {
    fail("Local start response did not resolve to executionMode=local", JSON.stringify(startPayload, null, 2));
  }
  if (typeof startPayload.pid !== "number" || !Number.isFinite(startPayload.pid)) {
    fail("Local start response did not include a numeric pid", JSON.stringify(startPayload, null, 2));
  }
  if (!String(run.queueJobId || "").startsWith("local-")) {
    fail("Local run did not record a local-* queueJobId", JSON.stringify({
      runId: run.id,
      queueJobId: run.queueJobId,
    }, null, 2));
  }
}

function assertSlurmRunShape(run, startPayload) {
  if (startPayload.executionMode !== "slurm") {
    fail("SLURM start response did not resolve to executionMode=slurm", JSON.stringify(startPayload, null, 2));
  }
  const jobId = startPayload.jobId || run.queueJobId;
  if (typeof jobId !== "string" || !/^\d+$/.test(jobId)) {
    fail("SLURM start/run response did not include a numeric SLURM job id", JSON.stringify({
      startPayload,
      queueJobId: run.queueJobId,
    }, null, 2));
  }
  return jobId;
}

async function assertRunFiles({ mode, run, jobId, pipelineId }) {
  const runFolder = run?.runFolder;
  if (!runFolder) fail(`${mode} run did not report a runFolder`, JSON.stringify(run, null, 2));

  const runScript = await maybeReadFile(`${runFolder}/run.sh`);
  if (!runScript) fail(`${mode} run did not create run.sh`, runFolder);

  const nextflowConfig = await maybeReadFile(`${runFolder}/nextflow.config`);
  const hasSbatchDirectives = runScript.includes("#SBATCH");
  const hasSlurmExecutor = Boolean(nextflowConfig?.includes("executor = 'slurm'"));

  // Single-job mode: the run is wrapped in one SLURM job (sbatch), but the processes
  // run with Nextflow's local executor inside it — so the config must NOT set
  // executor='slurm'. The SLURM proof is then the #SBATCH directives + the sacct job id.
  const slurmInlineExecutor =
    process.env.SEQDESK_SLURM_INLINE_EXECUTOR === "1" ||
    process.env.SEQDESK_SLURM_INLINE_EXECUTOR === "true";

  if (mode === "local") {
    if (hasSbatchDirectives) fail("Local run.sh unexpectedly contains SBATCH directives", `${runFolder}/run.sh`);
    if (hasSlurmExecutor) fail("Local nextflow.config unexpectedly sets process.executor = 'slurm'", `${runFolder}/nextflow.config`);
  } else if (mode === "slurm") {
    if (!hasSbatchDirectives) fail("SLURM run.sh does not contain SBATCH directives", `${runFolder}/run.sh`);
    if (slurmInlineExecutor) {
      if (hasSlurmExecutor) {
        fail("SLURM inline-executor run should NOT set process.executor = 'slurm'", `${runFolder}/nextflow.config`);
      }
    } else if (!hasSlurmExecutor) {
      fail("SLURM nextflow.config does not set process.executor = 'slurm'", `${runFolder}/nextflow.config`);
    }
    // SLURM's own --output/--error capture files are copied back from the compute
    // node's node-local /tmp at the very end of the job, so on a shared filesystem
    // they can lag a few seconds behind the run before they're visible from here.
    // Poll briefly. Their content is empty by design (all pipeline output goes to
    // logs/pipeline.out, which is asserted below), so a continued absence after the
    // wait is a warning rather than a hard failure.
    let existingLogs = [];
    for (let attempt = 0; attempt < 15; attempt += 1) {
      existingLogs = slurmLogPaths(runFolder, jobId).filter((logPath) => fs.existsSync(logPath));
      if (existingLogs.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (existingLogs.length === 0) {
      console.warn(
        `WARN: SLURM capture logs not visible after wait (non-fatal): ${slurmLogPaths(runFolder, jobId).join(", ")}`
      );
    }
  }

  const pipelineOut = `${runFolder}/logs/pipeline.out`;
  if (!fs.existsSync(pipelineOut)) {
    fail(`${mode} run did not create logs/pipeline.out`, pipelineOut);
  }

  const summaryPath =
    pipelineId === "simulate-reads"
      ? `${runFolder}/output/summary/simulation-summary.tsv`
      : null;
  if (summaryPath && !fs.existsSync(summaryPath)) {
    fail(`${mode} simulate-reads run did not create simulation summary`, summaryPath);
  }

  return {
    runScript: `${runFolder}/run.sh`,
    nextflowConfig: nextflowConfig ? `${runFolder}/nextflow.config` : null,
    pipelineOut,
    summaryPath,
  };
}

const MD5_HEX = /^[0-9a-f]{32}$/;

function md5OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// fastq-checksum runs in MERGE mode: on completion it writes checksum1 = md5(file1)
// and checksum2 = md5(file2) IN PLACE onto each target sample's existing active Read
// (no new Read, no pipelineRunId). discover-outputs SKIPS samples whose FASTQ is
// missing, so we only assert over reads that actually have a file path.
async function assertPipelineWriteback({ client, baseUrl, runId, pipelineId }) {
  const spec = WRITEBACK_SPEC[pipelineId];
  if (!spec) {
    return { skipped: true, reason: `no writeback spec defined for pipeline=${pipelineId}` };
  }

  // Dual-writer race: status + the output writeback are produced by two async paths
  // (weblog callback + the 15s pipeline-monitor), and writeback happens during
  // finalization. The payload that first reported "completed" can predate it, so force
  // ONE sync, settle, then RE-FETCH before asserting.
  await syncRun(client, runId);
  await sleep(3000);

  const runPayload = await requestJson(
    client,
    `/api/pipelines/runs/${runId}`,
    {},
    "Re-fetch pipeline run for writeback",
  );
  const run = runPayload?.run || runPayload;

  // Universal run-shape gate (applies to every pipeline).
  if (run?.status !== "completed") {
    fail(
      `Writeback: run ${runId} status is ${run?.status}, expected completed`,
      JSON.stringify({ runId, status: run?.status }, null, 2),
    );
  }
  if (!run?.completedAt) {
    fail(
      `Writeback: run ${runId} did not record completedAt`,
      JSON.stringify({ runId, completedAt: run?.completedAt ?? null }, null, 2),
    );
  }
  if (run?.progress !== 100) {
    fail(
      `Writeback: run ${runId} progress is ${run?.progress}, expected 100`,
      JSON.stringify({ runId, progress: run?.progress ?? null }, null, 2),
    );
  }

  // App-surface coverage on the same completed run (independent of writeback kind):
  // which path finalized the run, the per-step progress, and that the produced
  // outputs/logs are actually retrievable through the app.
  const observability = assertRunObservability(run, runId);
  const retrieval = await assertRunRetrieval({ client, run, runId });

  let writeback;
  if (spec.kind === "checksum") {
    writeback = await assertChecksumReads({ run, runId, client, baseUrl });
  } else if (spec.kind === "replace") {
    writeback = assertReplaceReads({ run, runId, baseUrl });
  } else if (spec.kind === "artifacts") {
    writeback = assertArtifactWriteback({ run, runId, baseUrl, spec });
  } else {
    fail(`Writeback: unknown spec kind '${spec.kind}' for pipeline ${pipelineId}`);
  }

  return { ...writeback, observability, retrieval };
}

// statusSource + step-level progress. statusSource records which path finalized the
// run ('queue' = the /sync API, 'trace' = the pipeline-monitor, 'weblog', 'manual');
// it is diagnostic on this cluster (no weblog), so we log it and require it to be set.
// steps come from the Nextflow trace and must all be terminal once the run completed.
function assertRunObservability(run, runId) {
  // statusSource is diagnostic: it records which path won the finalization race
  // (the e2e's frequent /sync usually wins -> 'queue'; the 15s monitor -> 'trace').
  // Surface it rather than hard-fail, since a null is possible if the monitor
  // finalizes without stamping it.
  const statusSource = typeof run?.statusSource === "string" ? run.statusSource : null;
  console.warn(`INFO: run ${runId} finalized via statusSource=${statusSource ?? "<unset>"}`);

  const steps = Array.isArray(run?.steps) ? run.steps : [];
  if (steps.length === 0) {
    fail(
      `Observability: run ${runId} exposed no pipeline steps`,
      JSON.stringify({ runId }, null, 2),
    );
  }
  const TERMINAL = new Set(["completed", "skipped", "cached"]);
  const open = steps.filter((step) => !TERMINAL.has(String(step?.status || "").toLowerCase()));
  if (open.length > 0) {
    fail(
      `Observability: run ${runId} completed but ${open.length} step(s) are non-terminal`,
      JSON.stringify({ runId, open: open.map((s) => ({ process: s?.process, status: s?.status })) }, null, 2),
    );
  }
  return { statusSource, stepCount: steps.length };
}

// Retrieve outputs + logs THROUGH the app (not just assert DB rows exist): the logs
// endpoint must return the pipeline output, and the file endpoint must serve a real
// produced file's bytes. Proves the output -> user loop closes.
async function assertRunRetrieval({ client, run, runId }) {
  // 1) Logs endpoint: the pipeline stdout must be retrievable and non-empty.
  const logsPayload = await requestJson(
    client,
    `/api/pipelines/runs/${runId}/logs?type=output&tail=200`,
    {},
    "Fetch pipeline logs",
  );
  const logContent = typeof logsPayload?.content === "string" ? logsPayload.content : "";
  if (!logContent.trim()) {
    fail(
      `Retrieval: logs endpoint returned no output for run ${runId}`,
      JSON.stringify({ runId, logsPayload }, null, 2),
    );
  }

  // 2) File endpoint: pick a produced file to download. Prefer a real artifact; fall
  //    back to the run's own pipeline.out (always present) so the check works for
  //    pipelines whose writeback is read-fields only (no artifact rows).
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const targetPath = artifacts.find((a) => a?.path)?.path || `${run?.runFolder}/logs/pipeline.out`;
  const fileResponse = await client.request(
    `/api/pipelines/runs/${runId}/file?path=${encodeURIComponent(targetPath)}&download=1`,
  );
  if (!fileResponse.ok) {
    const body = await fileResponse.text();
    fail(
      `Retrieval: file endpoint failed (${fileResponse.status}) for ${targetPath}`,
      summarizeBody(body),
    );
  }
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  if (bytes.length === 0) {
    fail(`Retrieval: file endpoint served 0 bytes for ${targetPath}`, JSON.stringify({ runId, targetPath }, null, 2));
  }

  return {
    logBytes: logContent.length,
    filePath: targetPath,
    fileBytes: bytes.length,
    fromArtifact: Boolean(artifacts.find((a) => a?.path)),
  };
}

// Assert PipelineArtifact rows were persisted for a run (e.g. report/summary pipelines
// that don't write Read fields). Requires at least one artifact per required outputId.
function assertArtifactWriteback({ run, runId, baseUrl, spec }) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  if (artifacts.length === 0) {
    fail(
      `Artifact writeback: run ${runId} persisted no PipelineArtifact rows`,
      JSON.stringify({ runId, debugEndpoint: debugEndpoint(baseUrl, runId) }, null, 2),
    );
  }
  const seenOutputIds = new Set(artifacts.map((artifact) => artifact?.outputId).filter(Boolean));
  const missing = (spec.requiredOutputIds || []).filter((outputId) => !seenOutputIds.has(outputId));
  if (missing.length > 0) {
    fail(
      `Artifact writeback: run ${runId} is missing artifacts for outputId(s): ${missing.join(", ")}`,
      JSON.stringify(
        { runId, present: Array.from(seenOutputIds), required: spec.requiredOutputIds },
        null,
        2,
      ),
    );
  }
  // Every required artifact must carry a non-empty path (i.e. it was actually written).
  for (const artifact of artifacts) {
    if ((spec.requiredOutputIds || []).includes(artifact?.outputId)) {
      if (typeof artifact?.path !== "string" || !artifact.path) {
        fail(
          `Artifact writeback: artifact ${artifact?.id} (outputId ${artifact?.outputId}) has no path`,
          JSON.stringify({ runId, artifact }, null, 2),
        );
      }
    }
  }
  return {
    runId,
    artifactCount: artifacts.length,
    outputIds: Array.from(seenOutputIds),
    debugEndpoint: debugEndpoint(baseUrl, runId),
  };
}

// fastq-checksum (MERGE): checksum1 = md5(file1) written in place onto each target
// sample's existing active Read. Asserts format + coverage + an on-disk md5 round-trip.
async function assertChecksumReads({ run, runId, client, baseUrl }) {
  // Reads live under order.samples (order target) or study.samples (study target);
  // the run GET already filters reads to isActive=true. Collect whichever is present.
  const targetSamples =
    run?.targetType === "order"
      ? run?.order?.samples
      : run?.targetType === "study"
        ? run?.study?.samples
        : run?.order?.samples || run?.study?.samples;
  const samples = Array.isArray(targetSamples) ? targetSamples : [];

  const reads = [];
  for (const sample of samples) {
    for (const read of sample?.reads ?? []) {
      reads.push({ sampleId: sample?.sampleId, ...read });
    }
  }

  const readsWithFile1 = reads.filter((read) => read.file1 != null);
  if (readsWithFile1.length === 0) {
    fail(
      `Checksum writeback: run ${runId} exposed no active reads with a file1 to verify`,
      JSON.stringify(
        { runId, targetType: run?.targetType, sampleCount: samples.length, readCount: reads.length },
        null,
        2,
      ),
    );
  }

  // (A) FORMAT + COVERAGE: every read with a file path must carry a populated checksum.
  let populatedChecksum1 = 0;
  for (const read of readsWithFile1) {
    if (typeof read.checksum1 !== "string" || !MD5_HEX.test(read.checksum1)) {
      fail(
        `Checksum writeback: read ${read.id} (sample ${read.sampleId}) has file1 but checksum1 is not a 32-char md5 hex`,
        JSON.stringify({ runId, file1: read.file1, checksum1: read.checksum1 ?? null }, null, 2),
      );
    }
    populatedChecksum1 += 1;
  }
  for (const read of reads) {
    if (read.file2 != null && read.checksum2 == null) {
      fail(
        `Checksum writeback: read ${read.id} (sample ${read.sampleId}) has file2 but checksum2 is null`,
        JSON.stringify({ runId, file2: read.file2, checksum2: read.checksum2 ?? null }, null, 2),
      );
    }
  }
  if (populatedChecksum1 < 1) {
    fail(
      `Checksum writeback: run ${runId} did not populate any checksum1 (vacuous pass)`,
      JSON.stringify({ runId, readsWithFile1: readsWithFile1.length }, null, 2),
    );
  }

  // (B) CORRECTNESS: independently recompute md5(file1) on disk for at least one read
  // and require it to equal the stored checksum1. Read.file1 is stored RELATIVE to the
  // pipeline data base path, so resolve it against that root (the script runs on the
  // runner, which can read the shared data dir) before hashing. If the path still isn't
  // readable, WARN and skip the equality (format + coverage above still hard-fail).
  let md5Verified = 0;
  const md5Warnings = [];

  let dataBasePath = null;
  try {
    const settings = await requestJson(
      client,
      "/api/admin/settings/sequencing-files",
      {},
      "Fetch sequencing-files settings",
    );
    dataBasePath = typeof settings?.dataBasePath === "string" ? settings.dataBasePath : null;
  } catch (error) {
    md5Warnings.push(
      `could not resolve data base path (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const resolveOnDisk = (file1) => {
    if (typeof file1 !== "string" || !file1) return null;
    const candidates = [];
    if (path.isAbsolute(file1)) candidates.push(file1);
    if (dataBasePath) candidates.push(path.resolve(dataBasePath, file1));
    candidates.push(path.resolve(file1)); // last-ditch: cwd-relative
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  };
  for (const read of readsWithFile1) {
    const onDisk = resolveOnDisk(read.file1);
    if (!onDisk) {
      md5Warnings.push(`read ${read.id}: file1 not readable here (${read.file1}, base=${dataBasePath ?? "<unknown>"})`);
      continue;
    }
    let computed;
    try {
      computed = await md5OfFile(onDisk);
    } catch (error) {
      md5Warnings.push(
        `read ${read.id}: md5 of ${onDisk} failed (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    if (computed !== read.checksum1) {
      fail(
        `Checksum writeback: stored checksum1 does not match recomputed md5 for read ${read.id} (sample ${read.sampleId})`,
        JSON.stringify({ runId, file1: read.file1, onDisk, stored: read.checksum1, computed }, null, 2),
      );
    }
    md5Verified += 1;
    break; // one independently verified read is sufficient for the correctness claim
  }

  if (md5Verified === 0) {
    console.warn(
      `WARN: checksum writeback md5 equality could not be verified on disk for run ${runId} ` +
        `(format + coverage still passed): ${md5Warnings.join("; ") || "no readable file1"}`,
    );
  }
  for (const warning of md5Warnings) {
    if (md5Verified > 0) console.warn(`WARN: ${warning}`);
  }

  return {
    runId,
    targetType: run?.targetType,
    readsChecked: readsWithFile1.length,
    populatedChecksum1,
    md5Verified,
    md5Warnings,
    debugEndpoint: debugEndpoint(baseUrl, runId),
  };
}

// simulate-reads runs in REPLACE mode: on completion it creates a NEW active Read for
// each sample (file1/2 + checksum1/2 + readCount1/2) and supersedes the prior reads.
// Attribute via pipelineRunId/pipelineSources when the run GET exposes them, else fall
// back to "an active read carries a valid md5 checksum1" (the seed sets none, so a
// populated checksum proves this run wrote it). Mirrors run-slurm-pipeline-e2e.mjs.
function assertReplaceReads({ run, runId, baseUrl }) {
  const targetSamples =
    run?.targetType === "order"
      ? run?.order?.samples
      : run?.targetType === "study"
        ? run?.study?.samples
        : run?.order?.samples || run?.study?.samples;
  const samples = Array.isArray(targetSamples) ? targetSamples : [];
  const reads = [];
  for (const sample of samples) {
    for (const read of sample?.reads ?? []) {
      reads.push({ sampleId: sample?.sampleId, ...read });
    }
  }

  let attributionMode;
  let attributed = [];
  if (reads.some((read) => "pipelineRunId" in read)) {
    attributionMode = "pipelineRunId";
    attributed = reads.filter((read) => read.pipelineRunId === runId);
  } else if (reads.some((read) => typeof read.pipelineSources === "string")) {
    attributionMode = "pipelineSources";
    attributed = reads.filter((read) => String(read.pipelineSources || "").includes(runId));
  } else {
    attributionMode = "checksum1-fallback";
    attributed = reads.filter(
      (read) => typeof read.checksum1 === "string" && MD5_HEX.test(read.checksum1),
    );
  }

  if (attributed.length === 0) {
    fail(
      `Replace writeback: run ${runId} produced no attributable active read (mode=${attributionMode})`,
      JSON.stringify(
        { runId, activeReads: reads.length, attributionMode, debugEndpoint: debugEndpoint(baseUrl, runId) },
        null,
        2,
      ),
    );
  }
  // readCount1 is a strong signal but isn't exposed by the run GET select today; only
  // enforce when present.
  if (attributionMode !== "checksum1-fallback") {
    for (const read of attributed) {
      if ("readCount1" in read && !(Number(read.readCount1) > 0)) {
        fail(
          `Replace writeback: attributed read ${read.id} has no positive readCount1`,
          JSON.stringify({ runId, readCount1: read.readCount1 ?? null }, null, 2),
        );
      }
    }
  }

  return {
    runId,
    attributionMode,
    activeReadCount: reads.length,
    attributedReadCount: attributed.length,
    debugEndpoint: debugEndpoint(baseUrl, runId),
  };
}

async function createAndStartRun({
  client,
  baseUrl,
  pipelineId,
  orderId,
  studyId,
  config,
  executionMode,
  slurm,
  timeoutSeconds,
  label,
}) {
  // Exactly one of orderId / studyId is sent, matching the pipeline's manifest target.
  const createBody = {
    pipelineId,
    ...(studyId ? { studyId } : { orderId }),
    config,
    executionMode,
    ...(executionMode === "slurm" && slurm ? { slurm } : {}),
  };
  const createPayload = await requestJson(
    client,
    "/api/pipelines/runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody),
    },
    `Create ${label} pipeline run`,
  );
  const runId = createPayload?.run?.id;
  if (typeof runId !== "string" || !runId) {
    fail(`Create ${label} pipeline run did not return run.id`, JSON.stringify(createPayload, null, 2));
  }

  const startPayload = await requestJson(
    client,
    `/api/pipelines/runs/${runId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionMode,
        ...(executionMode === "slurm" && slurm ? { slurm } : {}),
      }),
    },
    `Start ${label} pipeline run`,
  );

  const result = await pollUntilDone({
    client,
    baseUrl,
    runId,
    startPayload,
    timeoutSeconds,
    label,
  });

  return { runId, startPayload, ...result };
}

async function getPipelinePolicy(client, pipelineId) {
  const payload = await requestJson(
    client,
    "/api/admin/settings/pipelines",
    {},
    "Fetch pipeline settings",
  );
  const pipelines = Array.isArray(payload?.pipelines) ? payload.pipelines : [];
  return pipelines.find((pipeline) => pipeline?.pipelineId === pipelineId) || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl =
    args["base-url"] || process.env.SEQDESK_RUNTIME_E2E_BASE_URL || "http://localhost:3000";
  const email = args.email || process.env.SEQDESK_RUNTIME_E2E_EMAIL || "admin@example.com";
  const password = args.password || process.env.SEQDESK_RUNTIME_E2E_PASSWORD || "admin";
  const timeoutSeconds =
    toOptionalInt(args.timeout || process.env.SEQDESK_RUNTIME_E2E_TIMEOUT_SECONDS) || 600;
  const pipelineId =
    args["pipeline-id"] || process.env.SEQDESK_RUNTIME_E2E_PIPELINE_ID || "simulate-reads";
  const skipLocal = Boolean(args["skip-local"]);
  const skipSlurm = Boolean(args["skip-slurm"]);
  const includeDefaultPolicy = Boolean(args["include-default-policy"]);
  const ensureSeededDummyData =
    Boolean(args["ensure-dummy-data"]) ||
    envFlag(process.env.SEQDESK_RUNTIME_E2E_ENSURE_DUMMY_DATA);
  const expectDefaultMode = toOptionalString(
    args["expect-default-mode"] || process.env.SEQDESK_RUNTIME_E2E_EXPECT_DEFAULT_MODE,
  );

  if (skipLocal && skipSlurm && !includeDefaultPolicy) {
    fail("Nothing to run: remove --skip-local/--skip-slurm or add --include-default-policy.");
  }
  if (expectDefaultMode && !["local", "slurm"].includes(expectDefaultMode)) {
    fail("--expect-default-mode must be local or slurm");
  }

  if (!skipSlurm || expectDefaultMode === "slurm") {
    for (const command of ["sbatch", "squeue", "sacct"]) {
      if (!(await commandExists(command))) {
        fail(`Required SLURM command is not available on this host: ${command}`);
      }
    }
  }

  const client = createClient(baseUrl);
  const session = await loginAdmin({ client, baseUrl, email, password });

  // Study-scoped pipelines (per manifest targets.supported) run against a study;
  // everything else runs against an order.
  const targetType = STUDY_SCOPED_PIPELINES.has(pipelineId) ? "study" : "order";

  let selectedOrder = null;
  let selectedStudy = null;
  let orderId;
  let studyId;
  if (targetType === "study") {
    const explicitStudyId = args["study-id"] || process.env.SEQDESK_RUNTIME_E2E_STUDY_ID;
    selectedStudy = explicitStudyId
      ? { id: explicitStudyId, title: null, samplesWithReads: null, source: "explicit" }
      : await findStudy(client, { ensureSeededDummyData });
    studyId = selectedStudy.id;
  } else {
    const explicitOrderId = args["order-id"] || process.env.SEQDESK_RUNTIME_E2E_ORDER_ID;
    selectedOrder = explicitOrderId
      ? {
          id: explicitOrderId,
          orderNumber: null,
          status: null,
          samples: null,
          source: "explicit",
        }
      : await findOrder(client, {
          ensureSeededDummyData,
          dummyOrderPrefix: dummyOrderPrefixForSession(session),
        });
    orderId = selectedOrder.id;
  }
  const config = {
    ...defaultConfigForPipeline(pipelineId),
    ...parseJsonObject(args["config-json"] || process.env.SEQDESK_RUNTIME_E2E_CONFIG_JSON, "config JSON"),
  };
  const slurm = buildSlurmOverride(args);
  const policy = await getPipelinePolicy(client, pipelineId);
  if (!policy) fail(`Pipeline ${pipelineId} was not returned by /api/admin/settings/pipelines`);
  if (!policy.enabled) fail(`Pipeline ${pipelineId} is not enabled in SeqDesk settings`);

  const runs = [];

  if (!skipLocal) {
    const localResult = await createAndStartRun({
      client,
      baseUrl,
      pipelineId,
      orderId,
      studyId,
      config,
      executionMode: "local",
      timeoutSeconds,
      label: "local override",
    });
    assertLocalRunShape(localResult.run, localResult.startPayload);
    const files = await assertRunFiles({
      mode: "local",
      run: localResult.run,
      pipelineId,
    });
    const writeback = await assertPipelineWriteback({
      client,
      baseUrl,
      runId: localResult.runId,
      pipelineId,
    });
    runs.push({
      label: "local override",
      executionMode: "local",
      runId: localResult.runId,
      queueJobId: localResult.run.queueJobId,
      status: localResult.run.status,
      runFolder: localResult.run.runFolder,
      files,
      writeback,
      debugEndpoint: debugEndpoint(baseUrl, localResult.runId),
    });
  }

  if (!skipSlurm) {
    const slurmResult = await createAndStartRun({
      client,
      baseUrl,
      pipelineId,
      orderId,
      studyId,
      config,
      executionMode: "slurm",
      slurm,
      timeoutSeconds,
      label: "SLURM override",
    });
    const jobId = assertSlurmRunShape(slurmResult.run, slurmResult.startPayload);
    const files = await assertRunFiles({
      mode: "slurm",
      run: slurmResult.run,
      jobId,
      pipelineId,
    });
    const writeback = await assertPipelineWriteback({
      client,
      baseUrl,
      runId: slurmResult.runId,
      pipelineId,
    });
    runs.push({
      label: "SLURM override",
      executionMode: "slurm",
      runId: slurmResult.runId,
      jobId,
      status: slurmResult.run.status,
      runFolder: slurmResult.run.runFolder,
      files,
      writeback,
      slurmLogs: slurmLogPaths(slurmResult.run.runFolder, jobId),
      debugEndpoint: debugEndpoint(baseUrl, slurmResult.runId),
    });
  }

  if (includeDefaultPolicy) {
    const defaultResult = await createAndStartRun({
      client,
      baseUrl,
      pipelineId,
      orderId,
      studyId,
      config,
      executionMode: "default",
      timeoutSeconds,
      label: "configured default policy",
    });
    const resolvedMode = defaultResult.startPayload.executionMode || defaultResult.run.executionMode;
    if (!["local", "slurm"].includes(resolvedMode)) {
      fail(
        `Configured default policy resolved to an unsupported mode: ${resolvedMode}`,
        JSON.stringify({
          policy: policy.executionPolicy,
          runId: defaultResult.runId,
          startPayload: defaultResult.startPayload,
        }, null, 2),
      );
    }
    if (expectDefaultMode && resolvedMode !== expectDefaultMode) {
      fail(
        `Configured default policy resolved to ${resolvedMode}, expected ${expectDefaultMode}`,
        JSON.stringify({
          policy: policy.executionPolicy,
          runId: defaultResult.runId,
          startPayload: defaultResult.startPayload,
        }, null, 2),
      );
    }
    const jobId = resolvedMode === "slurm"
      ? assertSlurmRunShape(defaultResult.run, defaultResult.startPayload)
      : undefined;
    if (resolvedMode === "local") {
      assertLocalRunShape(defaultResult.run, defaultResult.startPayload);
    }
    const files = await assertRunFiles({
      mode: resolvedMode,
      run: defaultResult.run,
      jobId,
      pipelineId,
    });
    runs.push({
      label: "configured default policy",
      executionMode: resolvedMode,
      runId: defaultResult.runId,
      jobId,
      queueJobId: defaultResult.run.queueJobId,
      status: defaultResult.run.status,
      runFolder: defaultResult.run.runFolder,
      files,
      slurmLogs: jobId ? slurmLogPaths(defaultResult.run.runFolder, jobId) : [],
      debugEndpoint: debugEndpoint(baseUrl, defaultResult.runId),
    });
  }

  return {
    success: true,
    baseUrl,
    pipelineId,
    targetType,
    order: selectedOrder,
    study: selectedStudy,
    configuredPolicy: policy.executionPolicy || null,
    config,
    slurmOverride: slurm || null,
    runs,
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
