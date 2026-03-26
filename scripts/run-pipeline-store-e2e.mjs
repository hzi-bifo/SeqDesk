#!/usr/bin/env node

import fs from "node:fs";

function fail(message, details) {
  const parts = [message];
  if (details) {
    parts.push(details);
  }
  console.error(parts.join("\n"));
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }

    result[key] = value;
    index += 1;
  }

  return result;
}

function splitSetCookieHeader(headerValue) {
  if (!headerValue) {
    return [];
  }

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
      if (separatorIndex <= 0) {
        continue;
      }

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
  if (!body) {
    return "";
  }

  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length <= 400) {
    return compact;
  }
  return `${compact.slice(0, 397)}...`;
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

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"];
const resultFile = args["result-file"];
const preferredPipelineIds = (args["pipeline-ids"] || "mag,submg")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!baseUrl) {
  fail("Missing required --base-url");
}

const jar = new CookieJar();

async function request(pathname, init = {}) {
  const headers = new Headers(init.headers || {});
  const cookieHeader = jar.headerValue();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers,
    redirect: init.redirect || "manual",
  });

  jar.update(response);
  return response;
}

async function login() {
  const csrfResponse = await request("/api/auth/csrf");
  if (!csrfResponse.ok) {
    fail(`Failed to fetch CSRF token (${csrfResponse.status})`);
  }

  const csrfPayload = await parseJson(csrfResponse, "CSRF endpoint");
  const csrfToken = csrfPayload?.csrfToken;
  if (typeof csrfToken !== "string" || !csrfToken) {
    fail("CSRF endpoint did not return a csrfToken");
  }

  const form = new URLSearchParams({
    csrfToken,
    email: "admin@example.com",
    password: "admin",
    callbackUrl: new URL("/orders", baseUrl).toString(),
    json: "true",
  });

  const loginResponse = await request("/api/auth/callback/credentials?json=true", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json, text/plain, */*",
    },
    body: form.toString(),
  });

  if (!loginResponse.ok && ![302, 303].includes(loginResponse.status)) {
    const body = await loginResponse.text();
    fail(
      `Credentials login failed (${loginResponse.status})`,
      summarizeBody(body)
    );
  }

  const sessionResponse = await request("/api/auth/session");
  if (!sessionResponse.ok) {
    fail(`Failed to fetch session after login (${sessionResponse.status})`);
  }

  const sessionPayload = await parseJson(sessionResponse, "Session endpoint");
  if (
    sessionPayload?.user?.email !== "admin@example.com" ||
    sessionPayload?.user?.role !== "FACILITY_ADMIN"
  ) {
    fail(
      "Admin login did not produce the expected session",
      JSON.stringify(sessionPayload, null, 2)
    );
  }
}

function pickPipeline(payload) {
  const pipelines = Array.isArray(payload?.pipelines) ? payload.pipelines : [];

  for (const pipelineId of preferredPipelineIds) {
    const match = pipelines.find(
      (pipeline) =>
        pipeline?.id === pipelineId &&
        pipeline?.isPrivate !== true &&
        pipeline?.source?.kind === "registry" &&
        typeof pipeline?.source?.downloadUrl === "string" &&
        pipeline.source.downloadUrl.length > 0
    );
    if (match) {
      return match;
    }
  }

  return pipelines.find(
    (pipeline) =>
      pipeline?.isPrivate !== true &&
      pipeline?.source?.kind === "registry" &&
      typeof pipeline?.source?.downloadUrl === "string" &&
      pipeline.source.downloadUrl.length > 0
  );
}

async function fetchInstalledPipelines() {
  const response = await request("/api/admin/settings/pipelines");
  if (!response.ok) {
    fail(`Installed pipelines endpoint failed (${response.status})`);
  }
  const payload = await parseJson(response, "Installed pipelines endpoint");
  if (!Array.isArray(payload?.pipelines)) {
    fail("Installed pipelines endpoint did not return a pipelines array");
  }
  return payload;
}

async function fetchPipelineDefinition(pipelineId) {
  const response = await request(
    `/api/admin/settings/pipelines/${encodeURIComponent(pipelineId)}/definition`
  );
  if (!response.ok) {
    fail(`Pipeline definition endpoint failed (${response.status})`);
  }
  return parseJson(response, "Pipeline definition endpoint");
}

await login();

const storeResponse = await request("/api/admin/settings/pipelines/store");
if (!storeResponse.ok) {
  fail(`Store endpoint failed (${storeResponse.status})`);
}

const storePayload = await parseJson(storeResponse, "Store endpoint");
const selectedPipeline = pickPipeline(storePayload);
if (!selectedPipeline) {
  fail(
    `No installable public registry pipeline found for preferences: ${preferredPipelineIds.join(", ")}`,
    JSON.stringify(storePayload, null, 2)
  );
}

const installedBefore = await fetchInstalledPipelines();
const existedBefore = installedBefore.pipelines.some(
  (pipeline) => pipeline?.pipelineId === selectedPipeline.id
);

let installPayload = {
  success: true,
  action: existedBefore ? "already-installed" : "unknown",
  message: existedBefore
    ? `Pipeline ${selectedPipeline.id} was already installed before e2e verification`
    : "Installation skipped",
};

if (!existedBefore) {
  const installResponse = await request("/api/admin/settings/pipelines/install", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      pipelineId: selectedPipeline.id,
      version: selectedPipeline.latestVersion || selectedPipeline.version,
      source: selectedPipeline.source,
    }),
  });

  installPayload = await parseJson(installResponse, "Pipeline install endpoint");
  if (!installResponse.ok || installPayload?.success !== true) {
    fail(
      `Pipeline install failed (${installResponse.status})`,
      JSON.stringify(installPayload, null, 2)
    );
  }
}

let installedAfter = null;
let installedPipeline = null;
for (let attempt = 0; attempt < 10; attempt += 1) {
  installedAfter = await fetchInstalledPipelines();
  installedPipeline = installedAfter.pipelines.find(
    (pipeline) => pipeline?.pipelineId === selectedPipeline.id
  );
  if (installedPipeline) {
    break;
  }
  await sleep(500);
}

if (!installedPipeline) {
  fail(
    `Installed pipeline ${selectedPipeline.id} was not exposed by the local pipeline registry`,
    JSON.stringify(installedAfter, null, 2)
  );
}

const definitionPayload = await fetchPipelineDefinition(selectedPipeline.id);
if (typeof definitionPayload?.name !== "string" || !definitionPayload.name) {
  fail(
    `Pipeline definition for ${selectedPipeline.id} was not loadable after install`,
    JSON.stringify(definitionPayload, null, 2)
  );
}

const result = {
  baseUrl,
  selectedPipeline: {
    id: selectedPipeline.id,
    version: selectedPipeline.latestVersion || selectedPipeline.version,
    sourceKind: selectedPipeline.source?.kind,
    downloadUrl: selectedPipeline.source?.downloadUrl,
  },
  existedBefore,
  installAction: installPayload.action,
  installMessage: installPayload.message,
  registryPipeline: {
    pipelineId: installedPipeline.pipelineId,
    name: installedPipeline.name,
    version: installedPipeline.version,
    category: installedPipeline.category,
  },
  definition: {
    name: definitionPayload?.name,
    stepCount: definitionPayload?.stepCount,
    parameterGroupCount: definitionPayload?.parameterGroupCount,
  },
};

if (resultFile) {
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
