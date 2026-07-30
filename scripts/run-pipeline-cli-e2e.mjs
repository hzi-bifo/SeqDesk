#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PIPELINE_CLI_E2E_FIXTURE_ID,
  PIPELINE_STORE_FIXTURE_V1,
  PIPELINE_STORE_FIXTURE_V2,
  PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY,
  pipelineStoreFixtureResourceMarker,
  provisionPipelineStoreFixtureResource,
  startPipelineStoreFixture,
} from "./lib/pipeline-store-e2e-fixture.mjs";

const CONCURRENT_FIXTURE_ID = "seqdesk-cli-browser-concurrent-e2e-fixture";
const COMMAND_TIMEOUT_MS = 180_000;

function fail(message, details) {
  throw new Error(details ? `${message}\n${details}` : message);
}

function assert(condition, message, details) {
  if (!condition) fail(message, details);
}

export function parsePipelineCliE2EArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for ${token}`);
    }
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function parseJsonDocument(text, context) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(
      `${context} did not produce one valid JSON document`,
      `${error instanceof Error ? error.message : String(error)}\n${text}`
    );
  }
}

function runCommand(command, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `${command} ${argv.join(" ")} timed out after ${
            COMMAND_TIMEOUT_MS / 1000
          }s`
        )
      );
    }, COMMAND_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code: code ?? 1,
        signal: signal || null,
        stdout,
        stderr,
      });
    });
  });
}

async function runCli(context, argv, options = {}) {
  const result = await runCommand(context.seqdeskCommand, argv, {
    cwd: context.neutralCwd,
    env: {
      ...process.env,
      ...context.fixtureEnv,
    },
  });
  const payload = result.stdout.trim()
    ? parseJsonDocument(result.stdout, `seqdesk ${argv.join(" ")}`)
    : null;
  if (options.expectSuccess !== false) {
    assert(
      result.code === 0 && payload?.success === true,
      `seqdesk ${argv.join(" ")} failed`,
      JSON.stringify(result, null, 2)
    );
  }
  return { ...result, payload };
}

async function runHumanCli(context, argv) {
  const result = await runCommand(context.seqdeskCommand, argv, {
    cwd: context.neutralCwd,
    env: {
      ...process.env,
      ...context.fixtureEnv,
    },
  });
  assert(
    result.code === 0,
    `seqdesk ${argv.join(" ")} failed`,
    JSON.stringify(result, null, 2)
  );
  return result;
}

function getPipelines(payload) {
  return Array.isArray(payload?.pipelines) ? payload.pipelines : [];
}

function getPipeline(payload) {
  return (
    payload?.pipeline ||
    payload?.status ||
    payload?.result?.pipeline ||
    payload?.result?.status ||
    null
  );
}

function getPipelineId(pipeline) {
  return pipeline?.pipelineId || pipeline?.id;
}

function readinessItems(pipeline) {
  return Array.isArray(pipeline?.readiness?.items)
    ? pipeline.readiness.items
    : [];
}

function findReadiness(pipeline, id) {
  return readinessItems(pipeline).find((item) => item?.id === id);
}

function packageVersion(pipeline) {
  return (
    pipeline?.installedVersion ||
    pipeline?.version ||
    pipeline?.packageVersion ||
    null
  );
}

class CookieJar {
  #cookies = new Map();

  update(response) {
    const values =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : (response.headers.get("set-cookie") || "").split(
            /,(?=\s*[^;,=\s]+=[^;,]+)/
          );
    for (const value of values) {
      const pair = value.split(";")[0];
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.#cookies.set(
          pair.slice(0, separator).trim(),
          pair.slice(separator + 1).trim()
        );
      }
    }
  }

  header() {
    return Array.from(this.#cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }
}

async function createAdminClient(baseUrl) {
  const jar = new CookieJar();
  const request = async (pathname, init = {}) => {
    const headers = new Headers(init.headers || {});
    const cookie = jar.header();
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(new URL(pathname, baseUrl), {
      ...init,
      headers,
      redirect: init.redirect || "manual",
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
    jar.update(response);
    return response;
  };
  const json = async (pathname, init = {}) => {
    const response = await request(pathname, init);
    const text = await response.text();
    const payload = text
      ? parseJsonDocument(text, `${init.method || "GET"} ${pathname}`)
      : null;
    return { response, payload };
  };

  const csrf = await json("/api/auth/csrf");
  assert(csrf.response.ok && csrf.payload?.csrfToken, "Could not fetch CSRF token");
  const body = new URLSearchParams({
    csrfToken: csrf.payload.csrfToken,
    email: "admin@example.com",
    password: "admin",
    callbackUrl: new URL("/orders", baseUrl).toString(),
    json: "true",
  });
  const login = await request("/api/auth/callback/credentials?json=true", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json, text/plain, */*",
    },
    body: body.toString(),
  });
  assert(
    login.ok || login.status === 302 || login.status === 303,
    `Admin login failed (${login.status})`
  );
  const session = await json("/api/auth/session");
  assert(
    session.payload?.user?.role === "FACILITY_ADMIN",
    "Admin login did not create a facility-admin session",
    JSON.stringify(session.payload, null, 2)
  );
  return { json };
}

function findApiPipeline(payload, pipelineId) {
  return getPipelines(payload).find(
    (pipeline) => getPipelineId(pipeline) === pipelineId
  );
}

async function readInstalledViaApi(client, pipelineId) {
  const result = await client.json("/api/admin/settings/pipelines");
  assert(
    result.response.ok,
    `Installed pipeline API failed (${result.response.status})`,
    JSON.stringify(result.payload, null, 2)
  );
  return findApiPipeline(result.payload, pipelineId);
}

function assertNoInstallDebris(pipelinesDir, pipelineId) {
  const packageDebris = fs
    .readdirSync(pipelinesDir)
    .filter(
      (name) =>
        name.includes(`${pipelineId}.__tmp-`) ||
        name.includes(`${pipelineId}.__backup-`)
    );
  const lockRoot = path.join(pipelinesDir, ".seqdesk-install-locks");
  const lockDebris = fs.existsSync(lockRoot)
    ? fs
        .readdirSync(lockRoot)
        .filter(
          (name) =>
            name === `${pipelineId}.lock` ||
            name.startsWith(`${pipelineId}.lock.stale-`)
        )
        .map((name) => path.join(".seqdesk-install-locks", name))
    : [];
  const debris = [...packageDebris, ...lockDebris];
  assert(
    debris.length === 0,
    `Concurrent install left working directories for ${pipelineId}`,
    JSON.stringify(debris)
  );
}

async function runPrimaryCliFlow(context, client, fixture) {
  const pipelineId = PIPELINE_CLI_E2E_FIXTURE_ID;
  const packageDir = path.join(context.installDir, "pipelines", pipelineId);
  assert(
    !fs.existsSync(packageDir),
    `${pipelineId} was already prepared in the fresh install`
  );
  assert(
    fs.existsSync(path.join(context.installDir, "current")),
    "The CLI gate requires a versioned releases/current installation"
  );

  const initialList = await runCli(context, [
    "pipelines",
    "list",
    "--json",
  ]);
  const available = getPipelines(initialList.payload).find(
    (pipeline) => getPipelineId(pipeline) === pipelineId
  );
  assert(
    available?.packageState === "available" &&
      (available?.targets || []).includes("order"),
    "Neutral-directory list did not expose the order fixture as available",
    JSON.stringify(available, null, 2)
  );

  const humanList = await runHumanCli(context, ["pipelines", "list"]);
  for (const expectedText of [
    "PIPELINE",
    "TARGETS",
    "PACKAGE",
    "SETUP",
    "ACTIVE",
    "NEXT",
    "What to do next:",
    "seqdesk pipelines install <pipeline-id>",
    "seqdesk pipelines status <pipeline-id>",
    "https://seqdesk.org/docs/pipelines/installing-pipelines",
  ]) {
    assert(
      humanList.stdout.includes(expectedText),
      `Human pipeline list did not include ${expectedText}`,
      humanList.stdout
    );
  }

  const orderList = await runCli(context, [
    "pipelines",
    "list",
    "--catalog",
    "order",
    "--json",
  ]);
  const studyList = await runCli(context, [
    "pipelines",
    "list",
    "--catalog",
    "study",
    "--json",
  ]);
  assert(
    getPipelines(orderList.payload).some(
      (pipeline) => getPipelineId(pipeline) === pipelineId
    ) &&
      !getPipelines(studyList.payload).some(
        (pipeline) => getPipelineId(pipeline) === pipelineId
      ),
    "Catalog filters did not preserve the manifest-derived order target"
  );

  const install = await runCli(context, [
    "pipelines",
    "install",
    pipelineId,
    "--json",
  ]);
  assert(fs.existsSync(packageDir), "CLI install did not create the package");

  const blocked = await runCli(context, [
    "pipelines",
    "status",
    pipelineId,
    "--json",
  ]);
  const blockedPipeline = getPipeline(blocked.payload);
  assert(
    blockedPipeline &&
      blockedPipeline.activationState === "disabled" &&
      blockedPipeline.readiness?.canEnable === false &&
      findReadiness(blockedPipeline, "required-config")?.status === "missing" &&
      findReadiness(blockedPipeline, "databases")?.status === "missing",
    "Fresh CLI install did not report missing configuration and database",
    JSON.stringify(blockedPipeline, null, 2)
  );

  const marker = pipelineStoreFixtureResourceMarker(pipelineId);
  const resource = provisionPipelineStoreFixtureResource({
    pipelineId,
    resourceRoot: context.resourceRoot,
  });
  const setup = await runCli(context, [
    "pipelines",
    "setup",
    pipelineId,
    "--config-json",
    JSON.stringify({
      fixtureLabel: marker,
      [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]: resource.linkedPath,
    }),
    "--json",
  ]);
  const readyPipeline = getPipeline(setup.payload);
  assert(
    readyPipeline?.setupState === "ready" &&
      readyPipeline?.activationState === "enabled" &&
      readyPipeline?.readiness?.canEnable === true,
    "CLI setup did not enable the fully ready fixture",
    JSON.stringify(readyPipeline, null, 2)
  );

  const apiPipeline = await readInstalledViaApi(client, pipelineId);
  assert(
    apiPipeline?.enabled === true &&
      apiPipeline?.config?.fixtureLabel === marker &&
      apiPipeline?.config?.[PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY] ===
        resource.linkedPath,
    "The running browser app did not observe the CLI-installed package/configuration",
    JSON.stringify(apiPipeline, null, 2)
  );

  const beforeRepeatManifest = fs.readFileSync(
    path.join(packageDir, "manifest.json"),
    "utf8"
  );
  const repeat = await runCli(context, [
    "pipelines",
    "install",
    pipelineId,
    "--json",
  ]);
  const afterRepeatManifest = fs.readFileSync(
    path.join(packageDir, "manifest.json"),
    "utf8"
  );
  assert(
    repeat.payload?.action === "noop" &&
      beforeRepeatManifest === afterRepeatManifest,
    "Repeated install was not an idempotent no-op",
    JSON.stringify(repeat.payload, null, 2)
  );
  const afterRepeatApiPipeline = await readInstalledViaApi(client, pipelineId);
  assert(
    afterRepeatApiPipeline?.enabled === true &&
      afterRepeatApiPipeline?.config?.fixtureLabel === marker &&
      afterRepeatApiPipeline?.config?.[
        PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY
      ] === resource.linkedPath,
    "Repeated install changed the saved setup or activation",
    JSON.stringify(afterRepeatApiPipeline, null, 2)
  );
  const installedOnly = await runCli(context, [
    "pipelines",
    "list",
    "--installed",
    "--json",
  ]);
  assert(
    getPipelines(installedOnly.payload).some(
      (pipeline) =>
        getPipelineId(pipeline) === pipelineId &&
        pipeline.packageState === "installed" &&
        pipeline.activationState === "enabled"
    ),
    "--installed did not expose the CLI-installed, enabled fixture",
    JSON.stringify(installedOnly.payload, null, 2)
  );

  fixture.advertiseBrokenUpdate();
  const brokenUpdate = await runCli(
    context,
    ["pipelines", "install", pipelineId, "--json"],
    { expectSuccess: false }
  );
  assert(
    brokenUpdate.code !== 0 && brokenUpdate.payload?.success === false,
    "Broken CLI update unexpectedly succeeded",
    JSON.stringify(brokenUpdate, null, 2)
  );
  const afterRollback = await runCli(context, [
    "pipelines",
    "status",
    pipelineId,
    "--json",
  ]);
  const rollbackPipeline = getPipeline(afterRollback.payload);
  assert(
    packageVersion(rollbackPipeline) === PIPELINE_STORE_FIXTURE_V1 &&
      rollbackPipeline?.activationState === "enabled" &&
      fs.readFileSync(path.join(packageDir, "manifest.json"), "utf8") ===
        beforeRepeatManifest,
    "Broken CLI update did not preserve v1 and its enabled state",
    JSON.stringify(rollbackPipeline, null, 2)
  );

  return {
    pipelineId,
    marker,
    resource,
    initialPackageState: available.packageState,
    installAction: install.payload?.action || install.payload?.result?.action,
    repeatAction: repeat.payload?.action || repeat.payload?.result?.action,
    rollbackVersion: packageVersion(rollbackPipeline),
    rollbackFailure: brokenUpdate.payload?.error,
  };
}

async function runConcurrentBrowserCliInstall(context, client, fixture) {
  const pipelineId = CONCURRENT_FIXTURE_ID;
  const store = await client.json("/api/admin/settings/pipelines/store");
  assert(
    store.response.ok,
    `Store endpoint failed before concurrent install (${store.response.status})`,
    JSON.stringify(store.payload, null, 2)
  );
  const selected = getPipelines(store.payload).find(
    (pipeline) => pipeline?.id === pipelineId
  );
  assert(selected, "Concurrent fixture was not available to the browser API");

  const cliPromise = runCli(
    context,
    ["pipelines", "install", pipelineId, "--json"],
    { expectSuccess: false }
  );
  const apiPromise = client.json("/api/admin/settings/pipelines/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pipelineId,
      version: selected.latestVersion || selected.version,
      source: selected.source,
    }),
  });
  const [cli, api] = await Promise.all([cliPromise, apiPromise]);
  const cliSucceeded = cli.code === 0 && cli.payload?.success === true;
  const apiSucceeded = api.response.ok && api.payload?.success === true;
  assert(
    cliSucceeded || apiSucceeded,
    "Concurrent browser/CLI install left no successful installer",
    JSON.stringify({ cli, api: { status: api.response.status, body: api.payload } }, null, 2)
  );

  const packageDir = path.join(context.installDir, "pipelines", pipelineId);
  const manifest = parseJsonDocument(
    fs.readFileSync(path.join(packageDir, "manifest.json"), "utf8"),
    "Concurrent fixture manifest"
  );
  assert(
    manifest?.package?.id === pipelineId &&
      manifest?.package?.version === PIPELINE_STORE_FIXTURE_V1,
    "Concurrent install did not leave one valid v1 package",
    JSON.stringify(manifest, null, 2)
  );
  assertNoInstallDebris(path.dirname(packageDir), pipelineId);
  const apiPipeline = await readInstalledViaApi(client, pipelineId);
  assert(
    apiPipeline?.version === PIPELINE_STORE_FIXTURE_V1,
    "Running app cache did not converge on the concurrently installed package",
    JSON.stringify(apiPipeline, null, 2)
  );

  return {
    pipelineId,
    cli: { status: cli.code, success: cliSucceeded },
    browserApi: { status: api.response.status, success: apiSucceeded },
    installedVersion: manifest.package.version,
    requests: fixture.requests,
  };
}

export async function runPipelineCliE2E(rawArgs) {
  const args = parsePipelineCliE2EArgs(rawArgs);
  const installDir = path.resolve(args["install-dir"] || "");
  const seqdeskCommand = path.resolve(args["seqdesk-command"] || "");
  const fixtureUrl = args["fixture-url"];
  const baseUrl = args["base-url"];
  const resultFile = args["result-file"];
  const resourceRoot = path.resolve(args["fixture-resource-root"] || "");
  if (!args["install-dir"]) fail("Missing --install-dir");
  if (!args["seqdesk-command"]) fail("Missing --seqdesk-command");
  if (!fixtureUrl) fail("Missing --fixture-url");
  if (!baseUrl) fail("Missing --base-url");
  if (!args["fixture-resource-root"]) fail("Missing --fixture-resource-root");
  assert(fs.existsSync(seqdeskCommand), `seqdesk command not found: ${seqdeskCommand}`);
  assert(fs.existsSync(installDir), `SeqDesk install not found: ${installDir}`);

  const createdNeutralCwd = !args["neutral-cwd"];
  const neutralCwd = args["neutral-cwd"]
    ? path.resolve(args["neutral-cwd"])
    : fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-cli-neutral-"));
  fs.mkdirSync(neutralCwd, { recursive: true });
  const client = await createAdminClient(baseUrl);
  const context = {
    installDir,
    seqdeskCommand,
    neutralCwd,
    resourceRoot,
    fixtureEnv: {},
  };

  let primaryFixture;
  let concurrentFixture;
  try {
    primaryFixture = await startPipelineStoreFixture({
      fixtureUrl,
      pipelineId: PIPELINE_CLI_E2E_FIXTURE_ID,
    });
    context.fixtureEnv = {
      SEQDESK_PIPELINE_REGISTRY_URL: primaryFixture.registryUrl,
      SEQDESK_PLAYWRIGHT_STORE_FIXTURE_URL: fixtureUrl,
      SEQDESK_PIPELINE_STORE_E2E_FAULTS: "1",
    };
    const primary = await runPrimaryCliFlow(context, client, primaryFixture);
    await primaryFixture.close();
    primaryFixture = null;

    concurrentFixture = await startPipelineStoreFixture({
      fixtureUrl,
      pipelineId: CONCURRENT_FIXTURE_ID,
    });
    context.fixtureEnv = {
      ...context.fixtureEnv,
      SEQDESK_PIPELINE_REGISTRY_URL: concurrentFixture.registryUrl,
    };
    const concurrent = await runConcurrentBrowserCliInstall(
      context,
      client,
      concurrentFixture
    );

    const result = {
      success: true,
      installDir,
      neutralCwd,
      autodiscovery: true,
      primary,
      concurrent,
      versions: {
        installed: PIPELINE_STORE_FIXTURE_V1,
        rejectedUpdate: PIPELINE_STORE_FIXTURE_V2,
      },
    };
    if (resultFile) {
      fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`);
    }
    return result;
  } finally {
    await primaryFixture?.close();
    await concurrentFixture?.close();
    if (createdNeutralCwd) {
      fs.rmSync(neutralCwd, { recursive: true, force: true });
    }
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  try {
    const result = await runPipelineCliE2E(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const args = parsePipelineCliE2EArgs(process.argv.slice(2));
    if (args["result-file"]) {
      fs.writeFileSync(
        args["result-file"],
        `${JSON.stringify({ success: false, error: message }, null, 2)}\n`
      );
    }
    console.error(message);
    process.exitCode = 1;
  }
}
