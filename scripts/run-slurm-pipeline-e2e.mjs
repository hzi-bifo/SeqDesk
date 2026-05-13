#!/usr/bin/env node
import fs from "node:fs";
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
    if (key === "full-mag") {
      args.fullMag = true;
      continue;
    }
    if (key === "full-metax") {
      args.fullMetax = true;
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
}

async function findOrderId(client) {
  const payload = await requestJson(client, "/api/orders", {}, "List orders");
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  const order = orders.find((item) => item?._count?.samples > 0) || orders[0];
  if (!order?.id) {
    fail("No order was available for the SLURM smoke. Pass --order-id for a seeded order.");
  }
  return order.id;
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

function failureContext({ baseUrl, runId, run, queue, startPayload }) {
  const jobId = run?.queueJobId || startPayload?.jobId || "<none>";
  const runFolder = run?.runFolder || startPayload?.runFolder || "<unknown>";
  const logs = slurmLogPaths(runFolder, jobId);
  return JSON.stringify(
    {
      runId,
      jobId,
      status: run?.status,
      queue,
      runFolder,
      slurmLogs: logs,
      debugEndpoint: `${baseUrl.replace(/\/$/, "")}/api/pipelines/runs/${runId}/debug`,
    },
    null,
    2
  );
}

async function pollUntilDone({ client, baseUrl, runId, startPayload, timeoutSeconds }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let latestRun = null;
  let latestQueue = null;

  while (Date.now() < deadline) {
    const runPayload = await requestJson(
      client,
      `/api/pipelines/runs/${runId}`,
      {},
      "Fetch pipeline run"
    );
    latestRun = runPayload?.run || runPayload;

    try {
      latestQueue = await requestJson(
        client,
        `/api/pipelines/runs/${runId}/queue`,
        {},
        "Fetch queue status"
      );
    } catch (error) {
      latestQueue = {
        error: error instanceof Error ? error.message : String(error),
      };
    }

    await client.request(`/api/pipelines/runs/${runId}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    if (latestRun?.status === "completed") {
      return { run: latestRun, queue: latestQueue };
    }
    if (["failed", "cancelled", "canceled"].includes(latestRun?.status)) {
      fail(
        `SLURM pipeline run ${runId} finished with status ${latestRun.status}`,
        failureContext({ baseUrl, runId, run: latestRun, queue: latestQueue, startPayload })
      );
    }

    await sleep(5000);
  }

  fail(
    `SLURM pipeline run ${runId} timed out after ${timeoutSeconds}s`,
    failureContext({ baseUrl, runId, run: latestRun, queue: latestQueue, startPayload })
  );
}

function assertSlurmLogs(run, jobId) {
  const logs = slurmLogPaths(run?.runFolder, jobId);
  if (logs.length === 0) {
    fail("Could not derive SLURM log paths from run folder and job id");
  }
  const existing = logs.filter((logPath) => fs.existsSync(logPath));
  if (existing.length === 0) {
    fail("No SLURM log files were found", JSON.stringify({ expected: logs }, null, 2));
  }
  return existing;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl =
    args["base-url"] || process.env.SEQDESK_SLURM_E2E_BASE_URL || "http://localhost:3000";
  const email = args.email || process.env.SEQDESK_SLURM_E2E_EMAIL || "admin@example.com";
  const password = args.password || process.env.SEQDESK_SLURM_E2E_PASSWORD || "admin";
  const timeoutSeconds =
    toOptionalInt(args.timeout || process.env.SEQDESK_SLURM_E2E_TIMEOUT_SECONDS) || 600;
  const pipelineId =
    args.fullMag
      ? "mag"
      : args.fullMetax
        ? "metaxpath"
        : args["pipeline-id"] || process.env.SEQDESK_SLURM_E2E_PIPELINE_ID || "simulate-reads";
  const targetType = args.fullMag || args["study-id"] ? "study" : "order";

  for (const command of ["sbatch", "squeue", "sacct"]) {
    if (!(await commandExists(command))) {
      fail(`Required SLURM command is not available on this host: ${command}`);
    }
  }

  const client = createClient(baseUrl);
  await loginAdmin({ client, baseUrl, email, password });

  const orderId =
    targetType === "order"
      ? args["order-id"] || process.env.SEQDESK_SLURM_E2E_ORDER_ID || await findOrderId(client)
      : undefined;
  const studyId =
    targetType === "study"
      ? args["study-id"] || process.env.SEQDESK_SLURM_E2E_STUDY_ID
      : undefined;
  if (targetType === "study" && !studyId) {
    fail("Study-scoped SLURM smoke requires --study-id or SEQDESK_SLURM_E2E_STUDY_ID.");
  }

  const config = {
    ...defaultConfigForPipeline(pipelineId),
    ...parseJsonObject(args["config-json"] || process.env.SEQDESK_SLURM_E2E_CONFIG_JSON, "config JSON"),
  };
  const slurm = buildSlurmOverride(args);

  const createPayload = await requestJson(
    client,
    "/api/pipelines/runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pipelineId,
        ...(orderId ? { orderId } : {}),
        ...(studyId ? { studyId } : {}),
        config,
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

  const jobId = startPayload?.jobId;
  if (typeof jobId !== "string" || !/^\d+$/.test(jobId)) {
    fail("Start response did not include a numeric SLURM job id", JSON.stringify(startPayload, null, 2));
  }

  const result = await pollUntilDone({
    client,
    baseUrl,
    runId,
    startPayload,
    timeoutSeconds,
  });
  const logs = assertSlurmLogs(result.run, jobId);

  return {
    success: true,
    pipelineId,
    targetType,
    orderId,
    studyId,
    runId,
    jobId,
    status: result.run.status,
    queue: result.queue,
    runFolder: result.run.runFolder,
    slurmLogs: logs,
    debugEndpoint: `${baseUrl.replace(/\/$/, "")}/api/pipelines/runs/${runId}/debug`,
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
