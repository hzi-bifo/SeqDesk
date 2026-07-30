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
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assertSlurmCompletionAttestation,
  assertExactNextflowRunTarget,
  assertExactActiveRunAttributedReadCoverage,
  assertChecksumVerificationCoverage,
  assertExactSampleCoverage,
  assertFastqChecksumSummaryRows,
  assertFastqcArtifactCoverage,
  assertFastqcHtmlInputFilename,
  assertFastqcReportWritebackCoverage,
  assertFastqcSummaryRows,
  assertMultiqcFastqcCoverage,
  assertMultiqcNanoplotMetrics,
  assertNanoplotNanoStatsGroundTruth,
  assertNanoplotSummaryRows,
  assertPipelineExitMarker,
  assertReadsQcSummaryRows,
  assertReadsQcSampleArtifactRows,
  assertRequiredRelativeOutput,
  assertRunIdentity,
  assertRuntimeProofContracts,
  assertSampleBoundQcArtifactCoverage,
  assertSimulateReadsSummaryRows,
  assertStudyDemoSummaryRows,
  assertSlurmAccountingRecord,
  assertSlurmLaunchIdentity,
  createUniqueProofRecord,
  deriveMultiqcExpectedSamplesFromSourceInputs,
  normalizeSlurmState,
  parseNanoplotNanoStatsTsv,
  parsePrimarySacctRecord,
  pathIsWithin,
  pathsReferToSameLocation,
  resolveLocalManifestPipelineTarget,
  slurmCompletionAttestationPath,
} from "./lib/pipeline-e2e-proof.mjs";
import {
  computeFastqGroundTruth,
  parseFastqcDataGroundTruth,
} from "./lib/fastq-ground-truth.mjs";
import {
  buildRuntimeRunCreateBody,
  resolveRuntimeRunConfig,
} from "./lib/pipeline-e2e-config.mjs";
import { syncPipelineRunFailClosed } from "./lib/pipeline-e2e-sync.mjs";

const execFileAsync = promisify(execFile);
const DUMMY_ORDER_PREFIX = "SEED-DUMMY-";
const PROFILE_SMOKE_ORDER_NUMBERS = new Set([
  "TWINCORE-SMOKE-001",
  "CI-RUNNER-SMOKE-001",
]);

// Pipelines whose manifest targets.supported is ['study'] (not 'order'). The run is
// created with a studyId instead of an orderId, and reads/samples come from the study.
const STUDY_SCOPED_PIPELINES = new Set([
  "reads-qc",
  "study-demo-report",
  "multiqc",
  "metaxpath",
]);

// Dummy order 3 is the bundled ONT single-end fixture; order 4 is the paired
// short-read fixture. Both are linked to the dedicated "pipeline CI" study so
// MultiQC can aggregate FastQC across every sample and NanoPlot for the
// long-read subset. Selecting them explicitly prevents a compatibility test
// from accidentally running on whichever dummy order happened to sort first.
const PIPELINE_DUMMY_ORDER_INDEX = {
  fastqc: 4,
  nanoplot: 3,
};

// Per-pipeline DB-writeback expectations, asserted after a run completes. 'checksum'
// verifies md5 checksums merged onto the order's reads; 'artifacts' verifies the
// expected PipelineArtifact rows (by outputId) were persisted. Add entries as more
// pipelines gain coverage.
const WRITEBACK_SPEC = createUniqueProofRecord([
  ["fastq-checksum", { kind: "checksum" }],
  ["simulate-reads", { kind: "replace" }],
  [
    "study-demo-report",
    {
      kind: "artifacts",
      requiredOutputIds: ["html_report", "markdown_report", "sample_summary"],
    },
  ],
  // Artifacts + read-field writeback. The run GET select now exposes readCount1/2 +
  // avgQuality1/2 (pipeline-run-ops-service.ts), so on top of the per-sample QC artifacts
  // we assert fastqc's in-place Read merge actually landed in the DB
  // (assertReadFieldWriteback) — not just that the artifact rows exist. The
  // finalizer now waits for all required manifest outputs, including the late
  // summary, before recording completion.
  [
    "fastqc",
    {
      kind: "artifacts",
      requiredOutputIds: ["sample_qc_reports", "sample_qc_data", "summary"],
    },
  ],
  // reads-qc merges readCount/avgQuality fields into active Read rows. The run GET
  // exposes both those fields and pipelineSources, so every mode must prove that
  // this exact run (not a preceding local/SLURM run) performed the merge.
  [
    "reads-qc",
    {
      kind: "artifacts",
      requiredOutputIds: ["sample_stats", "summary_tsv", "summary_report"],
    },
  ],
  [
    "nanoplot",
    {
      kind: "artifacts",
      requiredOutputIds: ["sample_report", "sample_stats", "summary_tsv"],
    },
  ],
  [
    "multiqc",
    {
      kind: "artifacts",
      requiredOutputIds: ["multiqc_report", "multiqc_data"],
    },
  ],
  // read-cleaning writes PendingReadCandidate rows exposed through a separate
  // admin-review endpoint.
  ["read-cleaning", { kind: "completes" }],
  // metaxpath is a private, STUDY-scoped add-on (installed via the ci-runner profile, not in
  // this repo's pipelines/; the app rejects order targets). Hard `completes` gate. On top of it
  // assertMetaxpathTaxonomy proves it actually CLASSIFIED by fetching the combined
  // report and requiring a populated table (+ the expected taxon when
  // SEQDESK_METAXPATH_EXPECT_TAXON is set).
  ["metaxpath", { kind: "completes" }],
  // mag (nf-core/mag, short-read paired-end) on a tiny public example dataset. `completes` is a
  // genuine assembly proof for mag: the app holds a mag run in `running` until materialized
  // outputs exist (countMaterializedOutputs > 0 in pipeline-run-ops-service), so reaching
  // `completed` means an assembly was generated AND saved to the DB. Run lightweight (MEGAHIT only,
  // skip binning-QC/GTDB) so it fits the CI runner. assertMagAssembly additionally surfaces the
  // assembly count from the run results.
  ["mag", { kind: "completes" }],
], "Runtime writeback proof");

// CONFIG -> OUTPUT plumbing marker for study-demo-report: a unique report_title we
// pass as user config; it must reappear verbatim in the rendered HTML + Markdown,
// proving user config flows app -> nextflow.config -> SLURM job -> output (nothing
// else asserts this today). Lowercase + hyphenated so it survives shell-quoting and
// the case-insensitive content match below.
const STUDY_DEMO_REPORT_TITLE = "e2e-config-plumb-report-4q7x";
const MULTIQC_REPORT_TITLE = "e2e-multiqc-aggregation-report-8v2k";

// Output CORRECTNESS (not just "an artifact row exists"): for artifact pipelines,
// download a required output through the app's file endpoint and assert its content
// is the real thing — a marker string the pipeline itself writes. Markers are loose
// and stable (a heading the report always emits, a TSV header column), grounded in
// each pipeline's workflow/main.nf. Keyed by pipelineId -> outputId -> markers.
const ARTIFACT_CONTENT_MARKERS = createUniqueProofRecord([
  [
    "study-demo-report",
    {
      // <h1> proves a real report; the custom title proves config plumbed through.
      html_report: {
        markers: ["<h1", STUDY_DEMO_REPORT_TITLE],
        label: "demo report HTML (custom title plumbed through)",
      },
      markdown_report: {
        markers: [STUDY_DEMO_REPORT_TITLE],
        label: "demo report Markdown (custom title)",
      },
      sample_summary: {
        markers: ["sample_id"],
        label: "sample-summary TSV header",
      },
    },
  ],
  [
    "fastqc",
    {
      sample_qc_reports: {
        markers: ["fastqc"],
        label: "FastQC HTML report",
      },
    },
  ],
  [
    "nanoplot",
    {
      sample_report: {
        markers: ["nanoplot"],
        label: "NanoPlot HTML report",
      },
      sample_stats: {
        markers: ["number_of_reads", "mean_qual"],
        label: "NanoStats metrics",
      },
      summary_tsv: {
        markers: ["sample_id", "num_reads", "mean_quality"],
        label: "NanoPlot summary TSV",
      },
    },
  ],
  [
    "reads-qc",
    {
      sample_stats: {
        markers: ["sample_id", "num_reads", "avg_quality"],
        label: "reads-QC per-sample metrics",
      },
      summary_tsv: {
        markers: ["sample_id", "num_reads", "avg_quality"],
        label: "reads-QC summary TSV",
      },
      summary_report: {
        markers: ["reads qc report", "total reads", "mean quality"],
        label: "reads-QC HTML report",
      },
    },
  ],
  [
    "multiqc",
    {
      multiqc_report: {
        markers: ["multiqc", "fastqc", MULTIQC_REPORT_TITLE],
        label: "aggregated MultiQC report",
      },
    },
  ],
], "Runtime artifact content-marker proof");

