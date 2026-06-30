#!/usr/bin/env node
/**
 * Researcher data lifecycle E2E (md item 8 in .github/PIPELINE_E2E_COVERAGE.md).
 *
 * Drives the INSTALLED app over HTTP and proves, with read-back assertions at every step,
 * the full data-management loop through the app's API (no direct DB access):
 *   (1) RESEARCHER creates a sequencing Order            POST /api/orders
 *   (2) RESEARCHER adds Samples to it                    POST /api/orders/[id]/samples
 *   (3) RESEARCHER submits the order (DRAFT -> SUBMITTED) PUT  /api/orders/[id]
 *   (4) FACILITY_ADMIN attaches a reads File to a sample  (resumable upload trio)
 *   (5) RESEARCHER creates a Study + joins the samples    POST /api/studies (+ /[id]/samples)
 *   (6) the file rolls up into the Study (samplesWithReads)  GET /api/studies
 *
 * TWO-ACTOR by design: the reads/file-attach surface (src/app/api/orders/[id]/sequencing/*)
 * is FACILITY-ADMIN-ONLY (requireFacilityAdminSequencingSession -> 403 for a researcher), so
 * the researcher owns the order/samples/study while the facility admin performs the upload —
 * exactly the real product flow. Status gating is strict: samples are editable only while the
 * order is DRAFT; file attach requires SUBMITTED. Hence: create -> add samples -> submit -> attach.
 *
 * Transport (CookieJar, createClient, requestJson, NextAuth CSRF+credentials login) mirrors
 * scripts/run-pipeline-runtime-e2e.mjs.
 *
 * USAGE:
 *   node scripts/researcher-lifecycle-e2e.mjs --base-url http://127.0.0.1:PORT \
 *     --admin-email admin@example.com --admin-password admin \
 *     --researcher-email user@example.com --researcher-password user
 */
import crypto from "node:crypto";
import zlib from "node:zlib";

// ── shared transport (copied from run-pipeline-runtime-e2e.mjs) ──────────────
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

function jsonInit(method, body) {
  return {
    method,
    headers: { "content-type": "application/json", "x-seqdesk-e2e": "playwright" },
    body: JSON.stringify(body),
  };
}

function assert(condition, message, details) {
  if (!condition) fail(message, details);
}

// ── auth ─────────────────────────────────────────────────────────────────────
async function loginUser({ client, baseUrl, email, password, expectedRole }) {
  const csrfResponse = await client.request("/api/auth/csrf");
  if (!csrfResponse.ok) fail(`Failed to fetch CSRF token (${csrfResponse.status})`);
  const csrfToken = (await parseJson(csrfResponse, "CSRF endpoint"))?.csrfToken;
  if (typeof csrfToken !== "string" || !csrfToken) fail("CSRF endpoint did not return a csrfToken");

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
    fail(`Credentials login failed for ${email} (${loginResponse.status})`, summarizeBody(await loginResponse.text()));
  }

  const sessionResponse = await client.request("/api/auth/session");
  if (!sessionResponse.ok) fail(`Failed to fetch session after login (${sessionResponse.status})`);
  const session = await parseJson(sessionResponse, "Session endpoint");
  assert(
    session?.user?.email === email && session?.user?.role === expectedRole,
    `Login did not produce the expected ${expectedRole} session for ${email}`,
    JSON.stringify(session, null, 2),
  );
  return session;
}

// ── STEP 1 — create order (researcher), DRAFT ────────────────────────────────
async function createOrder({ client, marker, sampleCount }) {
  const order = await requestJson(
    client,
    "/api/orders",
    jsonInit("POST", {
      name: `e2e-lifecycle ${marker}`,
      platform: "ILLUMINA",
      instrumentModel: "Illumina NovaSeq 6000",
      librarySource: "METAGENOMIC",
      numberOfSamples: sampleCount,
    }),
    "Create order",
  );
  assert(typeof order?.id === "string", "Create order: response missing id", JSON.stringify(order));
  assert(order.status === "DRAFT", `Create order: expected DRAFT, got ${order?.status}`);
  assert(/^ORD-\d{8}-\d{4}$/.test(order.orderNumber || ""), `Create order: bad orderNumber ${order?.orderNumber}`);

  const list = await requestJson(client, "/api/orders", {}, "List orders");
  const orders = Array.isArray(list) ? list : list?.orders;
  const found = (orders || []).find((o) => o.id === order.id);
  assert(found, "Create order: new order not visible in GET /api/orders");
  assert(found.status === "DRAFT", `Create order read-back: expected DRAFT, got ${found.status}`);
  return { id: order.id, orderNumber: order.orderNumber };
}

