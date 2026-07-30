#!/usr/bin/env node
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assertExactAttributedReadSampleCoverage,
  assertPipelineExitMarker,
  assertSlurmAccountingRecord,
  assertSlurmCompletionAttestation,
  assertSlurmLaunchIdentity,
  normalizeSlurmState,
  parsePrimarySacctRecord,
  slurmCompletionAttestationPath,
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
    await syncPipelineRunFailClosed(client, runId, {
      context: "Reconcile pipeline run",
    });

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

    if (latestRun?.status === "completed") {
      // A trace-derived completion used to be observable before the wrapper exit
      // marker existed. Reconcile and read once more so a transient false
      // completion cannot make this older SLURM-only harness green.
      await syncPipelineRunFailClosed(client, runId, {
        context: "Confirm pipeline completion",
      });
      const confirmPayload = await requestJson(
        client,
        `/api/pipelines/runs/${runId}`,
        {},
        "Confirm pipeline completion",
      );
      const confirmedRun = confirmPayload?.run || confirmPayload;
      if (confirmedRun?.status === "completed") {
        return { run: confirmedRun, queue: latestQueue };
      }
      latestRun = confirmedRun;
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

const SLURM_TERMINAL_STATES = new Set([
  "BOOT_FAIL",
  "CANCELLED",
  "CANCELED",
  "COMPLETED",
  "DEADLINE",
  "FAILED",
  "NODE_FAIL",
  "OUT_OF_MEMORY",
  "PREEMPTED",
  "REVOKED",
  "TIMEOUT",
]);

async function assertSuccessfulSlurmAccounting({ runId, jobId, runFolder }) {
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
    if (state === "COMPLETED") {
      return assertSlurmAccountingRecord(latest, {
        runId,
        jobId: String(jobId),
        runFolder,
        expectedOutcome: "success",
      });
    }
    if (SLURM_TERMINAL_STATES.has(state)) {
      fail(
        `SLURM allocation ${jobId} reached terminal state ${state}, expected COMPLETED`,
        JSON.stringify(latest, null, 2),
      );
    }
    await sleep(2000);
  }
  fail(
    `SLURM accounting did not prove successful allocation ${jobId} within 90 seconds`,
    JSON.stringify({ latest, lastError, runFolder }, null, 2),
  );
}

async function assertSlurmRunFiles({ run, pipelineId }) {
  const runFolder = run?.runFolder;
  const runScriptPath = `${runFolder}/run.sh`;
  const nextflowConfigPath = `${runFolder}/nextflow.config`;
  const pipelineOutPath = `${runFolder}/logs/pipeline.out`;
  if (!fs.existsSync(runScriptPath)) {
    fail("SLURM run did not create run.sh", runScriptPath);
  }
  const runScript = fs.readFileSync(runScriptPath, "utf8");
  if (!runScript.includes("#SBATCH")) {
    fail("SLURM run.sh has no SBATCH directives", runScriptPath);
  }
  const nextflowConfig = fs.existsSync(nextflowConfigPath)
    ? fs.readFileSync(nextflowConfigPath, "utf8")
    : "";
  const hasSlurmExecutor = nextflowConfig.includes("executor = 'slurm'");
  const inlineExecutor = ["1", "true"].includes(
    String(process.env.SEQDESK_SLURM_INLINE_EXECUTOR || "").toLowerCase(),
  );
  if (inlineExecutor ? hasSlurmExecutor : !hasSlurmExecutor) {
    fail(
      inlineExecutor
        ? "SLURM inline-executor run unexpectedly configured nested process.executor='slurm'"
        : "SLURM run did not configure process.executor='slurm'",
      nextflowConfigPath,
    );
  }
  if (!fs.existsSync(pipelineOutPath)) {
    fail("SLURM run did not create logs/pipeline.out", pipelineOutPath);
  }
  const pipelineExitCode = assertPipelineExitMarker(
    fs.readFileSync(pipelineOutPath, "utf8"),
    {
      expectedOutcome: "success",
      context: `SLURM ${pipelineId} run ${run?.id ?? "<unknown>"}`,
    },
  );
  return {
    runScriptPath,
    nextflowConfigPath,
    pipelineOutPath,
    pipelineExitCode,
  };
}