assertRuntimeProofContracts({
  writebackSpec: WRITEBACK_SPEC,
  artifactContentMarkers: ARTIFACT_CONTENT_MARKERS,
});

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
    if (["skip-local", "skip-slurm", "include-default-policy", "ensure-dummy-data", "skip-if-disabled", "saved-config-only"].includes(key)) {
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

function writeRunState(filePath, state) {
  if (!filePath) return;
  const parent = path.dirname(filePath);
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

function createClient(baseUrl, requestTimeoutMs = 120_000) {
  const jar = new CookieJar();
  async function request(pathname, init = {}) {
    const headers = new Headers(init.headers || {});
    const cookieHeader = jar.headerValue();
    if (cookieHeader) headers.set("cookie", cookieHeader);

    const response = await fetch(new URL(pathname, baseUrl), {
      ...init,
      headers,
      redirect: init.redirect || "manual",
      signal: init.signal || AbortSignal.timeout(requestTimeoutMs),
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

function selectRuntimeOrder(orders, dummyOrderPrefix, preferredDummyOrderIndex) {
  if (dummyOrderPrefix && preferredDummyOrderIndex) {
    const preferredOrderNumber =
      `${dummyOrderPrefix}${String(preferredDummyOrderIndex).padStart(3, "0")}`;
    const preferred = orders.find(
      (order) => String(order?.orderNumber || "") === preferredOrderNumber,
    );
    if (preferred) return preferred;
  }
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

async function findOrder(
  client,
  { ensureSeededDummyData, dummyOrderPrefix, preferredDummyOrderIndex },
) {
  let orders = await fetchOrders(client);
  let selected = selectRuntimeOrder(
    orders,
    dummyOrderPrefix,
    preferredDummyOrderIndex,
  );
  const hasDummyOrder = orders.some((order) =>
    dummyOrderPrefix ? isSessionDummyOrder(order, dummyOrderPrefix) : isDummyOrder(order),
  );

  if (!hasDummyOrder) {
    const dummyStatus = await getDummyDataStatus(client);
    if (dummyStatus.ok && dummyStatus.seeded) {
      orders = await fetchOrders(client);
      selected = selectRuntimeOrder(
        orders,
        dummyOrderPrefix,
        preferredDummyOrderIndex,
      );
    } else if (ensureSeededDummyData) {
      await ensureDummyData(client);
      orders = await fetchOrders(client);
      selected = selectRuntimeOrder(
        orders,
        dummyOrderPrefix,
        preferredDummyOrderIndex,
      );
    }
  }

  if (dummyOrderPrefix && preferredDummyOrderIndex) {
    const requiredOrderNumber =
      `${dummyOrderPrefix}${String(preferredDummyOrderIndex).padStart(3, "0")}`;
    if (String(selected?.orderNumber || "") !== requiredOrderNumber) {
      fail(
        `The runtime E2E requires compatible dummy order ${requiredOrderNumber}, but it was not available. ` +
          `Recreate the admin dummy data or pass --order-id/--order-number explicitly.`,
      );
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
  if (pipelineId === "study-demo-report") {
    // Non-default report_title so the run exercises config->output plumbing; the
    // value is asserted back in the rendered artifacts (ARTIFACT_CONTENT_MARKERS).
    return { report_title: STUDY_DEMO_REPORT_TITLE };
  }
  if (pipelineId === "multiqc") {
    return { reportTitle: MULTIQC_REPORT_TITLE };
  }
  return {};
}

function effectiveSimulateReadsConfig(run) {
  const persistedConfig =
    run?.config && typeof run.config === "object" && !Array.isArray(run.config)
      ? run.config
      : {};
  return {
    qualityProfile: "standard",
    insertMean: 350,
    insertStdDev: 30,
    seed: null,
    ...defaultConfigForPipeline("simulate-reads"),
    ...persistedConfig,
  };
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
  const payload = await syncPipelineRunFailClosed(client, runId, {
    context: `Sync pipeline run ${runId}`,
  });
  if (
    typeof payload?.status !== "string" ||
    payload.status.trim().length === 0
  ) {
    fail(
      `Sync pipeline run ${runId} returned no status`,
      JSON.stringify(payload, null, 2),
    );
  }
  return payload;
}

async function pollUntilDone({ client, baseUrl, runId, startPayload, timeoutSeconds, label }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let latestRun = null;
  let latestQueue = null;

  while (Date.now() < deadline) {
    // Reconcile FIRST, then read — so the observed status reflects the reconciled state, not a
    // transient pre-reconciliation value. A local run can be briefly marked 'completed' and then
    // demoted back to 'running' by the monitor (a single early process reads as 100% while the
    // workflow is still building its conda envs); reading BEFORE syncing caught that transient
    // 'completed' as terminal while the very same poll demoted it, so the writeback assertion
    // then saw 'running'. Syncing first makes the poll wait for genuine completion.
    await syncRun(client, runId);
    const runPayload = await requestJson(
      client,
      `/api/pipelines/runs/${runId}`,
      {},
      "Fetch pipeline run",
    );
    latestRun = runPayload?.run || runPayload;
    latestQueue = await fetchQueueStatus(client, runId);

    if (latestRun?.status === "completed") {
      // Confirm it is GENUINELY completed, not a transient the monitor will demote. A local run
      // can be briefly marked completed (a single early process reads as 100%) and then demoted
      // back to running on the next reconcile. Re-sync and re-read: a real completion (exit marker
      // present) stays completed; a transient flips back to running, so we keep waiting instead of
      // failing the writeback assertion on the demoted status.
      await syncRun(client, runId);
      const confirmPayload = await requestJson(
        client,
        `/api/pipelines/runs/${runId}`,
        {},
        "Confirm pipeline completion",
      );
      const confirmRun = confirmPayload?.run || confirmPayload;
      if (confirmRun?.status === "completed") {
        return { run: confirmRun, queue: latestQueue };
      }
      latestRun = confirmRun; // demoted -> still running; keep polling
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
  if (run?.executionMode !== "local") {
    fail("Local PipelineRun did not persist executionMode=local", JSON.stringify({
      runId: run?.id,
      executionMode: run?.executionMode ?? null,
    }, null, 2));
  }
  const expectedQueueJobId = `local-${startPayload.pid}`;
  if (String(run.queueJobId || "") !== expectedQueueJobId) {
    fail("Local PipelineRun queueJobId does not match the process returned by start", JSON.stringify({
      runId: run.id,
      expectedQueueJobId,
      queueJobId: run.queueJobId,
    }, null, 2));
  }
}

function assertSlurmRunShape(run, startPayload) {
  const jobId = startPayload.jobId || run.queueJobId;
  const identity = assertSlurmLaunchIdentity({
    runId: run?.id,
    jobId,
    run,
    startPayload,
  });
  return identity.jobId;
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

async function assertSlurmAccounting({ runId, jobId, runFolder }) {
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
          jobId,
          "--noheader",
          "--format=JobIDRaw,JobName%128,State,ExitCode,WorkDir%1024,NodeList",
        ],
        { timeout: 10_000, maxBuffer: 1024 * 1024 },
      ));
      lastError = null;
    } catch (error) {
      // Accounting can lag the job's output marker briefly. Preserve the last
      // error and retry; a missing/failed accounting query is a hard failure at
      // the deadline rather than a warning.
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(2000);
      continue;
    }

    latest = parsePrimarySacctRecord(stdout, jobId);

    if (latest) {
      const state = normalizeSlurmState(latest.state);
      if (state === "COMPLETED") {
        return assertSlurmAccountingRecord(latest, {
          runId,
          jobId,
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
    }
    await sleep(2000);
  }

  fail(
    `SLURM accounting did not prove completed allocation ${jobId} within 90 seconds`,
    JSON.stringify({ latest, lastError, expectedRunFolder: runFolder }, null, 2),
  );
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
  const attestation = assertSlurmCompletionAttestation({
    contents: fs.readFileSync(attestationPath, "utf8"),
    runId,
    jobId,
    nodeHosts,
    context: `SLURM completion attestation for run ${runId}`,
  });
  const captureLogs = await waitForRequiredRegularFiles(
    slurmLogPaths(runFolder, jobId),
    `SLURM capture logs for run ${runId}`,
  );
  return {
    path: attestationPath,
    ...attestation,
    captureLogs,
  };
}

async function assertRunFiles({
  mode,
  run,
  jobId,
  pipelineId,
  requiredOutputExpectation,
  expectedPipelineRoot,
}) {
  const runFolder = run?.runFolder;
  if (!runFolder) fail(`${mode} run did not report a runFolder`, JSON.stringify(run, null, 2));

  const runScript = await maybeReadFile(`${runFolder}/run.sh`);
  if (!runScript) fail(`${mode} run did not create run.sh`, runFolder);
  let pipelineTarget = null;
  if (expectedPipelineRoot) {
    const manifestTarget = resolveLocalManifestPipelineTarget({
      pipelinesRoot: expectedPipelineRoot,
      pipelineId,
      context: `${mode} ${pipelineId} package target`,
    });
    pipelineTarget = assertExactNextflowRunTarget({
      runScript,
      runFolder,
      expectedTarget: manifestTarget.expectedTarget,
      context: `${mode} ${pipelineId} run ${run?.id ?? "<unknown>"}`,
    });
    pipelineTarget.manifest = manifestTarget;
  }

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
  }

  const pipelineOut = `${runFolder}/logs/pipeline.out`;
  if (!fs.existsSync(pipelineOut)) {
    fail(`${mode} run did not create logs/pipeline.out`, pipelineOut);
  }
  const pipelineOutText = fs.readFileSync(pipelineOut, "utf8");
  const pipelineExitCode = assertPipelineExitMarker(pipelineOutText, {
    expectedOutcome: "success",
    context: `${mode} ${pipelineId} run ${run?.id ?? "<unknown>"}`,
  });
  const requiredOutput = requiredOutputExpectation
    ? assertRequiredRelativeOutput({
        runFolder,
        relativePath: requiredOutputExpectation.relativePath,
        requiredContent: requiredOutputExpectation.requiredContent,
        context: `${mode} ${pipelineId} run ${run?.id ?? "<unknown>"}`,
      })
    : null;

  const summaryPath =
    pipelineId === "simulate-reads"
      ? `${runFolder}/output/summary/simulation-summary.tsv`
      : null;
  if (summaryPath && !fs.existsSync(summaryPath)) {
    fail(`${mode} simulate-reads run did not create simulation summary`, summaryPath);
  }

  const slurmAccounting =
    mode === "slurm"
      ? await assertSlurmAccounting({ runId: run?.id, jobId, runFolder })
      : null;
  const slurmCompletion =
    mode === "slurm"
      ? await assertSlurmCompletionProof({
          runId: run?.id,
          jobId,
          runFolder,
          accounting: slurmAccounting,
        })
      : null;

  return {
    runScript: `${runFolder}/run.sh`,
    nextflowConfig: nextflowConfig ? `${runFolder}/nextflow.config` : null,
    pipelineOut,
    pipelineExitCode,
    ...(pipelineTarget ? { pipelineTarget } : {}),
    summaryPath,
    ...(requiredOutput ? { requiredOutput } : {}),
    ...(slurmAccounting ? { slurmAccounting } : {}),
    ...(slurmCompletion ? { slurmCompletion } : {}),
  };
}

const MD5_HEX = /^[0-9a-f]{32}$/;

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

function assertReadSource({ read, pipelineId, runId }) {
  const sources = parsePipelineSources(read?.pipelineSources);
  if (sources[pipelineId] !== runId) {
    fail(
      `Read writeback attribution: read ${read?.id ?? "<unknown>"} was not written by ${pipelineId} run ${runId}`,
      JSON.stringify(
        {
          runId,
          pipelineId,
          readId: read?.id ?? null,
          pipelineRunId: read?.pipelineRunId ?? null,
          pipelineSources: sources,
        },
        null,
        2,
      ),
    );
  }
  return sources;
}

function md5OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const fastqGroundTruthCache = new Map();

async function computeCachedFastqGroundTruth(filePath, context) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    fail(`${context}: FASTQ input path must be absolute`, String(filePath ?? ""));
  }
  let canonicalPath;
  let before;
  try {
    canonicalPath = await fs.promises.realpath(filePath);
    before = await fs.promises.stat(canonicalPath);
  } catch (error) {
    fail(
      `${context}: FASTQ input is missing or inaccessible (${filePath})`,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!before.isFile() || before.size <= 0) {
    fail(`${context}: FASTQ input is not a non-empty regular file (${canonicalPath})`);
  }
  const fingerprint = `${canonicalPath}\u0000${before.size}\u0000${before.mtimeMs}`;
  let pending = fastqGroundTruthCache.get(fingerprint);
  if (!pending) {
    pending = (async () => {
      const metrics = await computeFastqGroundTruth(canonicalPath);
      const after = await fs.promises.stat(canonicalPath);
      if (
        !after.isFile() ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      ) {
        fail(
          `${context}: FASTQ changed while independent ground truth was being calculated`,
          JSON.stringify(
            {
              canonicalPath,
              before: { size: before.size, mtimeMs: before.mtimeMs },
              after: { size: after.size, mtimeMs: after.mtimeMs },
            },
            null,
            2,
          ),
        );
      }
      return { canonicalPath, size: before.size, mtimeMs: before.mtimeMs, ...metrics };
    })();
    fastqGroundTruthCache.set(fingerprint, pending);
    pending.catch(() => fastqGroundTruthCache.delete(fingerprint));
  }
  return pending;
}

function parseStrictCsv(text, context) {
  if (typeof text !== "string" || text.length === 0) {
    fail(`${context}: CSV is empty`);
  }
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;

  const finishField = () => {
    row.push(field);
    field = "";
    quoteClosed = false;
  };
  const finishRow = () => {
    finishField();
    records.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (quoteClosed && character !== "," && character !== "\r" && character !== "\n") {
      fail(`${context}: invalid character after a closing CSV quote`);
    }
    if (character === '"' && field.length === 0 && !quoteClosed) {
      quoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRow();
    } else if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      finishRow();
    } else if (character === '"') {
      fail(`${context}: quote inside an unquoted CSV field`);
    } else {
      field += character;
    }
  }
  if (quoted) fail(`${context}: unterminated quoted CSV field`);
  if (field.length > 0 || row.length > 0 || quoteClosed) finishRow();
  while (
    records.length > 0 &&
    records[records.length - 1].length === 1 &&
    records[records.length - 1][0] === ""
  ) {
    records.pop();
  }
  if (records.length < 2) fail(`${context}: CSV has no data rows`);
  const [header, ...rows] = records;
  if (new Set(header).size !== header.length || header.some((name) => !name)) {
    fail(`${context}: CSV header contains empty or duplicate columns`);
  }
  for (const [index, columns] of rows.entries()) {
    if (columns.length !== header.length) {
      fail(
        `${context}: CSV row ${index + 2} has ${columns.length} columns, expected ${header.length}`,
      );
    }
  }
  return { header, rows };
}

async function fetchRunSamplesheet({ client, run, runId, context }) {
  if (typeof run?.runFolder !== "string" || !run.runFolder) {
    fail(`${context}: run ${runId} has no runFolder`);
  }
  const samplesheetPath = path.join(run.runFolder, "samplesheet.csv");
  const fetched = await fetchRunFileText({
    client,
    runId,
    filePath: samplesheetPath,
    context,
  });
  return { path: samplesheetPath, ...parseStrictCsv(fetched.text, context) };
}

async function bindExpectedSamplesToRunInputs({
  client,
  run,
  runId,
  expectedSamples,
  r1Column,
  r2Column,
  computeGroundTruth = true,
  context,
}) {
  const samplesheet = await fetchRunSamplesheet({
    client,
    run,
    runId,
    context: `${context} samplesheet`,
  });
  const requiredColumns = ["sample_id", r1Column, ...(r2Column ? [r2Column] : [])];
  const column = new Map();
  for (const name of requiredColumns) {
    const indexes = samplesheet.header.flatMap((value, index) =>
      value === name ? [index] : [],
    );
    if (indexes.length !== 1) {
      fail(`${context}: samplesheet must contain exactly one ${name} column`);
    }
    column.set(name, indexes[0]);
  }
  const expectedBySampleId = new Map(
    expectedSamples.map((sample) => [sample.sampleId, sample]),
  );
  assertExactSampleCoverage({
    expectedSampleIds: Array.from(expectedBySampleId.keys()),
    observedSampleIds: samplesheet.rows.map((row) => row[column.get("sample_id")]),
    context: `${context} samplesheet`,
  });

  const settings = await requestJson(
    client,
    "/api/admin/settings/sequencing-files",
    {},
    `${context}: fetch sequencing-files settings`,
  );
  const dataBasePath =
    typeof settings?.dataBasePath === "string" &&
    path.isAbsolute(settings.dataBasePath)
      ? settings.dataBasePath
      : null;
  if (!dataBasePath) {
    fail(`${context}: sequencing data base path is unavailable or not absolute`);
  }
  const resolveStoredReadPath = (storedPath, identity) => {
    if (typeof storedPath !== "string" || !storedPath) return null;
    const candidate = path.isAbsolute(storedPath)
      ? path.resolve(storedPath)
      : path.resolve(dataBasePath, storedPath);
    if (!pathIsWithin(candidate, dataBasePath)) {
      fail(`${context}: stored input path escapes sequencing storage for ${identity}`);
    }
    try {
      const canonical = fs.realpathSync.native(candidate);
      const stat = fs.statSync(canonical);
      if (!stat.isFile() || stat.size <= 0) {
        fail(`${context}: stored input is not a non-empty regular file for ${identity}`);
      }
      return canonical;
    } catch (error) {
      fail(
        `${context}: could not resolve stored input for ${identity}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const groundTruthByIdentity = new Map();
  const boundSamples = [];
  for (const row of samplesheet.rows) {
    const sampleId = row[column.get("sample_id")];
    const expected = expectedBySampleId.get(sampleId);
    const file1 = row[column.get(r1Column)];
    const file2 = r2Column ? row[column.get(r2Column)] : "";
    if (!expected || !file1 || !path.isAbsolute(file1)) {
      fail(`${context}: samplesheet has an invalid R1 input for ${sampleId}`);
    }
    if (file2 && !path.isAbsolute(file2)) {
      fail(`${context}: samplesheet has a non-absolute R2 input for ${sampleId}`);
    }
    const candidateReads = Array.isArray(expected.activeReads)
      ? expected.activeReads
      : [];
    const matchingReads = candidateReads.filter((read) => {
      const stored1 = resolveStoredReadPath(read?.file1, `${sampleId}/R1`);
      const stored2 = resolveStoredReadPath(read?.file2, `${sampleId}/R2`);
      return (
        stored1 != null &&
        pathsReferToSameLocation(stored1, file1) &&
        Boolean(stored2) === Boolean(file2) &&
        (!file2 || pathsReferToSameLocation(stored2, file2))
      );
    });
    if (matchingReads.length !== 1) {
      fail(
        `${context}: samplesheet input must bind to exactly one active DB Read for ${sampleId}`,
        JSON.stringify(
          {
            sampleId,
            file1,
            file2: file2 || null,
            matchingReadIds: matchingReads.map((read) => read?.id ?? null),
            candidateReadIds: candidateReads.map((read) => read?.id ?? null),
          },
          null,
          2,
        ),
      );
    }
    const selectedRead = matchingReads[0];
    if (computeGroundTruth) {
      const groundTruth1 = await computeCachedFastqGroundTruth(
        file1,
        `${context} ${sampleId}/R1`,
      );
      groundTruthByIdentity.set(`${sampleId}/R1`, {
        ...groundTruth1,
        inputBasename: path.basename(file1),
      });
    }
    if (file2) {
      if (computeGroundTruth) {
        const groundTruth2 = await computeCachedFastqGroundTruth(
          file2,
          `${context} ${sampleId}/R2`,
        );
        groundTruthByIdentity.set(`${sampleId}/R2`, {
          ...groundTruth2,
          inputBasename: path.basename(file2),
        });
      }
    }
    boundSamples.push({
      sampleId: expected.sampleId,
      sampleRecordId: expected.sampleRecordId,
      readRecordId: selectedRead.id,
      activeRead: selectedRead,
      fastqcReport1: selectedRead.fastqcReport1,
      fastqcReport2: selectedRead.fastqcReport2,
      readMetrics: {
        readCount1: selectedRead.readCount1,
        avgQuality1: selectedRead.avgQuality1,
        readCount2: selectedRead.readCount2,
        avgQuality2: selectedRead.avgQuality2,
      },
      file1,
      file2: file2 || null,
      pairedEnd: Boolean(file2),
    });
  }
  return {
    expectedSamples: boundSamples,
    groundTruthByIdentity,
    samplesheetPath: samplesheet.path,
  };
}

async function groundTruthForPersistedReads({
  client,
  expectedReads,
  context,
}) {
  const settings = await requestJson(
    client,
    "/api/admin/settings/sequencing-files",
    {},
    `${context}: fetch sequencing-files settings`,
  );
  const dataBasePath =
    typeof settings?.dataBasePath === "string" &&
    path.isAbsolute(settings.dataBasePath)
      ? settings.dataBasePath
      : null;
  if (!dataBasePath) {
    fail(`${context}: sequencing data base path is unavailable or not absolute`);
  }
  const groundTruthByIdentity = new Map();
  for (const read of expectedReads) {
    for (const [mate, field] of [
      ["R1", "file1"],
      ["R2", "file2"],
    ]) {
      const storedPath = read?.[field];
      if (!storedPath) continue;
      const candidate = path.resolve(dataBasePath, storedPath);
      if (!pathIsWithin(candidate, dataBasePath)) {
        fail(
          `${context}: persisted ${field} escapes sequencing storage for ${read.sampleId}`,
          String(storedPath),
        );
      }
      groundTruthByIdentity.set(
        `${read.sampleId}/${mate}`,
        await computeCachedFastqGroundTruth(
          candidate,
          `${context} ${read.sampleId}/${mate}`,
        ),
      );
    }
  }
  return groundTruthByIdentity;
}

async function resolveRegularNonSymlinkFile({
  storedPath,
  root,
  context,
}) {
  const candidate = path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(root, storedPath);
  const stat = await fs.promises.lstat(candidate).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0) {
    fail(`${context}: expected a non-empty regular non-symlink file`, candidate);
  }
  const canonical = await fs.promises.realpath(candidate);
  if (!pathIsWithin(canonical, root)) {
    fail(`${context}: file escapes its owning run folder`, canonical);
  }
  return { path: canonical, size: stat.size };
}

async function extractFastqcDataFromZip({ zipPath, root, context }) {
  const resolved = await resolveRegularNonSymlinkFile({
    storedPath: zipPath,
    root,
    context,
  });
  let listing;
  try {
    listing = await execFileAsync("unzip", ["-Z1", resolved.path], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch (error) {
    fail(
      `${context}: could not list FastQC ZIP`,
      error instanceof Error ? error.message : String(error),
    );
  }
  const members = String(listing.stdout)
    .split(/\r?\n/)
    .filter((member) => /(^|\/)fastqc_data\.txt$/.test(member));
  if (members.length !== 1) {
    fail(
      `${context}: FastQC ZIP must contain exactly one fastqc_data.txt member`,
      JSON.stringify({ zipPath: resolved.path, members }, null, 2),
    );
  }
  let extracted;
  try {
    extracted = await execFileAsync("unzip", ["-p", resolved.path, members[0]], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch (error) {
    fail(
      `${context}: could not read fastqc_data.txt`,
      error instanceof Error ? error.message : String(error),
    );
  }
  return {
    zipPath: resolved.path,
    zipSize: resolved.size,
    ...parseFastqcDataGroundTruth(String(extracted.stdout)),
  };
}

async function addFastqcZipGroundTruth({
  run,
  expectedSamples,
  groundTruthByIdentity,
  context,
}) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const enriched = new Map(groundTruthByIdentity);
  for (const sample of expectedSamples) {
    for (const mate of sample.pairedEnd ? ["R1", "R2"] : ["R1"]) {
      const identity = `${sample.sampleId}/${mate}`;
      const expectedBasename = `${sample.sampleId}_${mate}_fastqc.zip`;
      const matches = artifacts.filter(
        (artifact) =>
          artifact?.outputId === "sample_qc_data" &&
          path.basename(String(artifact?.path || "")) === expectedBasename,
      );
      if (
        matches.length !== 1 ||
        matches[0]?.sampleId !== sample.sampleRecordId
      ) {
        fail(
          `${context}: expected exactly one sample-bound FastQC ZIP for ${identity}`,
          JSON.stringify({ expectedBasename, matches }, null, 2),
        );
      }
      const fastqcData = await extractFastqcDataFromZip({
        zipPath: matches[0].path,
        root: run.runFolder,
        context: `${context} ${identity}`,
      });
      enriched.set(identity, {
        ...enriched.get(identity),
        fastqcData,
      });
    }
  }
  return enriched;
}

// fastq-checksum runs in MERGE mode: on completion it writes checksum1 = md5(file1)
// and checksum2 = md5(file2) IN PLACE onto each target sample's existing active Read
// (no new Read, no pipelineRunId). discover-outputs SKIPS samples whose FASTQ is
// missing, so we only assert over reads that actually have a file path.
async function assertPipelineWriteback({
  client,
  baseUrl,
  runId,
  pipelineId,
  targetType,
  orderId,
  studyId,
  requiredArtifactOutputIds,
  requiredOutputExpectation,
}) {
  const builtInSpec = WRITEBACK_SPEC[pipelineId];
  const externalArtifactSpec =
    !builtInSpec && requiredArtifactOutputIds.length > 0
      ? { kind: "artifacts", requiredOutputIds: requiredArtifactOutputIds }
      : null;
  const spec = builtInSpec || externalArtifactSpec;

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
  assertRunIdentity({
    run,
    pipelineId,
    targetType,
    orderId,
    studyId,
    context: `Writeback refetch for run ${runId}`,
  });

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

  if (!spec) {
    fail(
      `No app-writeback contract is defined for pipeline '${pipelineId}'. ` +
        `Add it to WRITEBACK_SPEC or pass --required-artifact-output-id.`,
    );
  }

  let writeback;
  if (spec.kind === "checksum") {
    writeback = await assertChecksumReads({ run, runId, client, baseUrl });
  } else if (spec.kind === "replace") {
    writeback = await assertReplaceReads({ client, run, runId, baseUrl });
    if (pipelineId === "simulate-reads") {
      writeback = { ...writeback, configOutput: await assertSimulateConfigOutput({ client, run, runId }) };
    }
  } else if (spec.kind === "artifacts") {
    writeback = assertArtifactWriteback({ run, runId, baseUrl, spec });
    const content = await assertArtifactContent({ client, run, runId, pipelineId });
    writeback = { ...writeback, content };
    if (externalArtifactSpec && requiredOutputExpectation?.requiredContent) {
      const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
      const requiredArtifact = artifacts.find(
        (artifact) =>
          externalArtifactSpec.requiredOutputIds.includes(artifact?.outputId) &&
          artifact?.path,
      );
      if (!requiredArtifact) {
        fail(
          `External artifact content: no required artifact path was exposed for ${pipelineId} run ${runId}`,
        );
      }
      const fetched = await fetchRunFileText({
        client,
        runId,
        filePath: requiredArtifact.path,
        context: `External artifact content (${requiredArtifact.outputId})`,
      });
      if (
        fetched.bytes === 0 ||
        !fetched.text.includes(requiredOutputExpectation.requiredContent)
      ) {
        fail(
          `External artifact content: ${requiredArtifact.outputId} did not contain the required marker`,
          JSON.stringify(
            {
              runId,
              path: requiredArtifact.path,
              bytes: fetched.bytes,
              requiredContent: requiredOutputExpectation.requiredContent,
            },
            null,
            2,
          ),
        );
      }
      writeback.externalContent = {
        outputId: requiredArtifact.outputId,
        path: requiredArtifact.path,
        bytes: fetched.bytes,
        requiredContent: requiredOutputExpectation.requiredContent,
      };
    }
    if (pipelineId === "study-demo-report") {
      writeback.sampleCoverage = await assertStudyDemoSampleCoverage({
        client,
        run,
        runId,
      });
    }
    if (pipelineId === "fastqc") {
      const { boundSamples, ...summaryMetrics } =
        await assertFastqcSummaryMetrics({ client, run, runId });
      writeback.summaryMetrics = summaryMetrics;
      writeback.readFields = assertReadFieldWriteback({
        runId,
        pipelineId,
        expectedSamples: boundSamples,
      });
    }
    if (pipelineId === "nanoplot") {
      const { boundSamples, ...summaryMetrics } =
        await assertNanoplotSummaryMetrics({
          client,
          run,
          runId,
        });
      writeback.summaryMetrics = summaryMetrics;
      writeback.sampleArtifacts = assertSampleBoundQcArtifactCoverage({
        pipelineId,
        artifacts: run.artifacts,
        expectedSamples: boundSamples,
        context: `NanoPlot sample artifacts for run ${runId}`,
      });
      writeback.readFields = assertReadFieldWriteback({
        runId,
        pipelineId,
        expectedSamples: boundSamples,
      });
    }
    if (pipelineId === "reads-qc") {
      const { boundSamples, ...summaryMetrics } =
        await assertReadsQcSummaryMetrics({
          client,
          run,
          runId,
        });
      writeback.summaryMetrics = summaryMetrics;
      writeback.sampleArtifacts = assertSampleBoundQcArtifactCoverage({
        pipelineId,
        artifacts: run.artifacts,
        expectedSamples: boundSamples,
        context: `reads-QC sample artifacts for run ${runId}`,
      });
      writeback.readFields = assertReadFieldWriteback({
        runId,
        pipelineId,
        expectedSamples: boundSamples,
      });
    }
    if (pipelineId === "multiqc") {
      writeback.aggregation = await assertMultiqcAggregation({
        client,
        run,
        runId,
      });
    }
  } else if (spec.kind === "read-fields") {
    writeback = assertReadFieldWriteback({ run, runId, pipelineId });
  } else if (spec.kind === "completes") {
    // The universal gate above already proved completed/progress=100; observability +
    // retrieval (below the dispatch) prove the outputs/logs are reachable. Nothing more
    // to assert for pipelines whose writeback isn't exposed by the run GET.
    writeback = { kind: "completes", note: "ran to completion; writeback not exposed via run GET" };
  // metaxpath: go beyond `completes` and prove it actually classified. Both the
  // trace and combined taxonomy report are required hard gates.
    if (pipelineId === "metaxpath") {
      writeback.trace = await assertMetaxpathTrace({ client, run, runId });
      writeback.taxonomy = await assertMetaxpathTaxonomy({ client, run, runId });
    }
    // read-cleaning: prove SeqDesk INGESTED detaxizer's cleaned reads as reviewable candidates
    // (the integration), not just that the job exited. The cleaned-reads API is exactly what the
    // admin review UI reads, so a populated summary there is the end-to-end integration proof.
    if (pipelineId === "read-cleaning") {
      writeback.cleanedReads = await assertReadCleaningIntegration({ client, runId });
    }
  } else {
    fail(`Writeback: unknown spec kind '${spec.kind}' for pipeline ${pipelineId}`);
  }

  return { ...writeback, observability, retrieval };
}

// read-cleaning integration proof: detaxizer's cleaned reads must be INGESTED by SeqDesk as
// reviewable candidates — the round-trip pipeline output -> discover-outputs -> PendingReadCandidate
// -> the cleaned-reads API the admin review UI reads. The `completes` gate only proves the job
// exited 0; this proves the SeqDesk side actually took up the result (the "integration works").
async function assertReadCleaningIntegration({ client, runId }) {
  const res = await client.request(`/api/pipelines/runs/${runId}/cleaned-reads`);
  const bodyText = await res.text();
  if (!res.ok) {
    fail(
      `read-cleaning: cleaned-reads API not retrievable for run ${runId} (${res.status})`,
      summarizeBody(bodyText),
    );
  }
  let summary;
  try {
    summary = JSON.parse(bodyText);
  } catch {
    fail(`read-cleaning: cleaned-reads response was not JSON for run ${runId}`, summarizeBody(bodyText));
  }
  const candidates = Array.isArray(summary?.candidates) ? summary.candidates : [];
  if (candidates.length < 1) {
    fail(
      `read-cleaning: detaxizer ran but SeqDesk ingested 0 cleaned-read candidates for run ${runId}`,
      JSON.stringify({ runId, candidates: candidates.length, run: summary?.run }, null, 2),
    );
  }
  console.log(
    `read-cleaning integration OK: ${candidates.length} cleaned-read candidate(s) ingested ` +
      `via the cleaned-reads API (the admin review surface)`,
  );

  // On the SPIKED dataset (DEV-RC-SPIKE-001: 30 human-mt + 30 E. coli reads/sample),
  // go beyond "the integration ran" and prove the contamination was actually REMOVED:
  // count reads in the cleaned candidate FASTQ vs the raw source, on disk. Enabled via
  // SEQDESK_RUNTIME_E2E_RC_SPIKE_CHECK so the non-spiked read-cleaning runs are unaffected.
  let spike = null;
  if (envFlag(process.env.SEQDESK_RUNTIME_E2E_RC_SPIKE_CHECK)) {
    spike = await assertReadCleaningSpikeRemoval({ client, runId, candidates });
  }
  return { checked: true, candidates: candidates.length, ...(spike ? { spike } : {}) };
}

// Count FASTQ records in a (optionally gzipped) file on disk: 4 lines per record.
function countFastqReads(filePath) {
  let buf = fs.readFileSync(filePath);
  if (filePath.endsWith(".gz")) buf = zlib.gunzipSync(buf);
  const lines = buf.toString("utf8").split(/\r?\n/).filter((line) => line.length > 0);
  return Math.floor(lines.length / 4);
}

// Deterministic contamination-removal proof for the spiked dataset. Each sample's RAW
// input has 30 human-mt (host contaminant, expected removed by detaxizer+kraken2) + 30
// E. coli reads (retained). Count the cleaned candidate FASTQ vs the raw source and
// require: host reads were removed (raw > cleaned by a real margin) AND microbial reads
// were retained (cleaned stays positive). Bounds are generous so kraken2 edge calls /
// the staged DB's exact human coverage don't make it brittle, while still proving the
// behavior. If the data dir / files aren't readable here, WARN+skip (the >=1-candidate
// integration check above still held) rather than red the suite on a path issue.
async function assertReadCleaningSpikeRemoval({ client, runId, candidates }) {
  const HUMAN_SPIKE = 30; // expected removed
  const MICROBE_SPIKE = 30; // expected retained
  const MIN_REMOVED = 10; // at least this many host reads must be cut (of 30)
  const MIN_RETAINED = 10; // at least this many microbial reads must survive (of 30)

  let dataBasePath = null;
  try {
    const settings = await requestJson(
      client,
      "/api/admin/settings/sequencing-files",
      {},
      "Fetch sequencing-files settings",
    );
    dataBasePath = typeof settings?.dataBasePath === "string" ? settings.dataBasePath : null;
  } catch {
    /* fall through to warn */
  }
  const resolveOnDisk = (file) => {
    if (typeof file !== "string" || !file) return null;
    const candidatesPaths = [];
    if (path.isAbsolute(file)) candidatesPaths.push(file);
    if (dataBasePath) candidatesPaths.push(path.resolve(dataBasePath, file));
    candidatesPaths.push(path.resolve(file));
    return candidatesPaths.find((p) => fs.existsSync(p)) || null;
  };

  const perSample = [];
  for (const cand of candidates) {
    const cleanedPath = resolveOnDisk(cand?.file1);
    const rawPath = resolveOnDisk(cand?.currentRead?.file1);
    if (!cleanedPath || !rawPath) {
      console.warn(
        `WARN read-cleaning spike: candidate ${cand?.sampleCode} files not readable here ` +
          `(cleaned=${cand?.file1}, raw=${cand?.currentRead?.file1}, base=${dataBasePath ?? "<unknown>"}) — skipping count`,
      );
      continue;
    }
    const raw = countFastqReads(rawPath);
    const cleaned = countFastqReads(cleanedPath);
    const removed = raw - cleaned;
    perSample.push({ sample: cand?.sampleCode, raw, cleaned, removed });

    if (!(cleaned >= MIN_RETAINED)) {
      fail(
        `read-cleaning spike: sample ${cand?.sampleCode} retained only ${cleaned} read(s) after cleaning ` +
          `(expected ≈${MICROBE_SPIKE} microbial; >= ${MIN_RETAINED}) — over-aggressive removal`,
        JSON.stringify({ runId, raw, cleaned, removed }, null, 2),
      );
    }
    if (!(removed >= MIN_REMOVED)) {
      fail(
        `read-cleaning spike: sample ${cand?.sampleCode} removed only ${removed} read(s) ` +
          `(raw=${raw}, cleaned=${cleaned}; expected ≈${HUMAN_SPIKE} human removed, >= ${MIN_REMOVED}) — ` +
          `host contamination was NOT removed (check the kraken2 DB covers human)`,
        JSON.stringify({ runId, raw, cleaned, removed }, null, 2),
      );
    }
  }

  if (perSample.length === 0) {
    console.warn(
      `WARN read-cleaning spike: no candidate FASTQs were readable to count for run ${runId} — ` +
        `count proof skipped (the cleaned-reads integration check still passed)`,
    );
    return { checked: false, reason: "files-unreadable" };
  }
  console.log(
    `read-cleaning spike OK: host contamination removed + microbes retained per sample — ` +
      JSON.stringify(perSample),
  );
  return { checked: true, samples: perSample };
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

// metaxpath proof: a `completes` gate only shows the job exited 0. This proves it actually
// CLASSIFIED — fetch the top-50 taxonomy report through the app and require a populated table
// of taxa (multiple rows, each with a numeric count/abundance), not just a header. Match by
// filename, since metaxpath is a private package and we don't want to depend on its outputIds.
// Tier 2 (the strongest proof): set SEQDESK_METAXPATH_EXPECT_TAXON to a known organism for the
// dataset and we additionally require it to appear in the report — "ran" -> "got the right answer".
async function assertMetaxpathTaxonomy({ client, run, runId }) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const report =
    artifacts.find((a) => /combined_report\.top50\.txt$/i.test(a?.path || "")) ||
    artifacts.find((a) => /combined_report\.top50\.(txt|tsv|csv|html)$/i.test(a?.path || "")) ||
    artifacts.find((a) => /combined_report\./i.test(a?.path || ""));
  if (!report?.path) {
    fail(
      `metaxpath: run ${runId} exposed no required combined_report artifact`,
      JSON.stringify(
        {
          runId,
          artifactPaths: artifacts
            .map((artifact) => artifact?.path)
            .filter(Boolean),
        },
        null,
        2,
      ),
    );
  }
  const res = await client.request(
    `/api/pipelines/runs/${runId}/file?path=${encodeURIComponent(report.path)}&download=1`,
  );
  if (!res.ok) {
    fail(`metaxpath: could not fetch taxonomy report ${report.path} (${res.status})`, summarizeBody(await res.text()));
  }
  const raw = Buffer.from(await res.arrayBuffer()).toString("utf8");
  // Strip tags if we fell back to the HTML report so row/marker checks see text.
  const text = report.path.toLowerCase().endsWith(".html") ? raw.replace(/<[^>]+>/g, " ") : raw;
  const rows = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // A real classification report carries taxa with numeric counts/abundance. Minimal,
  // human-decontaminated test data can collapse to a single dominant taxon, so require at
  // least ONE real classification row — that proves the report isn't empty and metaxpath
  // actually classified. The per-organism proof is the optional SEQDESK_METAXPATH_EXPECT_TAXON
  // check below (set it to the known organism for a stronger gate).
  const taxaRows = rows.filter((l) => /\d/.test(l) && /[A-Za-z]{3,}/.test(l));
  const MIN_TAXA = 1;
  if (taxaRows.length < MIN_TAXA) {
    fail(
      `metaxpath: taxonomy report ${report.path} has only ${taxaRows.length} classification row(s) (expected >= ${MIN_TAXA})`,
      JSON.stringify({ runId, sample: rows.slice(0, 12) }, null, 2),
    );
  }
  const expectTaxon = (process.env.SEQDESK_METAXPATH_EXPECT_TAXON || "").trim();
  let expectedTaxonFound = null;
  if (expectTaxon) {
    expectedTaxonFound = text.toLowerCase().includes(expectTaxon.toLowerCase());
    if (!expectedTaxonFound) {
      fail(
        `metaxpath: expected taxon "${expectTaxon}" not found in ${report.path}`,
        JSON.stringify({ runId, taxaRowsSample: taxaRows.slice(0, 15) }, null, 2),
      );
    }
  }
  console.log(
    `metaxpath taxonomy OK: ${taxaRows.length} taxa in ${report.path.split("/").pop()}` +
      (expectTaxon ? ` (expected taxon "${expectTaxon}" present)` : ""),
  );
  return { report: report.path, taxaRows: taxaRows.length, expectTaxon: expectTaxon || null, expectedTaxonFound };
}

// Pure parser for a Nextflow trace.txt: summarize the work that actually finished.
// Trace columns are tab-separated; SeqDesk's generic-executor uses the default field order
// (task_id, hash, native_id, name, status, exit, ...), so name = col 3, status = col 4 (0-based).
// We treat COMPLETED and CACHED as "done", strip the per-task "(tag)" suffix to get the
// process name, and separate the trivial input-handling processes (INPUT_CHECK, MV_FASTQ)
// from the "meaningful" classification work — so a run that only ingested reads and stopped
// is distinguishable from one that actually classified. Exported shape is asserted on below.
export function summarizeTraceCompleteness(text) {
  const TRIVIAL = new Set(["INPUT_CHECK", "MV_FASTQ"]);
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter(Boolean);
  let completedRowCount = 0;
  const completedProcesses = new Set();
  const meaningfulProcesses = new Set();
  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 5) continue;
    const name = (cols[3] || "").trim();
    const status = (cols[4] || "").trim().toUpperCase();
    if (name === "name" || status === "STATUS") continue; // header row
    if (status !== "COMPLETED" && status !== "CACHED") continue;
    completedRowCount += 1;
    const base = name.replace(/\s*\(.*\)\s*$/, "").trim(); // strip "(sampleTag)"
    if (!base) continue;
    completedProcesses.add(base);
    if (!TRIVIAL.has(base)) meaningfulProcesses.add(base);
  }
  return {
    completedRowCount,
    completedProcesses: Array.from(completedProcesses).sort(),
    meaningfulProcesses: Array.from(meaningfulProcesses).sort(),
  };
}

// metaxpath proof (the other half of "really working"): a `completes` gate + the app fix
// guarantee Nextflow genuinely exited 0, but NOT that it did its classification work. Fetch
// the run's trace.txt through the app and require the trace to show real classification
// processes COMPLETED — not just the trivial INPUT_CHECK + MV_FASTQ that the false-green run
// had. Thresholds sit far below a real Gemma run (~13 processes across 5 samples) and far
// above the false-green (3 rows, 0 meaningful), so this cannot red a genuinely-working run.
// Trace retrieval and parsing are part of this hard integration proof: a green
// result must show actual classification work, not status=completed alone.
async function assertMetaxpathTrace({ client, run, runId }) {
  const MIN_MEANINGFUL = 3; // distinct classification processes beyond INPUT_CHECK/MV_FASTQ
  if (!run?.runFolder) {
    fail(`metaxpath: run ${runId} has no runFolder for trace verification`);
  }
  const tracePath = `${run.runFolder}/trace.txt`;
  const res = await client.request(
    `/api/pipelines/runs/${runId}/file?path=${encodeURIComponent(tracePath)}&download=1`,
  );
  if (!res.ok) {
    fail(
      `metaxpath: trace.txt is not retrievable for run ${runId} (${res.status})`,
      summarizeBody(await res.text()),
    );
  }
  const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
  const summary = summarizeTraceCompleteness(text);
  if (summary.completedRowCount === 0) {
    fail(
      `metaxpath: trace.txt for run ${runId} parsed to 0 completed rows`,
      text.slice(0, 2000),
    );
  }
  if (summary.meaningfulProcesses.length < MIN_MEANINGFUL) {
    // Diagnostic: the run was marked completed with no classification work. Dump the run's
    // debug bundle (status/queueStatus/statusSource/progress/completedAt + event + step rows)
    // and the raw trace so we can pin WHICH finalizer prematurely completed it.
    try {
      const dbg = await client.request(`/api/pipelines/runs/${runId}/debug`);
      if (dbg.ok) {
        const raw = await dbg.text();
        // Try to surface the run's events + steps (which name the finalizer) compactly;
        // fall back to head+tail of the raw bundle if the shape isn't what we expect.
        let printed = false;
        try {
          const b = JSON.parse(raw);
          const run = b.run || b;
          console.warn(
            `metaxpath RUN ${runId}: status=${run.status} statusSource=${run.statusSource} ` +
              `queueStatus=${run.queueStatus} progress=${run.progress} completedAt=${run.completedAt} ` +
              `lastEventAt=${run.lastEventAt} lastWeblogAt=${run.lastWeblogAt} lastTraceAt=${run.lastTraceAt}`,
          );
          const events = b.events || b.run?.events || [];
          if (Array.isArray(events)) {
            console.warn(`metaxpath EVENTS (${events.length}):`);
            for (const e of events.slice(-30)) {
              console.warn(`  ${e.occurredAt || e.createdAt} src=${e.source} type=${e.eventType} status=${e.status} step=${e.stepId || e.processName || ""}`);
            }
          }
          const steps = b.steps || b.run?.steps || [];
          if (Array.isArray(steps)) {
            console.warn(`metaxpath STEPS (${steps.length}): ${steps.map((s) => `${s.stepId}:${s.status}`).join(", ")}`);
          }
          printed = true;
        } catch {
          /* not JSON or unexpected shape */
        }
        if (!printed) {
          console.warn(`metaxpath DEBUG BUNDLE ${runId} (head):\n${raw.slice(0, 4000)}`);
          console.warn(`metaxpath DEBUG BUNDLE ${runId} (tail):\n${raw.slice(-6000)}`);
        }
      } else {
        console.warn(`metaxpath debug bundle fetch failed (${dbg.status})`);
      }
    } catch (err) {
      console.warn(`metaxpath debug bundle error: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.warn(`metaxpath trace.txt raw (first 1500 chars):\n${text.slice(0, 1500)}`);
    fail(
      `metaxpath: trace shows the run finalized as completed but only ran ` +
        `${summary.meaningfulProcesses.length} classification process(es) ` +
        `(expected >= ${MIN_MEANINGFUL}) — it ingested reads but never classified (false completion).`,
      JSON.stringify(
        {
          runId,
          completedRowCount: summary.completedRowCount,
          completedProcesses: summary.completedProcesses,
          meaningfulProcesses: summary.meaningfulProcesses,
        },
        null,
        2,
      ),
    );
  }
  console.log(
    `metaxpath trace OK: ${summary.completedRowCount} completed task(s), ` +
      `${summary.meaningfulProcesses.length} classification process(es) ` +
      `[${summary.meaningfulProcesses.join(", ")}]`,
  );
  return {
    checked: true,
    completedRowCount: summary.completedRowCount,
    meaningfulProcesses: summary.meaningfulProcesses,
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

// Download a run file through the app's file endpoint and return its text + byte count.
// Used by the output-content + config->output assertions.
async function fetchRunFileText({ client, runId, filePath, context }) {
  const fileResponse = await client.request(
    `/api/pipelines/runs/${runId}/file?path=${encodeURIComponent(filePath)}&download=1`,
  );
  if (!fileResponse.ok) {
    const body = await fileResponse.text();
    fail(
      `${context}: file endpoint failed (${fileResponse.status}) for ${filePath}`,
      summarizeBody(body),
    );
  }
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  return { text: bytes.toString("utf8"), bytes: bytes.length };
}

// Non-failing variant: returns null when the file can't be served (used for run-scoped
// summary TSVs, whose PipelineArtifact row can ingest flakily — a miss should warn+skip,
// not red the suite; the metric assertions still hard-fail when the file IS present).
async function tryFetchRunFileText({ client, runId, filePath }) {
  const fileResponse = await client.request(
    `/api/pipelines/runs/${runId}/file?path=${encodeURIComponent(filePath)}&download=1`,
  );
  if (!fileResponse.ok) return null;
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  return { text: bytes.toString("utf8"), bytes: bytes.length };
}

// Parse a TSV string into { header: string[], rows: string[][] } (tab-split, LF/CRLF).
function parseTsv(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  return {
    header: lines[0].split("\t"),
    rows: lines.slice(1).map((line) => line.split("\t")),
  };
}

// Output correctness: download a required artifact through the app's file endpoint and
// assert its bytes contain a marker the pipeline actually writes (proves the file is a
// real report/summary, not just a row pointing at an empty/placeholder file).
async function assertArtifactContent({ client, run, runId, pipelineId }) {
  const markerMap = ARTIFACT_CONTENT_MARKERS[pipelineId];
  if (!markerMap) return { skipped: true };

  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const checked = [];
  for (const [outputId, contentSpec] of Object.entries(markerMap)) {
    const matchingArtifacts = artifacts.filter(
      (artifact) => artifact?.outputId === outputId,
    );
    if (matchingArtifacts.length === 0) {
      fail(
        `Output content: ${pipelineId} run ${runId} has no artifact for outputId '${outputId}'`,
        JSON.stringify({ runId, present: artifacts.map((a) => a?.outputId) }, null, 2),
      );
    }
    for (const artifact of matchingArtifacts) {
      if (typeof artifact?.path !== "string" || !artifact.path) {
        fail(
          `Output content: ${pipelineId} run ${runId} has a pathless artifact for outputId '${outputId}'`,
          JSON.stringify(
            {
              artifactId: artifact?.id ?? null,
              sampleId: artifact?.sampleId ?? null,
            },
            null,
            2,
          ),
        );
      }
      const { text, bytes } = await fetchRunFileText({
        client,
        runId,
        filePath: artifact.path,
        context: `Output content (${outputId})`,
      });
      const haystack = text.toLowerCase();
      const missing = contentSpec.markers.filter(
        (marker) => !haystack.includes(marker.toLowerCase()),
      );
      if (bytes === 0 || missing.length > 0) {
        fail(
          `Output content: ${contentSpec.label} (${outputId}) for run ${runId} is empty or missing marker(s): ${missing.join(", ")}`,
          JSON.stringify({ runId, path: artifact.path, bytes, head: haystack.slice(0, 200) }, null, 2),
        );
      }
      checked.push({
        artifactId: artifact?.id ?? null,
        sampleId: artifact?.sampleId ?? null,
        outputId,
        path: artifact.path,
        bytes,
        markers: contentSpec.markers,
      });
    }
  }
  return { checked };
}

async function assertStudyDemoSampleCoverage({ client, run, runId }) {
  const selectedSamples = selectedTargetSamplesForRun({
    run,
    context: `study-demo-report run ${runId}`,
  });
  const expectedSampleIds = selectedSamples.map((sample) => sample?.sampleId);
  if (expectedSampleIds.length === 0) {
    fail(
      `study-demo-report: run ${runId} exposed no target study samples`,
      JSON.stringify({ targetType: run?.targetType, studyId: run?.study?.id ?? null }, null, 2),
    );
  }

  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const summaries = artifacts.filter(
    (artifact) => artifact?.outputId === "sample_summary",
  );
  if (
    summaries.length !== 1 ||
    typeof summaries[0]?.path !== "string" ||
    !summaries[0].path
  ) {
    fail(
      `study-demo-report: run ${runId} must have exactly one path-bound sample_summary artifact`,
      JSON.stringify({ summaries }, null, 2),
    );
  }
  const summary = summaries[0];
  const samplesheet = await fetchRunSamplesheet({
    client,
    run,
    runId,
    context: `study-demo-report run ${runId} samplesheet`,
  });
  const { text, bytes } = await fetchRunFileText({
    client,
    runId,
    filePath: summary.path,
    context: "study-demo-report sample coverage",
  });
  const parsedSummary = parseTsv(text);
  const proof = assertStudyDemoSummaryRows({
    samplesheetHeader: samplesheet.header,
    samplesheetRows: samplesheet.rows,
    summaryHeader: parsedSummary.header,
    summaryRows: parsedSummary.rows,
    expectedSampleIds,
    studyId: run?.study?.id,
    studyTitle: run?.study?.title,
    context: `study-demo-report run ${runId}`,
  });
  return {
    path: summary.path,
    samplesheetPath: samplesheet.path,
    bytes,
    ...proof,
  };
}

// CONFIG + DB -> OUTPUT (simulate-reads): the summary must describe exactly the
// active replacement Read persisted for every sample, including both mates and
// the effective generation config.
async function assertSimulateConfigOutput({ client, run, runId }) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const summary = artifacts.find((a) => a?.outputId === "summary" && a?.path);
  if (!summary) {
    fail(
      `Config->output: simulate-reads run ${runId} has no required summary artifact`,
      JSON.stringify({ runId, outputIds: artifacts.map((artifact) => artifact?.outputId).filter(Boolean) }, null, 2),
    );
  }
  const fetched = await tryFetchRunFileText({ client, runId, filePath: summary.path });
  if (!fetched) {
    fail(
      `Config->output: simulate-reads summary is not servable (${summary.path})`,
      JSON.stringify({ runId, path: summary.path }, null, 2),
    );
  }
  const { header, rows } = parseTsv(fetched.text);
  const samples = selectedTargetSamplesForRun({
    run,
    context: `simulate-reads summary for run ${runId}`,
  });
  const expectedReads = samples.flatMap((sample) =>
    (Array.isArray(sample?.reads) ? sample.reads : [])
      .filter((read) => read?.pipelineRunId === runId)
      .map((read) => ({ sampleId: sample?.sampleId, ...read })),
  );
  const groundTruthByIdentity = await groundTruthForPersistedReads({
    client,
    expectedReads,
    context: `simulate-reads summary for run ${runId}`,
  });
  const config = effectiveSimulateReadsConfig(run);
  const proof = assertSimulateReadsSummaryRows({
    header,
    rows,
    expectedReads,
    groundTruthByIdentity,
    config,
    context: `simulate-reads summary for run ${runId}`,
  });
  return { path: summary.path, ...proof };
}

// Read-field DB writeback for FastQC/reads-qc. Both pipelines MERGE per-sample
// readCount1/2 + avgQuality1/2 onto active Read rows. Besides validating the
// values, require pipelineSources[pipelineId] to name this exact run so a SLURM
// assertion cannot reuse fields written by a preceding local run.
function assertReadFieldWriteback({
  runId,
  pipelineId,
  expectedSamples,
}) {
  if (!Array.isArray(expectedSamples) || expectedSamples.length === 0) {
    fail(`${pipelineId} read-field writeback: no samplesheet-bound Reads supplied`);
  }
  const readsWithFile1 = expectedSamples.map((sample) => ({
    sampleId: sample.sampleId,
    ...sample.activeRead,
  }));
  if (readsWithFile1.length === 0) {
    fail(
      `${pipelineId} read-field writeback: run ${runId} exposed no active reads with a file1`,
      JSON.stringify(
        { runId, sampleCount: expectedSamples.length },
        null,
        2,
      ),
    );
  }

  // Mean Phred over an entire read set sits well under this; the bound exists to catch a
  // mis-scaled value or a read count landing in the quality field (those run into the
  // thousands), not to police real quality scores.
  const QUAL_PLAUSIBLE_MAX = 100;
  const assertCountAndQuality = (read, countField, qualField, count, qual) => {
    if (!(Number(count) > 0)) {
      fail(
        `${pipelineId} read-field writeback: read ${read.id} (sample ${read.sampleId}) has non-positive ${countField}=${count}`,
        JSON.stringify({ runId, [countField]: count ?? null }, null, 2),
      );
    }
    const numericQuality = Number(qual);
    if (
      !Number.isFinite(numericQuality) ||
      numericQuality < 0 ||
      numericQuality > QUAL_PLAUSIBLE_MAX
    ) {
      fail(
        `${pipelineId} read-field writeback: read ${read.id} (sample ${read.sampleId}) has implausible ${qualField}=${qual} (expected 0 <= q <= ${QUAL_PLAUSIBLE_MAX})`,
        JSON.stringify({ runId, [qualField]: qual ?? null }, null, 2),
      );
    }
  };

  let populated = 0;
  const warnings = [];
  for (const read of readsWithFile1) {
    assertReadSource({ read, pipelineId, runId });
    if (read.readCount1 == null || read.avgQuality1 == null) {
      warnings.push(`read ${read.id} (sample ${read.sampleId}) missing readCount1/avgQuality1 writeback`);
      continue;
    }
    assertCountAndQuality(read, "readCount1", "avgQuality1", read.readCount1, read.avgQuality1);
    if (read.file2 != null) {
      if (read.readCount2 == null || read.avgQuality2 == null) {
        warnings.push(`read ${read.id} (sample ${read.sampleId}) has file2 but missing readCount2/avgQuality2 writeback`);
      } else {
        assertCountAndQuality(read, "readCount2", "avgQuality2", read.readCount2, read.avgQuality2);
      }
    }
    populated += 1;
  }

  if (warnings.length > 0 || populated !== readsWithFile1.length) {
    fail(
      `${pipelineId} read-field writeback incomplete for run ${runId}: ${populated} of ${readsWithFile1.length} reads populated`,
      JSON.stringify({ runId, warnings, readsWithFile1: readsWithFile1.length, populated }, null, 2),
    );
  }

  return { readsAsserted: populated, readsWithFile1: readsWithFile1.length, warnings: 0 };
}

function selectedTargetSamplesForRun({ run, context }) {
  const targetSamples =
    run?.targetType === "order"
      ? run?.order?.samples
      : run?.targetType === "study"
        ? run?.study?.samples
        : run?.order?.samples || run?.study?.samples;
  const allSamples = Array.isArray(targetSamples) ? targetSamples : [];
  const selectedSampleIds =
    Array.isArray(run?.inputSampleIds) && run.inputSampleIds.length > 0
      ? new Set(run.inputSampleIds)
      : null;
  const samples = selectedSampleIds
    ? allSamples.filter((sample) => selectedSampleIds.has(sample?.id))
    : allSamples;

  if (selectedSampleIds && samples.length !== selectedSampleIds.size) {
    fail(
      `${context}: selected sample IDs are missing from the run target`,
      JSON.stringify(
        {
          selectedSampleIds: Array.from(selectedSampleIds),
          targetSampleIds: allSamples.map((sample) => sample?.id ?? null),
        },
        null,
        2,
      ),
    );
  }
  return samples;
}

function expectedFastqcSamplesForRun({
  run,
  context,
  allowSamplesWithoutReads = false,
}) {
  const samples = selectedTargetSamplesForRun({ run, context });
  const expectedSamples = [];
  for (const sample of samples) {
    const reads = Array.isArray(sample?.reads)
      ? sample.reads.filter(
          (read) => typeof read?.file1 === "string" && read.file1.length > 0,
        )
      : [];
    if (reads.length === 0) {
      if (allowSamplesWithoutReads) continue;
      fail(
        `${context}: target sample has no selectable input Read`,
        JSON.stringify(
          {
            sampleId: sample?.sampleId ?? null,
            sampleRecordId: sample?.id ?? null,
            activeReads: reads.map((read) => ({
              id: read?.id ?? null,
              file1: read?.file1 ?? null,
              file2: read?.file2 ?? null,
            })),
          },
          null,
          2,
        ),
      );
    }
    if (
      typeof sample?.id !== "string" ||
      !sample.id ||
      typeof sample?.sampleId !== "string" ||
      !sample.sampleId
    ) {
      fail(`${context}: target sample has invalid identifiers`);
    }
    expectedSamples.push({
      sampleId: sample.sampleId,
      sampleRecordId: sample.id,
      activeReads: reads,
    });
  }
  if (expectedSamples.length === 0) {
    fail(`${context}: run exposed no target samples with selectable Read inputs`);
  }
  return expectedSamples;
}

// fastqc summary-TSV metric correctness: fetch summary/fastqc-summary.tsv (the file is
// required to be ingested as a PipelineArtifact row), prove exact target-sample
// coverage, validate every R1/R2 metric, and cross-check the summary against the Read
// fields written back by this run. The deterministic seeded fixture additionally has
// equal R1/R2 record counts by construction, so make that a hard invariant there
// without imposing it on explicitly selected real datasets.
async function assertFastqcSummaryMetrics({ client, run, runId }) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const summaryPath = artifacts.find((a) => a?.outputId === "summary" && a?.path)?.path;
  if (!summaryPath) {
    fail(
      `fastqc summary metrics: run ${runId} has no required summary artifact`,
      JSON.stringify({ runId, outputIds: artifacts.map((artifact) => artifact?.outputId).filter(Boolean) }, null, 2),
    );
  }

  const fetched = await tryFetchRunFileText({ client, runId, filePath: summaryPath });
  if (!fetched) {
    fail(
      `fastqc summary metrics: required summary is not servable (${summaryPath})`,
      JSON.stringify({ runId, path: summaryPath }, null, 2),
    );
  }
  const { header, rows } = parseTsv(fetched.text);

  const selectedSamples = expectedFastqcSamplesForRun({
    run,
    context: `fastqc summary metrics for run ${runId}`,
  });
  const inputEvidence = await bindExpectedSamplesToRunInputs({
    client,
    run,
    runId,
    expectedSamples: selectedSamples,
    r1Column: "fastq_1",
    r2Column: "fastq_2",
    context: `fastqc summary metrics for run ${runId}`,
  });
  const expectedSamples = inputEvidence.expectedSamples;
  const groundTruthByIdentity = await addFastqcZipGroundTruth({
    run,
    expectedSamples,
    groundTruthByIdentity: inputEvidence.groundTruthByIdentity,
    context: `fastqc run ${runId}`,
  });
  const deterministicDummyFixture =
    run?.targetType === "order" &&
    String(run?.order?.orderNumber || "").startsWith(DUMMY_ORDER_PREFIX);
  const proof = assertFastqcSummaryRows({
    header,
    rows,
    expectedSamples,
    groundTruthByIdentity,
    requireBalancedPairs: deterministicDummyFixture,
    context: `fastqc summary metrics for run ${runId}`,
  });
  const artifactCoverage = assertFastqcArtifactCoverage({
    artifacts,
    expectedSamples,
    context: `fastqc run ${runId}`,
  });
  const reportWriteback = assertFastqcReportWritebackCoverage({
    artifacts,
    expectedSamples,
    context: `fastqc run ${runId}`,
  });
  const htmlInputBindings = [];
  for (const sample of expectedSamples) {
    for (const mate of sample.pairedEnd ? ["R1", "R2"] : ["R1"]) {
      const reportBasename =
        `${sample.sampleId}_${mate}_fastqc.html`;
      const matches = artifacts.filter(
        (artifact) =>
          artifact?.outputId === "sample_qc_reports" &&
          path.basename(String(artifact?.path || "")) ===
            reportBasename,
      );
      if (matches.length !== 1) {
        fail(
          `fastqc run ${runId}: expected exactly one HTML artifact for ${sample.sampleId}/${mate}`,
        );
      }
      const inputPath = mate === "R1" ? sample.file1 : sample.file2;
      const fetchedHtml = await fetchRunFileText({
        client,
        runId,
        filePath: matches[0].path,
        context: `FastQC HTML ${sample.sampleId}/${mate}`,
      });
      htmlInputBindings.push({
        sampleId: sample.sampleId,
        mate,
        ...assertFastqcHtmlInputFilename({
          html: fetchedHtml.text,
          expectedInputBasename: path.basename(inputPath),
          context: `FastQC HTML ${sample.sampleId}/${mate}`,
        }),
      });
    }
  }

  return {
    path: summaryPath,
    samplesheetPath: inputEvidence.samplesheetPath,
    boundSamples: expectedSamples,
    ...proof,
    artifactCoverage,
    reportWriteback,
    htmlInputBindings,
  };
}

async function assertReadsQcSummaryMetrics({ client, run, runId }) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const summaryPath = artifacts.find(
    (artifact) => artifact?.outputId === "summary_tsv" && artifact?.path,
  )?.path;
  if (!summaryPath) {
    fail(
      `reads-qc summary metrics: run ${runId} has no required summary_tsv artifact`,
    );
  }

  const fetched = await fetchRunFileText({
    client,
    runId,
    filePath: summaryPath,
    context: "reads-QC summary metrics",
  });
  const { header, rows } = parseTsv(fetched.text);
  const selectedSamples = expectedFastqcSamplesForRun({
    run,
    context: `reads-QC summary for run ${runId}`,
  });
  const inputEvidence = await bindExpectedSamplesToRunInputs({
    client,
    run,
    runId,
    expectedSamples: selectedSamples,
    r1Column: "fastq_1",
    r2Column: "fastq_2",
    context: `reads-QC summary for run ${runId}`,
  });
  const proof = assertReadsQcSummaryRows({
    header,
    rows,
    expectedSamples: inputEvidence.expectedSamples,
    groundTruthByIdentity: inputEvidence.groundTruthByIdentity,
    context: `reads-QC summary for run ${runId}`,
  });
  const sampleArtifactCoverage = assertSampleBoundQcArtifactCoverage({
    pipelineId: "reads-qc",
    artifacts,
    expectedSamples: inputEvidence.expectedSamples,
    context: `reads-QC sample artifacts for run ${runId}`,
  });
  const samplesByRecordId = new Map(
    inputEvidence.expectedSamples.map((sample) => [
      sample.sampleRecordId,
      sample,
    ]),
  );
  const sampleArtifactContents = [];
  for (const artifact of artifacts.filter(
    (candidate) => candidate?.outputId === "sample_stats",
  )) {
    const expectedSample = samplesByRecordId.get(artifact?.sampleId);
    if (!expectedSample) {
      fail(
        `reads-QC run ${runId}: sample_stats artifact is not bound to a selected sample`,
      );
    }
    const fetchedSampleStats = await fetchRunFileText({
      client,
      runId,
      filePath: artifact.path,
      context: `reads-QC per-sample TSV ${expectedSample.sampleId}`,
    });
    const parsedSampleStats = parseTsv(fetchedSampleStats.text);
    const sampleGroundTruth = new Map();
    for (const mate of expectedSample.pairedEnd ? ["R1", "R2"] : ["R1"]) {
      const identity = `${expectedSample.sampleId}/${mate}`;
      sampleGroundTruth.set(
        identity,
        inputEvidence.groundTruthByIdentity.get(identity),
      );
    }
    sampleArtifactContents.push({
      sampleId: expectedSample.sampleId,
      path: artifact.path,
      ...assertReadsQcSampleArtifactRows({
        ...parsedSampleStats,
        expectedSample,
        groundTruthByIdentity: sampleGroundTruth,
        context: `reads-QC per-sample TSV ${expectedSample.sampleId}`,
      }),
    });
  }

  return {
    path: summaryPath,
    samplesheetPath: inputEvidence.samplesheetPath,
    boundSamples: inputEvidence.expectedSamples,
    ...proof,
    sampleArtifactCoverage,
    sampleArtifactContents,
  };
}

async function assertNanoplotSummaryMetrics({ client, run, runId }) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const summaryPath = artifacts.find(
    (artifact) => artifact?.outputId === "summary_tsv" && artifact?.path,
  )?.path;
  if (!summaryPath) {
    fail(
      `nanoplot summary metrics: run ${runId} has no required summary_tsv artifact`,
    );
  }

  const fetched = await fetchRunFileText({
    client,
    runId,
    filePath: summaryPath,
    context: "NanoPlot summary metrics",
  });
  const { header, rows } = parseTsv(fetched.text);
  const selectedSamples = expectedFastqcSamplesForRun({
    run,
    context: `NanoPlot summary for run ${runId}`,
  });
  const inputEvidence = await bindExpectedSamplesToRunInputs({
    client,
    run,
    runId,
    expectedSamples: selectedSamples.map((sample) => ({
      ...sample,
      pairedEnd: false,
      file2: null,
    })),
    r1Column: "fastq",
    context: `NanoPlot summary for run ${runId}`,
  });
  const proof = assertNanoplotSummaryRows({
    header,
    rows,
    expectedSamples: inputEvidence.expectedSamples,
    groundTruthByIdentity: inputEvidence.groundTruthByIdentity,
    context: `NanoPlot summary for run ${runId}`,
  });
  const sampleArtifactCoverage = assertSampleBoundQcArtifactCoverage({
    pipelineId: "nanoplot",
    artifacts,
    expectedSamples: inputEvidence.expectedSamples,
    context: `NanoPlot sample artifacts for run ${runId}`,
  });
  const samplesByRecordId = new Map(
    inputEvidence.expectedSamples.map((sample) => [
      sample.sampleRecordId,
      sample,
    ]),
  );
  const sampleStatsContents = [];
  for (const artifact of artifacts.filter(
    (candidate) => candidate?.outputId === "sample_stats",
  )) {
    const expectedSample = samplesByRecordId.get(artifact?.sampleId);
    if (!expectedSample) {
      fail(
        `NanoPlot run ${runId}: sample_stats artifact is not bound to a selected sample`,
      );
    }
    const fetchedNanoStats = await fetchRunFileText({
      client,
      runId,
      filePath: artifact.path,
      context: `NanoPlot NanoStats ${expectedSample.sampleId}`,
    });
    const metrics = parseNanoplotNanoStatsTsv({
      text: fetchedNanoStats.text,
      context: `NanoPlot NanoStats ${expectedSample.sampleId}`,
    });
    sampleStatsContents.push({
      path: artifact.path,
      ...assertNanoplotNanoStatsGroundTruth({
        sampleId: expectedSample.sampleId,
        metrics,
        groundTruth: inputEvidence.groundTruthByIdentity.get(
          `${expectedSample.sampleId}/R1`,
        ),
        context: `NanoPlot NanoStats ${expectedSample.sampleId}`,
      }),
    });
  }

  return {
    path: summaryPath,
    samplesheetPath: inputEvidence.samplesheetPath,
    boundSamples: inputEvidence.expectedSamples,
    ...proof,
    sampleArtifactCoverage,
    sampleStatsContents,
  };
}

async function buildMultiqcFastqcGroundTruth({
  client,
  run,
  candidateSamples,
  fastqcInputs,
}) {
  const expectedByArtifactBasename = new Map();
  for (const sample of candidateSamples) {
    for (const mate of ["R1", "R2"]) {
      expectedByArtifactBasename.set(`${sample.sampleId}_${mate}_fastqc.zip`, {
        sample,
        mate,
        identity: `${sample.sampleId}/${mate}`,
      });
    }
  }

  const sourceRunCache = new Map();
  const loadSourceRun = async (sourceRunId) => {
    let pending = sourceRunCache.get(sourceRunId);
    if (!pending) {
      pending = (async () => {
        const payload = await requestJson(
          client,
          `/api/pipelines/runs/${sourceRunId}`,
          {},
          `MultiQC: fetch source FastQC run ${sourceRunId}`,
        );
        const sourceRun = payload?.run || payload;
        if (
          sourceRun?.id !== sourceRunId ||
          sourceRun?.pipelineId !== "fastqc" ||
          sourceRun?.status !== "completed" ||
          sourceRun?.targetType !== "order" ||
          typeof sourceRun?.orderId !== "string" ||
          sourceRun.orderId.length === 0 ||
          sourceRun?.order?.id !== sourceRun.orderId ||
          sourceRun?.studyId !== null ||
          sourceRun?.study !== null
        ) {
          fail(
            `MultiQC: source run ${sourceRunId} is not an exact completed order-scoped FastQC run`,
            JSON.stringify(
              {
                id: sourceRun?.id ?? null,
                pipelineId: sourceRun?.pipelineId ?? null,
                status: sourceRun?.status ?? null,
                targetType: sourceRun?.targetType ?? null,
                orderId: sourceRun?.orderId ?? null,
                relationOrderId: sourceRun?.order?.id ?? null,
                studyId: sourceRun?.studyId ?? null,
              },
              null,
              2,
            ),
          );
        }
        const samplesheet = await fetchRunSamplesheet({
          client,
          run: sourceRun,
          runId: sourceRunId,
          context: `MultiQC source FastQC run ${sourceRunId}`,
        });
        const columns = new Map();
        for (const name of ["sample_id", "fastq_1", "fastq_2"]) {
          const matches = samplesheet.header.flatMap((value, index) =>
            value === name ? [index] : [],
          );
          if (matches.length !== 1) {
            fail(
              `MultiQC: source FastQC samplesheet must contain exactly one ${name} column`,
            );
          }
          columns.set(name, matches[0]);
        }
        const sourceCandidates = expectedFastqcSamplesForRun({
          run: sourceRun,
          context: `MultiQC source FastQC run ${sourceRunId}`,
        });
        const sourceInputEvidence = await bindExpectedSamplesToRunInputs({
          client,
          run: sourceRun,
          runId: sourceRunId,
          expectedSamples: sourceCandidates,
          r1Column: "fastq_1",
          r2Column: "fastq_2",
          context: `MultiQC source FastQC run ${sourceRunId}`,
        });
        return {
          sourceRun,
          samplesheet,
          columns,
          sourceInputEvidence,
        };
      })();
      sourceRunCache.set(sourceRunId, pending);
      pending.catch(() => sourceRunCache.delete(sourceRunId));
    }
    return pending;
  };

  const sequenceCountsByIdentity = new Map();
  const sourceInputSamples = [];
  let provenanceChecked = 0;
  for (const inventoryArtifact of fastqcInputs) {
    const basename = path.basename(String(inventoryArtifact?.stagedPath || ""));
    const expected = expectedByArtifactBasename.get(basename);
    if (!expected) {
      fail(`MultiQC: staged FastQC ZIP is unexpected`, basename);
    }
    const sourceRunId = String(inventoryArtifact?.pipelineRunId || "");
    const {
      sourceRun,
      samplesheet,
      columns,
      sourceInputEvidence,
    } = await loadSourceRun(sourceRunId);
    const sourceArtifacts = (sourceRun.artifacts ?? []).filter(
      (artifact) => artifact?.id === inventoryArtifact?.artifactId,
    );
    if (sourceArtifacts.length !== 1) {
      fail(
        `MultiQC: source artifact ${inventoryArtifact?.artifactId ?? "<missing>"} is not unique in run ${sourceRunId}`,
      );
    }
    const sourceArtifact = sourceArtifacts[0];
    const sourceOrderSamples = Array.isArray(sourceRun?.order?.samples)
      ? sourceRun.order.samples
      : [];
    if (
      sourceArtifact?.outputId !== "sample_qc_data" ||
      sourceArtifact?.sampleId !== expected.sample.sampleRecordId ||
      !sourceOrderSamples.some(
        (sample) => sample?.id === expected.sample.sampleRecordId,
      ) ||
      (Array.isArray(sourceRun?.inputSampleIds) &&
        sourceRun.inputSampleIds.length > 0 &&
        !sourceRun.inputSampleIds.includes(expected.sample.sampleRecordId))
    ) {
      fail(
        `MultiQC: source FastQC artifact is not bound to the expected study sample for ${expected.identity}`,
        JSON.stringify(
          {
            sourceRunId,
            artifactId: sourceArtifact?.id ?? null,
            outputId: sourceArtifact?.outputId ?? null,
            artifactSampleId: sourceArtifact?.sampleId ?? null,
            expectedSampleId: expected.sample.sampleRecordId,
            inputSampleIds: sourceRun?.inputSampleIds ?? null,
          },
          null,
          2,
        ),
      );
    }

    const sourceFile = await resolveRegularNonSymlinkFile({
      storedPath: sourceArtifact.path,
      root: sourceRun.runFolder,
      context: `MultiQC source artifact ${sourceArtifact.id}`,
    });
    const stagedFile = await resolveRegularNonSymlinkFile({
      storedPath: inventoryArtifact.stagedPath,
      root: run.runFolder,
      context: `MultiQC staged artifact ${sourceArtifact.id}`,
    });
    if (
      !pathsReferToSameLocation(sourceFile.path, inventoryArtifact.sourcePath) ||
      path.basename(sourceFile.path) !== basename ||
      sourceFile.size !== inventoryArtifact.size ||
      stagedFile.size !== inventoryArtifact.size ||
      (sourceArtifact.size != null &&
        Number(sourceArtifact.size) !== inventoryArtifact.size)
    ) {
      fail(
        `MultiQC: staged/source artifact metadata does not match for ${expected.identity}`,
        JSON.stringify(
          {
            sourceArtifactPath: sourceArtifact.path,
            inventorySourcePath: inventoryArtifact.sourcePath,
            stagedPath: inventoryArtifact.stagedPath,
            sourceSize: sourceFile.size,
            stagedSize: stagedFile.size,
            inventorySize: inventoryArtifact.size,
            artifactSize: sourceArtifact.size ?? null,
          },
          null,
          2,
        ),
      );
    }
    const [sourceSha256, stagedSha256] = await Promise.all([
      sha256OfFile(sourceFile.path),
      sha256OfFile(stagedFile.path),
    ]);
    if (sourceSha256 !== stagedSha256) {
      fail(
        `MultiQC: staged FastQC ZIP content differs from its source artifact for ${expected.identity}`,
        JSON.stringify({ sourceSha256, stagedSha256 }, null, 2),
      );
    }

    const sourceRows = samplesheet.rows.filter(
      (row) => row[columns.get("sample_id")] === expected.sample.sampleId,
    );
    if (sourceRows.length !== 1) {
      fail(
        `MultiQC: source FastQC samplesheet does not contain exactly one row for ${expected.sample.sampleId}`,
      );
    }
    const inputColumn = expected.mate === "R1" ? "fastq_1" : "fastq_2";
    const sourceInput = sourceRows[0][columns.get(inputColumn)];
    if (!sourceInput) {
      fail(`MultiQC: source FastQC samplesheet has no ${expected.mate} input`);
    }
    const boundSourceSample = sourceInputEvidence.expectedSamples.find(
      (sample) => sample.sampleId === expected.sample.sampleId,
    );
    const boundSourceInput =
      expected.mate === "R1"
        ? boundSourceSample?.file1
        : boundSourceSample?.file2;
    if (
      !boundSourceSample ||
      !boundSourceInput ||
      !pathsReferToSameLocation(boundSourceInput, sourceInput)
    ) {
      fail(
        `MultiQC: source FastQC input is not bound to exactly one active DB Read for ${expected.identity}`,
      );
    }
    sourceInputSamples.push(boundSourceSample);
    const rawGroundTruth =
      sourceInputEvidence.groundTruthByIdentity.get(expected.identity);
    if (!rawGroundTruth) {
      fail(`MultiQC: raw FASTQ ground truth is missing for ${expected.identity}`);
    }
    const fastqcData = await extractFastqcDataFromZip({
      zipPath: stagedFile.path,
      root: run.runFolder,
      context: `MultiQC staged FastQC ZIP ${expected.identity}`,
    });
    if (fastqcData.filename !== path.basename(sourceInput)) {
      fail(
        `MultiQC: FastQC ZIP Filename does not match the source-run input for ${expected.identity}`,
        JSON.stringify(
          {
            sourceInput,
            fastqcFilename: fastqcData.filename,
          },
          null,
          2,
        ),
      );
    }
    if (fastqcData.totalSequences !== rawGroundTruth.readCount) {
      fail(
        `MultiQC: source FastQC Total Sequences does not match raw FASTQ ground truth for ${expected.identity}`,
        JSON.stringify(
          {
            sourceInput,
            fastqcTotalSequences: fastqcData.totalSequences,
            rawReadCount: rawGroundTruth.readCount,
          },
          null,
          2,
        ),
      );
    }
    const previousCount = sequenceCountsByIdentity.get(expected.identity);
    if (
      previousCount !== undefined &&
      previousCount !== rawGroundTruth.readCount
    ) {
      fail(
        `MultiQC: duplicate FastQC ZIPs have conflicting independently extracted sequence counts for ${expected.identity}`,
        JSON.stringify(
          { previousCount, currentCount: rawGroundTruth.readCount },
          null,
          2,
        ),
      );
    }
    sequenceCountsByIdentity.set(
      expected.identity,
      rawGroundTruth.readCount,
    );
    provenanceChecked += 1;
  }
  const expectedSamples = deriveMultiqcExpectedSamplesFromSourceInputs({
    candidateSamples,
    sourceInputSamples,
    context: "MultiQC exact FastQC source inputs",
  });
  return { expectedSamples, sequenceCountsByIdentity, provenanceChecked };
}

async function buildMultiqcNanoplotGroundTruth({
  client,
  run,
  candidateSamples,
  nanoplotInputs,
}) {
  const candidatesByRecordId = new Map(
    candidateSamples.map((sample) => [sample.sampleRecordId, sample]),
  );
  const sourceRunCache = new Map();
  const loadSourceRun = async (sourceRunId) => {
    let pending = sourceRunCache.get(sourceRunId);
    if (!pending) {
      pending = (async () => {
        const payload = await requestJson(
          client,
          `/api/pipelines/runs/${sourceRunId}`,
          {},
          `MultiQC: fetch source NanoPlot run ${sourceRunId}`,
        );
        const sourceRun = payload?.run || payload;
        if (
          sourceRun?.id !== sourceRunId ||
          sourceRun?.pipelineId !== "nanoplot" ||
          sourceRun?.status !== "completed" ||
          sourceRun?.targetType !== "order" ||
          typeof sourceRun?.orderId !== "string" ||
          sourceRun.orderId.length === 0 ||
          sourceRun?.order?.id !== sourceRun.orderId ||
          sourceRun?.studyId !== null ||
          sourceRun?.study !== null ||
          typeof sourceRun?.runFolder !== "string" ||
          sourceRun.runFolder.length === 0
        ) {
          fail(
            `MultiQC: source run ${sourceRunId} is not an exact completed order-scoped NanoPlot run`,
            JSON.stringify(
              {
                id: sourceRun?.id ?? null,
                pipelineId: sourceRun?.pipelineId ?? null,
                status: sourceRun?.status ?? null,
                targetType: sourceRun?.targetType ?? null,
                orderId: sourceRun?.orderId ?? null,
                relationOrderId: sourceRun?.order?.id ?? null,
                studyId: sourceRun?.studyId ?? null,
                runFolder: sourceRun?.runFolder ?? null,
              },
              null,
              2,
            ),
          );
        }
        return sourceRun;
      })();
      sourceRunCache.set(sourceRunId, pending);
      pending.catch(() => sourceRunCache.delete(sourceRunId));
    }
    return pending;
  };

  const expectedStats = [];
  let provenanceChecked = 0;
  for (const inventoryArtifact of nanoplotInputs) {
    const sourceRunId =
      typeof inventoryArtifact?.pipelineRunId === "string"
        ? inventoryArtifact.pipelineRunId.trim()
        : "";
    const artifactId =
      typeof inventoryArtifact?.artifactId === "string"
        ? inventoryArtifact.artifactId.trim()
        : "";
    if (
      !sourceRunId ||
      !artifactId ||
      inventoryArtifact?.pipelineId !== "nanoplot" ||
      inventoryArtifact?.outputId !== "sample_stats" ||
      !Number.isSafeInteger(inventoryArtifact?.size) ||
      inventoryArtifact.size <= 0
    ) {
      fail(
        "MultiQC: staged NanoPlot NanoStats inventory entry is malformed",
        JSON.stringify({ artifact: inventoryArtifact }, null, 2),
      );
    }

    const sourceRun = await loadSourceRun(sourceRunId);
    const sourceArtifacts = (sourceRun.artifacts ?? []).filter(
      (artifact) => artifact?.id === artifactId,
    );
    if (sourceArtifacts.length !== 1) {
      fail(
        `MultiQC: source NanoPlot artifact ${artifactId} is not unique in run ${sourceRunId}`,
      );
    }
    const sourceArtifact = sourceArtifacts[0];
    const expectedSample = candidatesByRecordId.get(sourceArtifact?.sampleId);
    const sourceOrderSamples = Array.isArray(sourceRun?.order?.samples)
      ? sourceRun.order.samples
      : [];
    if (
      sourceArtifact?.outputId !== "sample_stats" ||
      !expectedSample ||
      !sourceOrderSamples.some(
        (sample) => sample?.id === expectedSample.sampleRecordId,
      ) ||
      (Array.isArray(sourceRun?.inputSampleIds) &&
        sourceRun.inputSampleIds.length > 0 &&
        !sourceRun.inputSampleIds.includes(expectedSample.sampleRecordId))
    ) {
      fail(
        "MultiQC: source NanoPlot artifact is not bound to an expected study sample",
        JSON.stringify(
          {
            sourceRunId,
            artifactId,
            outputId: sourceArtifact?.outputId ?? null,
            artifactSampleId: sourceArtifact?.sampleId ?? null,
            selectedStudySampleIds: Array.from(candidatesByRecordId.keys()),
            inputSampleIds: sourceRun?.inputSampleIds ?? null,
          },
          null,
          2,
        ),
      );
    }

    const expectedBasename = `${expectedSample.sampleId}_NanoStats.txt`;
    const sourceFile = await resolveRegularNonSymlinkFile({
      storedPath: sourceArtifact.path,
      root: sourceRun.runFolder,
      context: `MultiQC source NanoPlot artifact ${artifactId}`,
    });
    const stagedFile = await resolveRegularNonSymlinkFile({
      storedPath: inventoryArtifact.stagedPath,
      root: run.runFolder,
      context: `MultiQC staged NanoPlot artifact ${artifactId}`,
    });
    if (
      !pathsReferToSameLocation(sourceFile.path, inventoryArtifact.sourcePath) ||
      path.basename(sourceFile.path) !== expectedBasename ||
      path.basename(stagedFile.path) !== expectedBasename ||
      sourceFile.size !== inventoryArtifact.size ||
      stagedFile.size !== inventoryArtifact.size ||
      (sourceArtifact.size != null &&
        Number(sourceArtifact.size) !== inventoryArtifact.size)
    ) {
      fail(
        `MultiQC: staged/source NanoPlot artifact metadata does not match for ${expectedSample.sampleId}`,
        JSON.stringify(
          {
            expectedBasename,
            sourceArtifactPath: sourceArtifact.path,
            inventorySourcePath: inventoryArtifact.sourcePath,
            stagedPath: inventoryArtifact.stagedPath,
            sourceSize: sourceFile.size,
            stagedSize: stagedFile.size,
            inventorySize: inventoryArtifact.size,
            artifactSize: sourceArtifact.size ?? null,
          },
          null,
          2,
        ),
      );
    }

    const [sourceSha256, stagedSha256, stagedText] = await Promise.all([
      sha256OfFile(sourceFile.path),
      sha256OfFile(stagedFile.path),
      fs.promises.readFile(stagedFile.path, "utf8"),
    ]);
    if (sourceSha256 !== stagedSha256) {
      fail(
        `MultiQC: staged NanoPlot NanoStats content differs from its source artifact for ${expectedSample.sampleId}`,
        JSON.stringify({ sourceSha256, stagedSha256 }, null, 2),
      );
    }
    expectedStats.push({
      sampleId: expectedSample.sampleId,
      sampleRecordId: expectedSample.sampleRecordId,
      sourceRunId,
      artifactId,
      metrics: parseNanoplotNanoStatsTsv({
        text: stagedText,
        context: `MultiQC staged NanoStats ${expectedSample.sampleId}`,
      }),
    });
    provenanceChecked += 1;
  }

  return { expectedStats, provenanceChecked };
}

async function assertMultiqcAggregation({ client, run, runId }) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const dataArtifact = artifacts.find(
    (artifact) =>
      artifact?.outputId === "multiqc_data" &&
      /(^|[/\\])multiqc_data\.json$/i.test(String(artifact?.path || "")),
  );
  if (!dataArtifact?.path) {
    fail(
      `multiqc aggregation: run ${runId} exposed no multiqc_data.json artifact`,
      JSON.stringify(
        {
          runId,
          dataArtifacts: artifacts
            .filter((artifact) => artifact?.outputId === "multiqc_data")
            .map((artifact) => artifact?.path),
        },
        null,
        2,
      ),
    );
  }

  const fetchedData = await fetchRunFileText({
    client,
    runId,
    filePath: dataArtifact.path,
    context: "MultiQC parsed data",
  });
  let parsedData;
  try {
    parsedData = JSON.parse(fetchedData.text);
  } catch (error) {
    fail(
      `multiqc aggregation: multiqc_data.json is invalid JSON`,
      error instanceof Error ? error.message : String(error),
    );
  }
  const generalStats = Array.isArray(parsedData?.report_general_stats_data)
    ? parsedData.report_general_stats_data
    : [];
  const populatedStats = generalStats.filter(
    (row) => row && typeof row === "object" && Object.keys(row).length > 0,
  );
  if (populatedStats.length === 0) {
    fail(
      `multiqc aggregation: run ${runId} parsed no sample/module statistics`,
      JSON.stringify({ runId, dataPath: dataArtifact.path }, null, 2),
    );
  }

  if (!run?.runFolder) {
    fail(`multiqc aggregation: run ${runId} has no runFolder`);
  }
  const inventoryPath = path.join(run.runFolder, "prior-run-inputs.json");
  const fetchedInventory = await fetchRunFileText({
    client,
    runId,
    filePath: inventoryPath,
    context: "MultiQC prior-run input inventory",
  });
  let inventory;
  try {
    inventory = JSON.parse(fetchedInventory.text);
  } catch (error) {
    fail(
      "multiqc aggregation: prior-run-inputs.json is invalid",
      error instanceof Error ? error.message : String(error),
    );
  }
  const stagedArtifacts = Array.isArray(inventory?.artifacts)
    ? inventory.artifacts
    : [];
  const fastqcInputs = stagedArtifacts.filter(
    (artifact) =>
      artifact?.pipelineId === "fastqc" &&
      artifact?.outputId === "sample_qc_data",
  );
  const nanoplotInputs = stagedArtifacts.filter(
    (artifact) =>
      artifact?.pipelineId === "nanoplot" &&
      artifact?.outputId === "sample_stats",
  );
  const declaredTotalBytes = stagedArtifacts.reduce(
    (total, artifact) =>
      total +
      (Number.isSafeInteger(artifact?.size) && artifact.size > 0
        ? artifact.size
        : 0),
    0,
  );
  if (
    inventory?.version !== 1 ||
    inventory?.currentRunId !== runId ||
    inventory?.studyId !== run?.study?.id ||
    !pathsReferToSameLocation(
      inventory?.inputDirectory,
      path.join(run.runFolder, "prior-run-inputs"),
    ) ||
    inventory?.totalBytes !== declaredTotalBytes ||
    fastqcInputs.length === 0 ||
    nanoplotInputs.length === 0
  ) {
    fail(
      `multiqc aggregation: staged-input provenance is incomplete for run ${runId}`,
      JSON.stringify(
        {
          runId,
          expectedStudyId: run?.study?.id ?? null,
          inventoryRunId: inventory?.currentRunId ?? null,
          inventoryStudyId: inventory?.studyId ?? null,
          inventoryVersion: inventory?.version ?? null,
          inventoryInputDirectory: inventory?.inputDirectory ?? null,
          inventoryTotalBytes: inventory?.totalBytes ?? null,
          calculatedTotalBytes: declaredTotalBytes,
          stagedArtifacts: stagedArtifacts.map((artifact) => ({
            pipelineId: artifact?.pipelineId,
            outputId: artifact?.outputId,
          })),
        },
        null,
        2,
      ),
    );
  }
  for (const artifact of stagedArtifacts) {
    if (
      typeof artifact?.stagedPath !== "string" ||
      typeof artifact?.sourcePath !== "string" ||
      !pathIsWithin(artifact?.stagedPath, run.runFolder) ||
      artifact?.sourcePath === artifact?.stagedPath
    ) {
      fail(
        `multiqc aggregation: staged artifact provenance is unsafe`,
        JSON.stringify({ runId, artifact }, null, 2),
      );
    }
  }
  const candidateSamples = expectedFastqcSamplesForRun({
    run,
    context: `multiqc aggregation for run ${runId}`,
    allowSamplesWithoutReads: true,
  });
  const fastqcGroundTruth = await buildMultiqcFastqcGroundTruth({
    client,
    run,
    candidateSamples,
    fastqcInputs,
  });
  const expectedSamples = fastqcGroundTruth.expectedSamples;
  const sampleMateCoverage = assertMultiqcFastqcCoverage({
    expectedSamples,
    generalStatsData: generalStats,
    stagedFastqcArtifacts: fastqcInputs,
    expectedSequenceCountsByIdentity:
      fastqcGroundTruth.sequenceCountsByIdentity,
    context: `multiqc aggregation for run ${runId}`,
  });
  const nanoplotGroundTruth = await buildMultiqcNanoplotGroundTruth({
    client,
    run,
    candidateSamples,
    nanoplotInputs,
  });
  const nanoplotCoverage = assertMultiqcNanoplotMetrics({
    expectedStats: nanoplotGroundTruth.expectedStats,
    multiqcNanostatData: parsedData?.multiqc_nanostat,
    context: `multiqc aggregation for run ${runId}`,
  });

  return {
    dataPath: dataArtifact.path,
    generalStatsSections: populatedStats.length,
    stagedArtifactCount: stagedArtifacts.length,
    stagedFastqcInputs: fastqcInputs.length,
    fastqcProvenanceChecked: fastqcGroundTruth.provenanceChecked,
    sampleMateCoverage,
    stagedNanoStatsInputs: nanoplotInputs.length,
    nanoplotProvenanceChecked: nanoplotGroundTruth.provenanceChecked,
    nanoplotCoverage,
    inventoryPath,
  };
}

// fastq-checksum (MERGE): checksum1 = md5(file1) written in place onto each target
// sample's existing active Read. Asserts format + coverage + an on-disk md5 round-trip.
async function assertChecksumReads({ run, runId, client, baseUrl }) {
  const candidates = expectedFastqcSamplesForRun({
    run,
    context: `fastq-checksum run ${runId}`,
  });
  const inputEvidence = await bindExpectedSamplesToRunInputs({
    client,
    run,
    runId,
    expectedSamples: candidates,
    r1Column: "fastq_1",
    r2Column: "fastq_2",
    computeGroundTruth: false,
    context: `fastq-checksum run ${runId}`,
  });
  const readsWithFile1 = inputEvidence.expectedSamples.map((sample) => ({
    ...sample.activeRead,
    sampleId: sample.sampleId,
    file1: sample.file1,
    file2: sample.file2,
  }));

  // (A) FORMAT + EXACT SAMPLESHEET-BOUND COVERAGE: only the DB Reads that
  // supplied the invocation inputs may count as checksum writeback evidence.
  let populatedChecksum1 = 0;
  for (const read of readsWithFile1) {
    assertReadSource({ read, pipelineId: "fastq-checksum", runId });
    if (typeof read.checksum1 !== "string" || !MD5_HEX.test(read.checksum1)) {
      fail(
        `Checksum writeback: read ${read.id} (sample ${read.sampleId}) has file1 but checksum1 is not a 32-char md5 hex`,
        JSON.stringify({ runId, file1: read.file1, checksum1: read.checksum1 ?? null }, null, 2),
      );
    }
    populatedChecksum1 += 1;
    if (
      read.file2 != null &&
      (typeof read.checksum2 !== "string" || !MD5_HEX.test(read.checksum2))
    ) {
      fail(
        `Checksum writeback: read ${read.id} (sample ${read.sampleId}) has file2 but checksum2 is not a 32-char md5 hex`,
        JSON.stringify({ runId, file2: read.file2, checksum2: read.checksum2 ?? null }, null, 2),
      );
    }
  }

  // (B) CORRECTNESS: every exact invocation input was necessarily readable by
  // the completed workflow. Independently recompute all of them; no unresolved
  // warning path is acceptable for this proof.
  const configuredTargets = readsWithFile1.flatMap((read) => [
    {
      readId: read.id,
      sampleId: read.sampleId,
      mate: "R1",
      configuredPath: read.file1,
      storedChecksum: read.checksum1,
    },
    ...(read.file2 != null
      ? [
          {
            readId: read.id,
            sampleId: read.sampleId,
            mate: "R2",
            configuredPath: read.file2,
            storedChecksum: read.checksum2,
          },
        ]
      : []),
  ]);
  const verificationTargets = [];
  for (const target of configuredTargets) {
    let onDiskPath = null;
    try {
      onDiskPath = fs.realpathSync.native(target.configuredPath);
      const stat = fs.statSync(onDiskPath);
      if (!stat.isFile() || stat.size <= 0) {
        fail(
          `Checksum writeback: invocation input is not a non-empty regular file`,
          JSON.stringify({ target, onDiskPath }, null, 2),
        );
      }
      verificationTargets.push({
        ...target,
        onDiskPath,
        computedChecksum: await md5OfFile(onDiskPath),
      });
    } catch (error) {
      verificationTargets.push({
        ...target,
        onDiskPath,
        computedChecksum: null,
        error: `md5 failed (${error instanceof Error ? error.message : String(error)})`,
      });
    }
  }
  const checksumVerification = assertChecksumVerificationCoverage({
    targets: verificationTargets,
    requireEveryConfiguredFile: true,
    context: `Checksum writeback for run ${runId}`,
  });

  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const summaryArtifacts = artifacts.filter(
    (artifact) => artifact?.outputId === "summary",
  );
  if (
    summaryArtifacts.length !== 1 ||
    typeof summaryArtifacts[0]?.path !== "string" ||
    !summaryArtifacts[0].path
  ) {
    fail(
      `Checksum writeback: run ${runId} must expose exactly one path-bound summary artifact`,
      JSON.stringify({ summaryArtifacts }, null, 2),
    );
  }
  const summaryFetched = await fetchRunFileText({
    client,
    runId,
    filePath: summaryArtifacts[0].path,
    context: `fastq-checksum summary for run ${runId}`,
  });
  const parsedSummary = parseTsv(summaryFetched.text);
  const summaryProof = assertFastqChecksumSummaryRows({
    header: parsedSummary.header,
    rows: parsedSummary.rows,
    targets: verificationTargets,
    context: `fastq-checksum summary for run ${runId}`,
  });

  return {
    runId,
    targetType: run?.targetType,
    readsChecked: readsWithFile1.length,
    populatedChecksum1,
    md5Verified: checksumVerification.verifiedR1,
    pairedReadsChecked: checksumVerification.configuredR2,
    md5Verified2: checksumVerification.verifiedR2,
    checksumVerification,
    samplesheetPath: inputEvidence.samplesheetPath,
    summaryPath: summaryArtifacts[0].path,
    summaryBytes: summaryFetched.bytes,
    summaryProof,
    debugEndpoint: debugEndpoint(baseUrl, runId),
  };
}

// simulate-reads runs in REPLACE mode: on completion it creates a NEW active Read for
// each sample (file1/2 + checksum1/2 + readCount1/2) and supersedes the prior reads.
// Require exact run attribution. A checksum-only fallback is unsafe because the
// same fixture is intentionally reused across local and SLURM modes.
async function assertReplaceReads({ client, run, runId, baseUrl }) {
  const samples = selectedTargetSamplesForRun({
    run,
    context: `Replace writeback for run ${runId}`,
  });
  if (samples.length === 0) {
    fail(`Replace writeback: run ${runId} exposed no target samples`);
  }
  const reads = [];
  for (const sample of samples) {
    for (const read of Array.isArray(sample?.reads) ? sample.reads : []) {
      reads.push({ sampleId: sample?.sampleId, ...read });
    }
  }

  const config = effectiveSimulateReadsConfig(run);
  const pairedEnd = config.mode === "shortReadPaired";
  const attributionMode = "pipelineRunId+pipelineSources";
  const attributed = reads.filter((read) => read.pipelineRunId === runId);
  const notAttributed = reads.filter((read) => read.pipelineRunId !== runId);

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
  if (notAttributed.length > 0 || reads.length !== samples.length) {
    fail(
      `Replace writeback: expected exactly one active run-attributed Read per target sample`,
      JSON.stringify(
        {
          runId,
          targetSamples: samples.map((sample) => sample?.sampleId ?? null),
          activeReads: reads.map((read) => ({
            id: read?.id ?? null,
            sampleId: read?.sampleId ?? null,
            pipelineRunId: read?.pipelineRunId ?? null,
          })),
          notAttributed: notAttributed.map((read) => read?.id ?? null),
        },
        null,
        2,
      ),
    );
  }
  for (const read of attributed) {
    assertReadSource({ read, pipelineId: "simulate-reads", runId });
    if (typeof read.file1 !== "string" || read.file1.length === 0) {
      fail(
        `Replace writeback: attributed read ${read.id} has no file1`,
        JSON.stringify({ runId, file1: read.file1 ?? null }, null, 2),
      );
    }
    if (!Number.isSafeInteger(Number(read.readCount1)) || !(Number(read.readCount1) > 0)) {
      fail(
        `Replace writeback: attributed read ${read.id} has no positive readCount1`,
        JSON.stringify({ runId, readCount1: read.readCount1 ?? null }, null, 2),
      );
    }
    if (typeof read.checksum1 !== "string" || !MD5_HEX.test(read.checksum1)) {
      fail(
        `Replace writeback: attributed read ${read.id} has no valid checksum1`,
        JSON.stringify({ runId, checksum1: read.checksum1 ?? null }, null, 2),
      );
    }
    if (pairedEnd) {
      if (typeof read.file2 !== "string" || read.file2.length === 0) {
        fail(
          `Replace writeback: paired attributed read ${read.id} has no file2`,
          JSON.stringify({ runId, file2: read.file2 ?? null }, null, 2),
        );
      }
      if (typeof read.checksum2 !== "string" || !MD5_HEX.test(read.checksum2)) {
        fail(
          `Replace writeback: paired attributed read ${read.id} has no valid checksum2`,
          JSON.stringify({ runId, checksum2: read.checksum2 ?? null }, null, 2),
        );
      }
      if (!Number.isSafeInteger(Number(read.readCount2)) || !(Number(read.readCount2) > 0)) {
        fail(
          `Replace writeback: paired attributed read ${read.id} has no positive readCount2`,
          JSON.stringify({ runId, readCount2: read.readCount2 ?? null }, null, 2),
        );
      }
    }
  }

  const expectedSampleIds = samples.map((sample) => sample?.sampleId);
  const sampleCoverage = assertExactActiveRunAttributedReadCoverage({
    expectedSampleIds,
    activeReads: reads,
    runId,
    context: `Replace writeback for run ${runId}`,
  });

  const settings = await requestJson(
    client,
    "/api/admin/settings/sequencing-files",
    {},
    "Fetch sequencing-files settings for replace writeback",
  );
  const dataBasePath =
    typeof settings?.dataBasePath === "string" && settings.dataBasePath
      ? settings.dataBasePath
      : null;
  if (!dataBasePath) {
    fail(
      `Replace writeback: sequencing data base path is unavailable for run ${runId}`,
      JSON.stringify(settings, null, 2),
    );
  }
  const resolveOnDisk = (file) => {
    if (typeof file !== "string" || !file) return null;
    const candidate = path.isAbsolute(file)
      ? file
      : path.resolve(dataBasePath, file);
    if (!pathIsWithin(candidate, dataBasePath)) return null;
    return fs.existsSync(candidate) ? candidate : null;
  };
  let persistedFilesVerified = 0;
  for (const read of attributed) {
    for (const [fileField, checksumField] of [
      ["file1", "checksum1"],
      ["file2", "checksum2"],
    ]) {
      if (!read[fileField]) continue;
      const onDisk = resolveOnDisk(read[fileField]);
      if (!onDisk) {
        fail(
          `Replace writeback: ${fileField} for read ${read.id} is not present in persistent sequencing storage`,
          JSON.stringify({ runId, [fileField]: read[fileField], dataBasePath }, null, 2),
        );
      }
      const computed = await md5OfFile(onDisk);
      if (computed !== read[checksumField]) {
        fail(
          `Replace writeback: persisted ${fileField} checksum does not match ${checksumField} for read ${read.id}`,
          JSON.stringify(
            {
              runId,
              onDisk,
              stored: read[checksumField] ?? null,
              computed,
            },
            null,
            2,
          ),
        );
      }
      persistedFilesVerified += 1;
    }
  }

  return {
    runId,
    attributionMode,
    activeReadCount: reads.length,
    attributedReadCount: attributed.length,
    targetSampleCount: sampleCoverage.expectedSampleCount,
    mode: config.mode,
    pairedEnd,
    persistedFilesVerified,
    dataBasePath,
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
  runStateFile,
}) {
  // Exactly one of orderId / studyId is sent, matching the pipeline's manifest target.
  const createBody = buildRuntimeRunCreateBody({
    pipelineId,
    orderId,
    studyId,
    config,
    executionMode,
    slurm,
  });
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
  writeRunState(runStateFile, {
    pipelineId,
    runId,
    label,
    requestedExecutionMode: executionMode,
    runFolder: createPayload?.run?.runFolder || null,
    jobId: null,
  });

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
  writeRunState(runStateFile, {
    pipelineId,
    runId,
    label,
    requestedExecutionMode: executionMode,
    resolvedExecutionMode: startPayload?.executionMode || null,
    runFolder: startPayload?.runFolder || createPayload?.run?.runFolder || null,
    jobId: startPayload?.jobId || null,
  });

  const result = await pollUntilDone({
    client,
    baseUrl,
    runId,
    startPayload,
    timeoutSeconds,
    label,
  });
  assertRunIdentity({
    run: result.run,
    pipelineId,
    targetType: orderId ? "order" : "study",
    orderId: orderId ?? null,
    studyId: studyId ?? null,
    context: `${label} completion fetch for run ${runId}`,
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
  const httpTimeoutSeconds =
    toOptionalInt(
      args["http-timeout"] ||
        process.env.SEQDESK_RUNTIME_E2E_HTTP_TIMEOUT_SECONDS,
    ) || 120;
  const pipelineId =
    args["pipeline-id"] || process.env.SEQDESK_RUNTIME_E2E_PIPELINE_ID || "simulate-reads";
  const requestedDummyOrderIndex = toOptionalInt(
    args["dummy-order-index"] ||
      process.env.SEQDESK_RUNTIME_E2E_DUMMY_ORDER_INDEX,
  );
  const preferredDummyOrderIndex =
    requestedDummyOrderIndex || PIPELINE_DUMMY_ORDER_INDEX[pipelineId];
  const skipLocal = Boolean(args["skip-local"]);
  const skipSlurm = Boolean(args["skip-slurm"]);
  const includeDefaultPolicy = Boolean(args["include-default-policy"]);
  const ensureSeededDummyData =
    Boolean(args["ensure-dummy-data"]) ||
    envFlag(process.env.SEQDESK_RUNTIME_E2E_ENSURE_DUMMY_DATA);
  const expectDefaultMode = toOptionalString(
    args["expect-default-mode"] || process.env.SEQDESK_RUNTIME_E2E_EXPECT_DEFAULT_MODE,
  );
  const runStateFile = toOptionalString(
    args["run-state-file"] || process.env.SEQDESK_RUNTIME_E2E_RUN_STATE_FILE,
  );
  const expectedPipelineRoot = toOptionalString(
    args["expected-pipeline-root"] ||
      process.env.SEQDESK_RUNTIME_E2E_EXPECTED_PIPELINE_ROOT,
  );
  const requiredRelativeOutput = toOptionalString(
    args["required-relative-output"] ||
      process.env.SEQDESK_RUNTIME_E2E_REQUIRED_RELATIVE_OUTPUT,
  );
  const requiredOutputContains = toOptionalString(
    args["required-output-contains"] ||
      process.env.SEQDESK_RUNTIME_E2E_REQUIRED_OUTPUT_CONTAINS,
  );
  const requiredOutputExpectation = requiredRelativeOutput
    ? {
        relativePath: requiredRelativeOutput,
        requiredContent: requiredOutputContains,
      }
    : null;
  const requiredArtifactOutputIds = String(
    args["required-artifact-output-id"] ||
      process.env.SEQDESK_RUNTIME_E2E_REQUIRED_ARTIFACT_OUTPUT_ID ||
      "",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (skipLocal && skipSlurm && !includeDefaultPolicy) {
    fail("Nothing to run: remove --skip-local/--skip-slurm or add --include-default-policy.");
  }
  if (expectDefaultMode && !["local", "slurm"].includes(expectDefaultMode)) {
    fail("--expect-default-mode must be local or slurm");
  }
  if (requiredOutputContains && !requiredRelativeOutput) {
    fail("--required-output-contains requires --required-relative-output");
  }
  if (
    requiredArtifactOutputIds.some(
      (outputId) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(outputId),
    )
  ) {
    fail("--required-artifact-output-id must contain safe comma-separated output IDs");
  }
  if (requiredArtifactOutputIds.length > 0 && !requiredOutputExpectation) {
    fail("--required-artifact-output-id requires --required-relative-output");
  }
  if (
    preferredDummyOrderIndex !== undefined &&
    (preferredDummyOrderIndex < 1 || preferredDummyOrderIndex > 999)
  ) {
    fail("--dummy-order-index must be an integer between 1 and 999");
  }
  if (expectedPipelineRoot && !path.isAbsolute(expectedPipelineRoot)) {
    fail("--expected-pipeline-root must be an absolute path");
  }

  if (!skipSlurm || expectDefaultMode === "slurm") {
    for (const command of ["sbatch", "squeue", "sacct", "scontrol"]) {
      if (!(await commandExists(command))) {
        fail(`Required SLURM command is not available on this host: ${command}`);
      }
    }
  }

  const client = createClient(baseUrl, httpTimeoutSeconds * 1000);
  const session = await loginAdmin({ client, baseUrl, email, password });

  // Persist the sequencing data base path before any seed. Fixture extractors (mag-smoke,
  // read-cleaning-spike) read the RAW stored SiteSettings.dataBasePath — NOT the config/env
  // resolved value — so a source-boot app (no install profile) must set it explicitly, else the
  // extract 500s ("requires site.dataBasePath to extract FASTQ files"). Only runs with the flag.
  const setDataBasePath = toOptionalString(args["set-data-base-path"]);
  if (setDataBasePath) {
    const res = await client.request("/api/admin/settings/sequencing-files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataBasePath: setDataBasePath }),
    });
    if (!res.ok) {
      fail(`Failed to set dataBasePath='${setDataBasePath}' (${res.status})`, summarizeBody(await res.text()));
    }
    console.log(`Set sequencing dataBasePath = ${setDataBasePath}`);
  }

  // Optionally provision an example dataset (real order/study/samples/reads) before the run, e.g.
  // mag needs paired short reads the Gemma ONT data can't provide. POSTs the admin seed route and
  // waits for it (synchronous), so the dataset exists before we look up the order/study below.
  const seedExample = toOptionalString(args["seed-example-dataset"]);
  if (seedExample) {
    const seedPath = `/api/admin/seed/example-datasets/${seedExample}`;
    const seedRes = await client.request(seedPath, { method: "POST" });
    const seedBody = await seedRes.text();
    if (!seedRes.ok) {
      fail(`Failed to seed example dataset '${seedExample}' (${seedRes.status})`, summarizeBody(seedBody));
    }
    console.log(`Seeded example dataset '${seedExample}': ${summarizeBody(seedBody)}`);
  }

  // Study-scoped pipelines (per manifest targets.supported) run against a study;
  // everything else runs against an order.
  const targetType = STUDY_SCOPED_PIPELINES.has(pipelineId) ? "study" : "order";

  let selectedOrder = null;
  let selectedStudy = null;
  let orderId;
  let studyId;
  if (targetType === "study") {
    const explicitStudyId = args["study-id"] || process.env.SEQDESK_RUNTIME_E2E_STUDY_ID;
    const studyAlias = args["study-alias"] || process.env.SEQDESK_RUNTIME_E2E_STUDY_ALIAS;
    if (explicitStudyId) {
      selectedStudy = { id: explicitStudyId, title: null, samplesWithReads: null, source: "explicit" };
    } else if (studyAlias) {
      // Pin a specific study by alias (e.g. the real Gemma study on an installed app),
      // since the heuristic would otherwise prefer the CI dummy study.
      const studies = await fetchStudies(client);
      const match = studies.find((study) => String(study?.alias || "") === studyAlias);
      if (!match?.id) {
        fail(
          `No study with alias '${studyAlias}' was found`,
          JSON.stringify({ aliases: studies.map((s) => s?.alias).filter(Boolean) }, null, 2),
        );
      }
      selectedStudy = { ...match, source: "alias" };
    } else {
      selectedStudy = await findStudy(client, { ensureSeededDummyData });
    }
    studyId = selectedStudy.id;
  } else {
    const explicitOrderId = args["order-id"] || process.env.SEQDESK_RUNTIME_E2E_ORDER_ID;
    const orderNumber = args["order-number"] || process.env.SEQDESK_RUNTIME_E2E_ORDER_NUMBER;
    if (explicitOrderId) {
      selectedOrder = { id: explicitOrderId, orderNumber: null, status: null, samples: null, source: "explicit" };
    } else if (orderNumber) {
      // Pin a specific order by number (e.g. DEV-GEMMA-ONT-001 on an installed app),
      // since the heuristic scores CI dummy orders above a plain submitted order.
      const orders = await fetchOrders(client);
      const match = orders.find((order) => String(order?.orderNumber || "") === orderNumber);
      if (!match?.id) {
        fail(
          `No order with orderNumber '${orderNumber}' was found`,
          JSON.stringify({ orderNumbers: orders.map((o) => o?.orderNumber).filter(Boolean) }, null, 2),
        );
      }
      selectedOrder = { ...match, source: "orderNumber" };
    } else {
      selectedOrder = await findOrder(client, {
        ensureSeededDummyData,
        dummyOrderPrefix: dummyOrderPrefixForSession(session),
        preferredDummyOrderIndex,
      });
    }
    orderId = selectedOrder.id;
  }
  const savedConfigOnly = Boolean(args["saved-config-only"]);
  const configJsonArgument = args["config-json"];
  const configJsonEnvironment = process.env.SEQDESK_RUNTIME_E2E_CONFIG_JSON;
  const configJson =
    configJsonArgument !== undefined
      ? configJsonArgument
      : configJsonEnvironment;
  const config = resolveRuntimeRunConfig({
    defaultConfig: defaultConfigForPipeline(pipelineId),
    overrideConfig: parseJsonObject(configJson, "config JSON"),
    overrideProvided:
      configJsonArgument !== undefined || configJsonEnvironment !== undefined,
    savedConfigOnly,
  });
  const slurm = buildSlurmOverride(args);
  const policy = await getPipelinePolicy(client, pipelineId);
  if (!policy) fail(`Pipeline ${pipelineId} was not returned by /api/admin/settings/pipelines`);
  if (!policy.enabled) {
    // --skip-if-disabled: on a real install whose profile may not enable every pipeline,
    // a disabled pipeline is a SKIP (clean exit), not a failure — so a canary can run the
    // read-consuming pipelines that ARE enabled without reding the suite on the others.
    if (Boolean(args["skip-if-disabled"]) || envFlag(process.env.SEQDESK_RUNTIME_E2E_SKIP_IF_DISABLED)) {
      console.log(JSON.stringify({ skipped: true, reason: "pipeline-not-enabled", pipelineId }, null, 2));
      return;
    }
    fail(`Pipeline ${pipelineId} is not enabled in SeqDesk settings`);
  }

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
      runStateFile,
    });
    assertLocalRunShape(localResult.run, localResult.startPayload);
    const files = await assertRunFiles({
      mode: "local",
      run: localResult.run,
      pipelineId,
      requiredOutputExpectation,
      expectedPipelineRoot,
    });
    const writeback = await assertPipelineWriteback({
      client,
      baseUrl,
      runId: localResult.runId,
      pipelineId,
      targetType,
      orderId,
      studyId,
      requiredArtifactOutputIds,
      requiredOutputExpectation,
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
      runStateFile,
    });
    const jobId = assertSlurmRunShape(slurmResult.run, slurmResult.startPayload);
    const files = await assertRunFiles({
      mode: "slurm",
      run: slurmResult.run,
      jobId,
      pipelineId,
      requiredOutputExpectation,
      expectedPipelineRoot,
    });
    const writeback = await assertPipelineWriteback({
      client,
      baseUrl,
      runId: slurmResult.runId,
      pipelineId,
      targetType,
      orderId,
      studyId,
      requiredArtifactOutputIds,
      requiredOutputExpectation,
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
      runStateFile,
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
      requiredOutputExpectation,
      expectedPipelineRoot,
    });
    const writeback = await assertPipelineWriteback({
      client,
      baseUrl,
      runId: defaultResult.runId,
      pipelineId,
      targetType,
      orderId,
      studyId,
      requiredArtifactOutputIds,
      requiredOutputExpectation,
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
      writeback,
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
    configSource: savedConfigOnly ? "saved-pipeline-config" : "per-run",
    config: config ?? null,
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
