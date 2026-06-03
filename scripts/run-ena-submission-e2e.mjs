#!/usr/bin/env node

/**
 * End-to-end ENA submission against a RUNNING SeqDesk instance and the ENA TEST
 * server (wwwdev.ebi.ac.uk). Exercises the full application path:
 *
 *   log in as admin
 *     -> load dummy data (orders, studies, samples with taxonomy IDs)
 *     -> configure Webin test credentials (stored encrypted)
 *     -> submit a study (and its samples) via /api/admin/submissions
 *     -> verify ENA returned a real accession and it was written back to the DB
 *
 * Test submissions are non-permanent (the ENA test server expires them) and
 * `enaTestMode: true` keeps every request on wwwdev, never production.
 *
 * Credentials are never hard-coded — pass them as flags (CI: GitHub secrets):
 *   node scripts/run-ena-submission-e2e.mjs \
 *     --base-url http://127.0.0.1:8896 \
 *     --email admin@example.com --password admin \
 *     --webin-username Webin-XXXXX --webin-password ******
 */

function fail(message, details) {
  const parts = [message];
  if (details) parts.push(details);
  console.error(parts.join("\n"));
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) fail(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
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
  return compact.length <= 600 ? compact : `${compact.slice(0, 597)}...`;
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

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"];
const email = args.email;
const password = args.password;
const webinUsername = args["webin-username"];
const webinPassword = args["webin-password"];

for (const [key, value] of Object.entries({
  "base-url": baseUrl,
  email,
  password,
  "webin-username": webinUsername,
  "webin-password": webinPassword,
})) {
  if (!value) fail(`Missing required --${key}`);
}

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

async function requestJson(pathname, init, context) {
  const response = await request(pathname, init);
  if (!response.ok && ![302, 303].includes(response.status)) {
    fail(`${context} failed (${response.status})`, summarizeBody(await response.text()));
  }
  return response;
}

// 1. The app is up and configured.
const setupStatus = await parseJson(
  await requestJson("/api/setup/status", {}, "Setup status"),
  "Setup status",
);
if (!setupStatus?.exists || !setupStatus?.configured) {
  fail("Setup status did not report a configured database", JSON.stringify(setupStatus, null, 2));
}

// 2. Log in as the seeded administrator.
const csrf = await parseJson(await requestJson("/api/auth/csrf", {}, "CSRF"), "CSRF");
if (!csrf?.csrfToken) fail("CSRF endpoint did not return a csrfToken");

await requestJson(
  "/api/auth/callback/credentials?json=true",
  {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json, text/plain, */*",
    },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email,
      password,
      callbackUrl: new URL("/orders", baseUrl).toString(),
      json: "true",
    }).toString(),
  },
  "Credentials login",
);

const session = await parseJson(await requestJson("/api/auth/session", {}, "Session"), "Session");
if (session?.user?.email !== email) {
  fail("Login did not produce the expected session", JSON.stringify(session, null, 2));
}
if (session?.user?.role !== "FACILITY_ADMIN") {
  fail(`Expected a FACILITY_ADMIN session, got ${session?.user?.role}`);
}
console.log(`Logged in as ${email} (${session.user.role}).`);

// 3. Load dummy data (orders, studies, and samples with taxonomy IDs).
await requestJson("/api/admin/seed/dummy-data", { method: "POST" }, "Load dummy data");
console.log("Loaded dummy data.");

// 4. Configure Webin TEST credentials (stored encrypted; test mode -> wwwdev).
await requestJson(
  "/api/admin/settings/ena",
  {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enaUsername: webinUsername,
      enaPassword: webinPassword,
      enaTestMode: true,
    }),
  },
  "Configure ENA credentials",
);
console.log(`Configured ENA test credentials (${webinUsername}).`);

// 5. Pick a seeded study that has samples to submit.
const studiesPayload = await parseJson(
  await requestJson("/api/studies", {}, "List studies"),
  "List studies",
);
const studies = Array.isArray(studiesPayload)
  ? studiesPayload
  : Array.isArray(studiesPayload?.studies)
    ? studiesPayload.studies
    : [];
const study = studies.find(
  (s) => Array.isArray(s.samples) && s.samples.length > 0 && !s.studyAccessionId,
);
if (!study) {
  fail(
    "No seeded study with samples was found to submit",
    JSON.stringify(studies.map((s) => ({ id: s.id, title: s.title, samples: s.samples?.length })), null, 2),
  );
}
console.log(`Submitting study "${study.title}" (${study.id}) with ${study.samples.length} sample(s).`);

// 6. Submit the study (registers the project AND its samples) to ENA test server.
const submitResponse = await request("/api/admin/submissions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ entityType: "study", entityId: study.id, isTest: true }),
});
const submitBody = await parseJson(submitResponse, "ENA submission");
if (!submitResponse.ok) {
  fail(`ENA submission failed (${submitResponse.status})`, JSON.stringify(submitBody, null, 2));
}
console.log("Submission response:", JSON.stringify(submitBody?.message ?? submitBody, null, 2));

// 7. Verify ENA returned a real accession and it was written back to the DB.
const verifyPayload = await parseJson(
  await requestJson("/api/studies", {}, "List studies (verify)"),
  "List studies (verify)",
);
const verifyStudies = Array.isArray(verifyPayload) ? verifyPayload : verifyPayload?.studies ?? [];
const submitted = verifyStudies.find((s) => s.id === study.id);
const accession = submitted?.studyAccessionId;

if (!accession || !/^PRJ/.test(accession)) {
  fail(
    "Study was not assigned a real ENA accession after submission",
    JSON.stringify({ studyId: study.id, studyAccessionId: accession, submitBody }, null, 2),
  );
}

console.log(`OK: ENA test-server submission succeeded — study ${study.id} -> accession ${accession}.`);