async function resolveSlurmNodeHosts(nodeList, jobId) {
  if (
    typeof nodeList !== "string" ||
    !nodeList.trim() ||
    /^(?:none|unknown|n\/a|\(null\)|none assigned)$/i.test(nodeList.trim())
  ) {
    fail(
      `SLURM allocation ${jobId} has no resolvable NodeList`,
      JSON.stringify({ nodeList: nodeList ?? null }, null, 2),
    );
  }
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "scontrol",
      ["show", "hostnames", nodeList.trim()],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    ));
  } catch (error) {
    fail(
      `Could not expand SLURM NodeList for allocation ${jobId}`,
      error instanceof Error ? error.message : String(error),
    );
  }
  const hosts = [
    ...new Set(
      String(stdout || "")
        .split(/\r?\n/)
        .map((host) => host.trim())
        .filter(Boolean),
    ),
  ];
  if (hosts.length === 0) {
    fail(
      `scontrol returned no hosts for SLURM allocation ${jobId}`,
      JSON.stringify({ nodeList }, null, 2),
    );
  }
  return hosts;
}

async function waitForRequiredRegularFiles(paths, context) {
  let missing = [...paths];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    missing = paths.filter((filePath) => !fs.existsSync(filePath));
    if (missing.length === 0) break;
    await sleep(1000);
  }
  missing = paths.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    fail(`${context}: required files are missing after accounting completed`, missing.join("\n"));
  }
  for (const filePath of paths) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`${context}: required path is not a regular file`, filePath);
    }
  }
  return [...paths];
}

async function assertSlurmCompletionProof({
  runId,
  jobId,
  runFolder,
  accounting,
}) {
  const nodeHosts = await resolveSlurmNodeHosts(accounting.nodeList, jobId);
  const attestationPath = slurmCompletionAttestationPath(runFolder, jobId);
  await waitForRequiredRegularFiles(
    [attestationPath],
    `SLURM completion attestation for run ${runId}`,
  );
  return {
    path: attestationPath,
    ...assertSlurmCompletionAttestation({
      contents: fs.readFileSync(attestationPath, "utf8"),
      runId,
      jobId,
      nodeHosts,
      context: `SLURM completion attestation for run ${runId}`,
    }),
  };
}

async function assertSlurmLogs(run, jobId) {
  const logs = slurmLogPaths(run?.runFolder, jobId);
  if (logs.length === 0) {
    fail("Could not derive SLURM log paths from run folder and job id");
  }
  return waitForRequiredRegularFiles(
    logs,
    `SLURM capture logs for run ${run?.id ?? "<unknown>"}`,
  );
}

const MD5_RE = /^[0-9a-f]{32}$/;

function collectActiveOrderReads(run, orderId) {
  // The run GET (getPipelineRunDetailsForOperator) already filters reads to
  // isActive=true in its Prisma select, but we re-check the flag defensively in
  // case the select changes. Reads live under run.order.samples[].reads[].
  const order = run?.order;
  if (orderId && order?.id && order.id !== orderId) {
    fail(
      `Run order id mismatch during writeback assertion`,
      `expected ${orderId} but run.order.id is ${order.id}`
    );
  }
  const samples = Array.isArray(order?.samples) ? order.samples : [];
  const reads = [];
  for (const sample of samples) {
    for (const read of Array.isArray(sample?.reads) ? sample.reads : []) {
      if (read?.isActive === false) continue;
      reads.push({ ...read, sampleId: sample?.sampleId });
    }
  }
  return reads;
}