// ── STEP 2 — add samples (researcher), order DRAFT ───────────────────────────
async function addSamples({ client, orderId, sampleCount, marker }) {
  const samples = Array.from({ length: sampleCount }, (_, i) => ({
    isNew: true,
    sampleId: `${marker}-S${i + 1}`,
    scientificName: "metagenome",
    taxId: "256318",
  }));
  const result = await requestJson(
    client,
    `/api/orders/${orderId}/samples`,
    jsonInit("POST", { samples }),
    "Add samples",
  );
  const saved = result?.samples || [];
  assert(saved.length === sampleCount, `Add samples: expected ${sampleCount}, got ${saved.length}`, JSON.stringify(result));

  // Map the user-facing sampleId we sent -> the DB cuid (sample.id) for later steps.
  const byAccession = new Map(saved.map((s) => [s.sampleId, s]));
  const ordered = samples.map((s) => {
    const row = byAccession.get(s.sampleId);
    assert(row && typeof row.id === "string", `Add samples: no DB id for ${s.sampleId}`);
    return { id: row.id, sampleId: row.sampleId };
  });

  const readBack = await requestJson(client, `/api/orders/${orderId}/samples`, {}, "List order samples");
  assert((readBack?.samples || []).length === sampleCount, "Add samples read-back: count mismatch");
  return ordered;
}

// ── STEP 3 — submit order (researcher), DRAFT -> SUBMITTED ────────────────────
async function submitOrder({ client, orderId }) {
  const updated = await requestJson(
    client,
    `/api/orders/${orderId}`,
    jsonInit("PUT", { status: "SUBMITTED", statusNote: "e2e lifecycle submit" }),
    "Submit order",
  );
  assert(updated?.status === "SUBMITTED", `Submit order: expected SUBMITTED, got ${updated?.status}`);
  return updated;
}

// ── STEP 4 — attach a reads file (facility admin), the resumable upload trio ──
function buildTinyFastqGz() {
  const fastq = "@e2e_read_1\nACGTACGTACGT\n+\nIIIIIIIIIIII\n";
  const bytes = zlib.gzipSync(Buffer.from(fastq));
  return { bytes, md5: crypto.createHash("md5").update(bytes).digest("hex") };
}

