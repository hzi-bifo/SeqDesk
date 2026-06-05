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
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DUMMY_ORDER_PREFIX = "SEED-DUMMY-";
const PROFILE_SMOKE_ORDER_NUMBERS = new Set([
  "TWINCORE-SMOKE-001",
  "CI-RUNNER-SMOKE-001",
]);

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

async function createAndStartRun({
  client,
  baseUrl,
  pipelineId,
  orderId,
  config,
  executionMode,
  slurm,
  timeoutSeconds,
  label,
}) {
  const createBody = {
    pipelineId,
    orderId,
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
  const explicitOrderId = args["order-id"] || process.env.SEQDESK_RUNTIME_E2E_ORDER_ID;
  const selectedOrder = explicitOrderId
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
  const orderId = selectedOrder.id;
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
    runs.push({
      label: "local override",
      executionMode: "local",
      runId: localResult.runId,
      queueJobId: localResult.run.queueJobId,
      status: localResult.run.status,
      runFolder: localResult.run.runFolder,
      files,
      debugEndpoint: debugEndpoint(baseUrl, localResult.runId),
    });
  }

  if (!skipSlurm) {
    const slurmResult = await createAndStartRun({
      client,
      baseUrl,
      pipelineId,
      orderId,
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
    runs.push({
      label: "SLURM override",
      executionMode: "slurm",
      runId: slurmResult.runId,
      jobId,
      status: slurmResult.run.status,
      runFolder: slurmResult.run.runFolder,
      files,
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
    order: selectedOrder,
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