function parsePipelineSources(value) {
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

// REPLACE-mode (simulate-reads) DB writeback assertion. The run GET now exposes
// pipelineRunId, pipelineSources and readCount fields. Require those exact
// per-run attribution fields; accepting any pre-existing md5 checksum here made
// a previous simulate-reads run sufficient for a false green.
async function assertReplaceWriteback({ client, runId, orderId, pipelineId }) {
  // Dual-writer race: status + checksum/read writeback land via two async paths
  // (weblog callback + the 15s pipeline-monitor) during finalization. Do ONE more
  // sync, settle, then RE-FETCH so we never assert on the pre-writeback payload
  // that first reported 'completed'.
  await syncPipelineRunFailClosed(client, runId, {
    context: "Reconcile pipeline run before writeback assertion",
  });
  await sleep(3000);

  const payload = await requestJson(
    client,
    `/api/pipelines/runs/${runId}`,
    {},
    "Re-fetch pipeline run for writeback assertion"
  );
  const run = payload?.run || payload;

  if (run?.status !== "completed") {
    fail(
      `Writeback assertion: run ${runId} status is ${run?.status}, expected completed`,
      JSON.stringify({ runId, status: run?.status, progress: run?.progress }, null, 2)
    );
  }
  if (!run?.completedAt) {
    fail(`Writeback assertion: run ${runId} has no completedAt after completion`);
  }
  if (run?.progress !== 100) {
    fail(
      `Writeback assertion: run ${runId} progress is ${run?.progress}, expected 100`
    );
  }

  // Branch on the resolved pipeline id. fastq-checksum is MERGE mode (checksum
  // written in place onto the existing active read, no new read); everything else
  // here is the simulate-reads REPLACE-mode target. Never assert merge-mode facts
  // on simulate-reads, or vice versa.
  if (pipelineId === "fastq-checksum") {
    return assertMergeWriteback({ run, runId, orderId });
  }
  if (pipelineId !== "simulate-reads") {
    fail(
      `No order-writeback proof is defined for pipeline '${pipelineId}'`,
      "Use scripts/run-pipeline-runtime-e2e.mjs and add a pipeline-specific WRITEBACK_SPEC before treating it as a required green gate.",
    );
  }

  const reads = collectActiveOrderReads(run, orderId);
  if (reads.length === 0) {
    fail(
      `Writeback assertion: REPLACE-mode run ${runId} produced no active order reads`,
      JSON.stringify({ runId, orderId, pipelineId }, null, 2)
    );
  }

  const attributionMode = "pipelineRunId+pipelineSources";
  const attributedReads = reads.filter((read) => read.pipelineRunId === runId);

  if (attributedReads.length === 0) {
    fail(
      `Writeback assertion: no active read attributable to REPLACE-mode run ${runId} (mode=${attributionMode})`,
      JSON.stringify(
        {
          runId,
          orderId,
          attributionMode,
          activeReads: reads.map((read) => ({
            id: read.id,
            sampleId: read.sampleId,
            checksum1: read.checksum1 ?? null,
            pipelineRunId: read.pipelineRunId ?? null,
          })),
        },
        null,
        2
      )
    );
  }
  const expectedSampleIds = (run?.order?.samples ?? [])
    .map((sample) => sample?.sampleId)
    .filter((sampleId) => typeof sampleId === "string" && sampleId.length > 0);
  const sampleCoverage = assertExactAttributedReadSampleCoverage({
    expectedSampleIds,
    attributedReads,
    context: `REPLACE-mode writeback for run ${runId}`,
  });

  for (const read of attributedReads) {
    const sources = parsePipelineSources(read.pipelineSources);
    if (sources[pipelineId] !== runId) {
      fail(
        `Writeback assertion: read ${read.id} is not attributed to ${pipelineId} run ${runId} in pipelineSources`,
        JSON.stringify({ readId: read.id, pipelineRunId: read.pipelineRunId, sources }, null, 2),
      );
    }
    if (!(Number(read.readCount1) > 0)) {
      fail(
        `Writeback assertion: attributed read ${read.id} has no positive readCount1`,
        JSON.stringify({ readId: read.id, readCount1: read.readCount1 ?? null }, null, 2),
      );
    }
    if (typeof read.checksum1 !== "string" || !MD5_RE.test(read.checksum1)) {
      fail(
        `Writeback assertion: attributed read ${read.id} has no valid md5 checksum1`,
        JSON.stringify({ readId: read.id, checksum1: read.checksum1 ?? null }, null, 2),
      );
    }
  }

  return {
    pipelineId,
    mode: "replace",
    attributionMode,
    activeReadCount: reads.length,
    attributedReadCount: attributedReads.length,
    targetSampleCount: sampleCoverage.expectedSampleCount,
    readCountReported: true,
  };
}

// MERGE-mode (fastq-checksum) writeback: checksum1 = md5(file1) (and checksum2 if
// file2 present) is written IN PLACE onto each order sample's existing active read.
// No new read; no pipelineRunId set. discover-outputs SKIPS samples whose FASTQ is
// missing, so we scope to reads with file1 != null and require >=1 populated
// checksum to avoid a vacuous pass.
function assertMergeWriteback({ run, runId, orderId }) {
  const reads = collectActiveOrderReads(run, orderId).filter((read) => read?.file1);
  if (reads.length === 0) {
    fail(
      `Writeback assertion: MERGE-mode run ${runId} produced no active order reads with file1`,
      JSON.stringify({ runId, orderId }, null, 2)
    );
  }
  const populated = reads.filter(
    (read) => typeof read.checksum1 === "string" && MD5_RE.test(read.checksum1)
  );
  if (populated.length !== reads.length) {
    fail(
      `Writeback assertion: MERGE-mode run ${runId} populated ${populated.length} of ${reads.length} checksum1 values`,
      JSON.stringify(
        reads.map((read) => ({
          id: read.id,
          sampleId: read.sampleId,
          checksum1: read.checksum1 ?? null,
        })),
        null,
        2
      )
    );
  }
  const missingPairedChecksum = reads.filter(
    (read) =>
      read.file2 != null &&
      (typeof read.checksum2 !== "string" || !MD5_RE.test(read.checksum2)),
  );
  if (missingPairedChecksum.length > 0) {
    fail(
      `Writeback assertion: MERGE-mode run ${runId} left paired reads without checksum2`,
      JSON.stringify(
        missingPairedChecksum.map((read) => ({
          id: read.id,
          sampleId: read.sampleId,
          file2: read.file2,
          checksum2: read.checksum2 ?? null,
        })),
        null,
        2,
      ),
    );
  }
  const wronglyAttributed = populated.filter(
    (read) => parsePipelineSources(read.pipelineSources)["fastq-checksum"] !== runId,
  );
  if (wronglyAttributed.length > 0) {
    fail(
      `Writeback assertion: MERGE-mode checksums were not attributed to run ${runId}`,
      JSON.stringify(
        wronglyAttributed.map((read) => ({
          id: read.id,
          sampleId: read.sampleId,
          pipelineSources: read.pipelineSources ?? null,
        })),
        null,
        2,
      ),
    );
  }
  return {
    mode: "merge",
    readsWithFile1: reads.length,
    readsWithChecksum: populated.length,
  };
}

async function assertStudyOutputRetrievable({ client, run, runId, pipelineId }) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const artifact = artifacts.find((candidate) => candidate?.path);
  if (!artifact) {
    fail(
      `Study-scoped ${pipelineId} run ${runId} persisted no materialized artifact`,
      JSON.stringify({ artifactCount: artifacts.length }, null, 2),
    );
  }
  const response = await client.request(
    `/api/pipelines/runs/${runId}/file?path=${encodeURIComponent(artifact.path)}&download=1`,
  );
  if (!response.ok) {
    fail(
      `Study-scoped ${pipelineId} artifact is not retrievable (${response.status})`,
      summarizeBody(await response.text()),
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    fail(`Study-scoped ${pipelineId} artifact is empty`, artifact.path);
  }
  return {
    artifactCount: artifacts.length,
    checkedPath: artifact.path,
    checkedBytes: bytes.length,
  };
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

  for (const command of ["sbatch", "squeue", "sacct", "scontrol"]) {
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
  const launchIdentity = assertSlurmLaunchIdentity({
    runId,
    jobId,
    run: result.run,
    startPayload,
  });
  const files = await assertSlurmRunFiles({
    run: result.run,
    pipelineId,
  });
  const accounting = await assertSuccessfulSlurmAccounting({
    runId,
    jobId,
    runFolder: launchIdentity.runFolder,
  });
  const slurmCompletion = await assertSlurmCompletionProof({
    runId,
    jobId,
    runFolder: launchIdentity.runFolder,
    accounting,
  });
  const logs = await assertSlurmLogs(result.run, jobId);

  // DB-writeback assertion for the order-scoped reads pipelines. simulate-reads is
  // REPLACE mode (new active read with checksums/readCount); fastq-checksum is
  // MERGE mode (checksums written in place). Study-scoped runs (full MAG/metax)
  // have no orderId and write no order reads, so skip the assertion there.
  let writeback;
  let studyOutput;
  if (orderId) {
    writeback = await assertReplaceWriteback({ client, runId, orderId, pipelineId });
  } else {
    studyOutput = await assertStudyOutputRetrievable({
      client,
      run: result.run,
      runId,
      pipelineId,
    });
  }

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
    files,
    accounting,
    slurmCompletion,
    slurmLogs: logs,
    ...(writeback ? { writeback } : {}),
    ...(studyOutput ? { studyOutput } : {}),
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