async function attachReadFile({ adminClient, orderId, sample, file }) {
  // (a) create the upload session
  const session = await requestJson(
    adminClient,
    `/api/orders/${orderId}/sequencing/uploads`,
    jsonInit("POST", {
      targetKind: "read",
      targetRole: "R1",
      sampleId: sample.id, // DB cuid
      originalName: `${sample.sampleId}_R1.fastq.gz`,
      expectedSize: file.bytes.length,
      checksumProvided: file.md5,
      metadata: { dataClass: "cleaned" },
    }),
    "Create upload session",
  );
  const uploadId = session?.uploadId || session?.id;
  assert(typeof uploadId === "string", "Create upload session: missing uploadId", JSON.stringify(session));

  // (b) PATCH the single chunk (raw bytes) at offset 0
  const patchResponse = await adminClient.request(
    `/api/orders/${orderId}/sequencing/uploads/${uploadId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/octet-stream", "x-seqdesk-offset": "0" },
      body: file.bytes,
    },
  );
  if (!patchResponse.ok) {
    fail(`Upload chunk PATCH failed (${patchResponse.status})`, summarizeBody(await patchResponse.text()));
  }

  // (c) complete -> moves temp->final and upserts Read.file1 = finalPath
  const completed = await requestJson(
    adminClient,
    `/api/orders/${orderId}/sequencing/uploads/${uploadId}/complete`,
    { method: "POST" },
    "Complete upload",
  );
  const finalPath = completed?.finalPath || completed?.read?.file1;
  assert(finalPath, "Complete upload: no finalPath / Read.file1 in response", JSON.stringify(completed));

  // admin read-back: the sequencing summary must now show the sample has reads
  const summary = await requestJson(
    adminClient,
    `/api/orders/${orderId}/sequencing`,
    {},
    "Order sequencing summary",
  );
  const rows = summary?.samples || [];
  const row = rows.find((r) => r.id === sample.id || r.sampleId === sample.sampleId);
  assert(row, "Attach read-back: sample not in sequencing summary", JSON.stringify(rows).slice(0, 600));
  assert(row.hasReads === true || row.read?.file1, "Attach read-back: sample still shows no reads", JSON.stringify(row));
  return { uploadId, finalPath, checksum: file.md5 };
}

// ── STEP 5 + 6 — study create + join + rollup assertion (researcher) ──────────
async function createStudyAndJoinSamples({ client, sampleIds, marker }) {
  const study = await requestJson(
    client,
    "/api/studies",
    jsonInit("POST", { title: `e2e-lifecycle ${marker}`, description: "researcher lifecycle e2e" }),
    "Create study",
  );
  assert(typeof study?.id === "string", "Create study: missing id", JSON.stringify(study));

  const joined = await requestJson(
    client,
    `/api/studies/${study.id}/samples`,
    jsonInit("POST", { sampleIds }),
    "Join samples to study",
  );
  assert(
    (joined?.assignedCount ?? joined?.assigned ?? 0) === sampleIds.length,
    `Join samples: expected ${sampleIds.length} assigned, got ${joined?.assignedCount}`,
    JSON.stringify(joined),
  );
  return study.id;
}

async function assertStudyRollup({ client, studyId, expectSampleCount, expectWithReads }) {
  const studies = await requestJson(client, "/api/studies", {}, "List studies");
  const list = Array.isArray(studies) ? studies : studies?.studies || [];
  const study = list.find((s) => s.id === studyId);
  assert(study, "Study rollup: study not found in GET /api/studies");
  const sampleCount = study._count?.samples ?? study.samplesCount;
  assert(sampleCount === expectSampleCount, `Study rollup: expected ${expectSampleCount} samples, got ${sampleCount}`);
  assert(
    (study.samplesWithReads ?? 0) >= expectWithReads,
    `Study rollup: expected samplesWithReads >= ${expectWithReads}, got ${study.samplesWithReads}`,
    JSON.stringify(study),
  );
  return study;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args["base-url"] || "http://localhost:3000";
  const adminEmail = args["admin-email"] || "admin@example.com";
  const adminPassword = args["admin-password"] || "admin";
  const researcherEmail = args["researcher-email"] || "user@example.com";
  const researcherPassword = args["researcher-password"] || "user";
  const marker = `LIFE-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  const SAMPLE_COUNT = 2;

  const researcher = createClient(baseUrl);
  await loginUser({ client: researcher, baseUrl, email: researcherEmail, password: researcherPassword, expectedRole: "RESEARCHER" });
  const admin = createClient(baseUrl);
  await loginUser({ client: admin, baseUrl, email: adminEmail, password: adminPassword, expectedRole: "FACILITY_ADMIN" });

  const order = await createOrder({ client: researcher, marker, sampleCount: SAMPLE_COUNT });
  const samples = await addSamples({ client: researcher, orderId: order.id, sampleCount: SAMPLE_COUNT, marker });
  await submitOrder({ client: researcher, orderId: order.id });

  const file = buildTinyFastqGz();
  const attach = await attachReadFile({ adminClient: admin, orderId: order.id, sample: samples[0], file });

  const studyId = await createStudyAndJoinSamples({ client: researcher, sampleIds: samples.map((s) => s.id), marker });
  const study = await assertStudyRollup({ client: researcher, studyId, expectSampleCount: SAMPLE_COUNT, expectWithReads: 1 });

  return {
    success: true,
    baseUrl,
    marker,
    orderId: order.id,
    orderNumber: order.orderNumber,
    sampleIds: samples.map((s) => s.id),
    attach,
    studyId,
    samplesWithReads: study.samplesWithReads,
  };
}

main()
  .then((summary) => process.stdout.write(`researcher-lifecycle E2E OK\n${JSON.stringify(summary, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
