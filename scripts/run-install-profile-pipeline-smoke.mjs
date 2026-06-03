#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

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
      const key = firstPart.slice(0, separatorIndex).trim();
      const value = firstPart.slice(separatorIndex + 1).trim();
      this.#cookies.set(key, value);
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
  return compact.length <= 800 ? compact : `${compact.slice(0, 797)}...`;
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

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value) {
  return isRecord(value) ? value : {};
}

function toOptionalString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function parseJsonObject(raw, label = "JSON value") {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    fail(`Failed to parse ${label}`, error instanceof Error ? error.message : String(error));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let activeSummary = null;

function uppercaseToken(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toUpperCase();
}

function loadInstalledConfig(installDir) {
  const configPath = path.join(installDir, "seqdesk.config.json");
  if (!fsSync.existsSync(configPath)) {
    fail(`Missing installed config: ${configPath}`);
  }
  return parseJsonObject(fsSync.readFileSync(configPath, "utf8"), configPath);
}

function loadPrismaClient(installDir) {
  // The npm launcher installs the app (node_modules) under <installDir>/current
  // while seqdesk.config.json stays at <installDir>; resolve @prisma/client from
  // the release dir when present.
  const appDir = fsSync.existsSync(path.join(installDir, "current", "package.json"))
    ? path.join(installDir, "current")
    : installDir;
  const requireFromInstall = createRequire(path.join(appDir, "package.json"));
  try {
    const { PrismaClient } = requireFromInstall("@prisma/client");
    return PrismaClient;
  } catch (error) {
    fail(
      `Failed to load @prisma/client from installed app at ${appDir}`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function getSmokeTests(extra) {
  const smokeConfig = toRecord(extra.installProfilePipelineSmokeTests);
  if (toOptionalBoolean(smokeConfig.enabled) !== true) return [];
  return Array.isArray(smokeConfig.tests)
    ? smokeConfig.tests.map(toRecord).filter((test) => test.kind === "orderPipelineApiSmoke")
    : [];
}

function getFixtureOrderNumber(extra, fixtureId, profileId) {
  const seedData = toRecord(extra.installProfileSeedData);
  const fixtures = Array.isArray(seedData.fixtures) ? seedData.fixtures.map(toRecord) : [];
  const fixture = fixtures.find((item) => item.id === fixtureId);
  return (
    toOptionalString(fixture?.orderNumber) ||
    `${uppercaseToken(toOptionalString(profileId) || "profile")}-SMOKE-001`
  );
}

function parsePipelineSources(value) {
  const parsed = parseJsonObject(value, "Read.pipelineSources");
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry) => typeof entry[0] === "string" && typeof entry[1] === "string"
    )
  );
}

async function createClient(baseUrl) {
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
    callbackUrl: new URL("/orders", baseUrl).toString(),
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

async function requestJson(client, pathname, init, context) {
  const response = await client.request(pathname, init);
  if (!response.ok) {
    const body = await response.text();
    fail(`${context} failed (${response.status})`, summarizeBody(body));
  }
  return parseJson(response, context);
}

async function pollRun(client, runId, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let latest = null;
  while (Date.now() < deadline) {
    const payload = await requestJson(client, `/api/pipelines/runs/${runId}`, {}, "Pipeline run poll");
    latest = payload?.run || payload;
    const status = latest?.status;
    if (status === "completed") return latest;
    if (["failed", "cancelled", "canceled"].includes(status)) {
      fail(`Pipeline run ${runId} finished with status ${status}`, JSON.stringify(latest, null, 2));
    }
    await sleep(2000);
  }
  fail(`Pipeline run ${runId} timed out after ${timeoutSeconds}s`, JSON.stringify(latest, null, 2));
}

async function assertReadWriteback({ prisma, orderNumber, pipelineId, runId, deadline }) {
  let latestOrder = null;
  while (Date.now() < deadline) {
    latestOrder = await prisma.order.findUnique({
      where: { orderNumber },
      include: {
        samples: {
          include: {
            reads: true,
          },
        },
      },
    });
    if (!latestOrder) {
      fail(`Smoke order not found: ${orderNumber}`);
    }

    const reads = latestOrder.samples.flatMap((sample) => sample.reads || []);
    const readsWithInput = reads.filter((read) => read.file1);
    const complete =
      readsWithInput.length >= 2 &&
      readsWithInput.every((read) => {
        const sources = parsePipelineSources(read.pipelineSources);
        return Boolean(read.checksum1) && sources[pipelineId] === runId;
      });
    if (complete) {
      return readsWithInput.map((read) => ({
        id: read.id,
        file1: read.file1,
        checksum1: read.checksum1,
        pipelineRunId: parsePipelineSources(read.pipelineSources)[pipelineId],
      }));
    }
    await sleep(2000);
  }
  fail(
    `Timed out waiting for checksum writeback on order ${orderNumber}`,
    JSON.stringify(latestOrder, null, 2)
  );
}

async function runSmokeTest({ prisma, client, extra, profileId, test }) {
  const id = toOptionalString(test.id) || "pipeline-smoke";
  const pipelineId = toOptionalString(test.pipelineId);
  const fixtureId = toOptionalString(test.fixtureId);
  const timeoutSeconds =
    typeof test.timeoutSeconds === "number" && Number.isFinite(test.timeoutSeconds)
      ? Math.max(1, Math.trunc(test.timeoutSeconds))
      : 240;

  if (!pipelineId) fail(`Smoke test ${id} is missing pipelineId`);
  if (!fixtureId) fail(`Smoke test ${id} is missing fixtureId`);

  const pipelineConfig = await prisma.pipelineConfig.findUnique({ where: { pipelineId } });
  if (!pipelineConfig?.enabled) {
    fail(`Smoke test ${id} pipeline is disabled: ${pipelineId}`);
  }

  const orderNumber = getFixtureOrderNumber(extra, fixtureId, profileId);
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: {
      samples: {
        include: {
          reads: true,
        },
      },
    },
  });
  if (!order) fail(`Smoke test ${id} order not found: ${orderNumber}`);

  const createPayload = await requestJson(
    client,
    "/api/pipelines/runs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pipelineId, orderId: order.id }),
    },
    `Create pipeline run for ${id}`
  );
  const runId = createPayload?.run?.id;
  if (typeof runId !== "string" || !runId) {
    fail(`Create pipeline run for ${id} did not return run.id`, JSON.stringify(createPayload));
  }

  await requestJson(
    client,
    `/api/pipelines/runs/${runId}/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
    `Start pipeline run for ${id}`
  );

  const deadline = Date.now() + timeoutSeconds * 1000;
  const run = await pollRun(client, runId, timeoutSeconds);
  const reads = await assertReadWriteback({
    prisma,
    orderNumber,
    pipelineId,
    runId,
    deadline: Math.max(deadline, Date.now() + 30000),
  });

  return {
    id,
    pipelineId,
    fixtureId,
    orderNumber,
    runId,
    status: run.status,
    reads,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const installDir = args.dir ? path.resolve(args.dir) : "";
  const baseUrl = args["base-url"];
  const email = args.email || "admin@example.com";
  const password = args.password || "admin";
  const output = args.output ? path.resolve(args.output) : "";

  if (!installDir) fail("Missing required --dir");
  if (!baseUrl) fail("Missing required --base-url");

  const installedConfig = loadInstalledConfig(installDir);
  const databaseUrl = installedConfig?.runtime?.databaseUrl;
  const directUrl = installedConfig?.runtime?.directUrl || databaseUrl;
  if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
    fail("Installed config does not include runtime.databaseUrl");
  }
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = directUrl;

  const PrismaClient = loadPrismaClient(installDir);
  const prisma = new PrismaClient();
  const summary = {
    startedAt: new Date().toISOString(),
    installDir,
    baseUrl,
    output,
    skipped: false,
    tests: [],
  };
  activeSummary = summary;

  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: "singleton" } });
    if (!settings) fail("SiteSettings singleton is missing");

    const extra = parseJsonObject(settings.extraSettings, "SiteSettings.extraSettings");
    const profileId = toOptionalString(toRecord(extra.installProfile).id) || "unknown";
    const tests = getSmokeTests(extra);
    if (tests.length === 0) {
      summary.skipped = true;
      summary.reason = "No enabled profile pipeline smoke tests declared.";
      return summary;
    }

    const client = await createClient(baseUrl);
    await loginAdmin({ client, baseUrl, email, password });

    for (const test of tests) {
      try {
        summary.tests.push(await runSmokeTest({ prisma, client, extra, profileId, test }));
      } catch (error) {
        const required = toOptionalBoolean(test.required) !== false;
        const failure = {
          id: toOptionalString(test.id) || "pipeline-smoke",
          pipelineId: toOptionalString(test.pipelineId),
          fixtureId: toOptionalString(test.fixtureId),
          required,
          error: error instanceof Error ? error.message : String(error),
        };
        summary.tests.push(failure);
        if (required) throw error;
      }
    }

    summary.completedAt = new Date().toISOString();
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(async (summary) => {
    const serialized = JSON.stringify(summary, null, 2);
    if (summary.output) {
      await fs.writeFile(summary.output, serialized);
    }
    process.stdout.write(`${serialized}\n`);
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (activeSummary?.output) {
      activeSummary.error = message;
      activeSummary.completedAt = new Date().toISOString();
      await fs.writeFile(activeSummary.output, JSON.stringify(activeSummary, null, 2));
    }
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
