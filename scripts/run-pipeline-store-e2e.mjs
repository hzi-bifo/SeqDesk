#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PIPELINE_STORE_FIXTURE_V1,
  PIPELINE_STORE_FIXTURE_V2,
  PIPELINE_STORE_FIXTURE_FAULT_PHASE,
  PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY,
  pipelineStoreFixtureResourceMarker,
  provisionPipelineStoreFixtureResource,
  startPipelineStoreFixture,
} from "./lib/pipeline-store-e2e-fixture.mjs";

const APP_REQUEST_TIMEOUT_MS = 120_000;

function fail(message, details) {
  const parts = [message];
  if (details) {
    parts.push(details);
  }
  throw new Error(parts.join("\n"));
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
const fixtureUrl = args["fixture-url"];
const fixturePipelineId =
  args["fixture-pipeline-id"] || "seqdesk-store-e2e-fixture";
const expectedReadiness = args["expect-readiness"] || "ready";
const expectedExecutionMode = args["expected-execution-mode"];
const preferredPipelineIds = (args["pipeline-ids"] || "mag,submg")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!baseUrl) {
  fail("Missing required --base-url");
}
if (!["ready", "blocked"].includes(expectedReadiness)) {
  fail("--expect-readiness must be either ready or blocked");
}
if (
  expectedExecutionMode &&
  !["local", "slurm"].includes(expectedExecutionMode)
) {
  fail("--expected-execution-mode must be either local or slurm");
}

const jar = new CookieJar();

async function request(pathname, init = {}) {
  const headers = new Headers(init.headers || {});
  const cookieHeader = jar.headerValue();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const requestUrl = new URL(pathname, baseUrl);
  let response;
  try {
    response = await fetch(requestUrl, {
      ...init,
      headers,
      redirect: init.redirect || "manual",
      signal: init.signal || AbortSignal.timeout(APP_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      fail(
        `SeqDesk request timed out after ${APP_REQUEST_TIMEOUT_MS / 1000}s`,
        `${init.method || "GET"} ${requestUrl}`
      );
    }
    throw error;
  }

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

async function fetchPipelineLint(pipelineId) {
  const response = await request(
    `/api/admin/settings/pipelines/${encodeURIComponent(pipelineId)}/lint`
  );
  if (!response.ok) {
    const payload = await parseJson(response, "Pipeline lint endpoint");
    fail(
      `Pipeline lint endpoint failed (${response.status})`,
      JSON.stringify(payload, null, 2)
    );
  }
  return parseJson(response, "Pipeline lint endpoint");
}

function assert(condition, message, details) {
  if (!condition) {
    fail(message, details);
  }
}

function findInstalledPipeline(payload, pipelineId) {
  return payload.pipelines.find(
    (pipeline) => pipeline?.pipelineId === pipelineId
  );
}

function findReadinessItem(pipeline, itemId) {
  return pipeline?.readiness?.items?.find((item) => item?.id === itemId);
}

function summarizeReadiness(pipeline) {
  return {
    status: pipeline?.readiness?.status,
    summary: pipeline?.readiness?.summary,
    canEnable: pipeline?.readiness?.canEnable,
    items: Array.isArray(pipeline?.readiness?.items)
      ? pipeline.readiness.items.map((item) => ({
          id: item.id,
          status: item.status,
          blocking: item.blocking,
          detail: item.detail,
        }))
      : [],
  };
}

function resolveFixtureResourceRoot() {
  const configuredRoot =
    args["fixture-resource-root"] ||
    process.env.SEQDESK_STORE_E2E_RESOURCE_ROOT ||
    process.env.SEQDESK_DB_DIR ||
    process.env.SEQDESK_PIPELINE_DATABASE_DIR;
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }
  if (expectedExecutionMode === "slurm") {
    fail(
      "SLURM Store E2E requires a shared fixture resource root",
      "Set --fixture-resource-root, SEQDESK_STORE_E2E_RESOURCE_ROOT, SEQDESK_DB_DIR, or SEQDESK_PIPELINE_DATABASE_DIR."
    );
  }
  return path.join(os.tmpdir(), "seqdesk-store-e2e-resources");
}

async function postPipelineSettings(pipelineId, config, enabled) {
  const response = await request("/api/admin/settings/pipelines", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      pipelineId,
      config,
      enabled,
    }),
  });
  const payload = await parseJson(response, "Pipeline settings endpoint");
  return { response, payload };
}

async function fetchStore() {
  const response = await request("/api/admin/settings/pipelines/store");
  if (!response.ok) {
    const payload = await parseJson(response, "Store endpoint");
    fail(
      `Store endpoint failed (${response.status})`,
      JSON.stringify(payload, null, 2)
    );
  }
  return parseJson(response, "Store endpoint");
}

async function waitForInstalledPipeline(pipelineId) {
  let installedPayload = null;
  let installedPipeline = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    installedPayload = await fetchInstalledPipelines();
    installedPipeline = findInstalledPipeline(installedPayload, pipelineId);
    if (installedPipeline) {
      return { installedPayload, installedPipeline };
    }
    await sleep(500);
  }
  fail(
    `Installed pipeline ${pipelineId} was not exposed by the local pipeline registry`,
    JSON.stringify(installedPayload, null, 2)
  );
}

async function installStorePipeline(selectedPipeline, replace = false) {
  const response = await request("/api/admin/settings/pipelines/install", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      pipelineId: selectedPipeline.id,
      version: selectedPipeline.latestVersion || selectedPipeline.version,
      source: selectedPipeline.source,
      replace,
    }),
  });
  const payload = await parseJson(response, "Pipeline install endpoint");
  return { response, payload };
}

async function runLegacyStoreSmoke() {
  await login();

  const storePayload = await fetchStore();
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
    const install = await installStorePipeline(selectedPipeline);
    installPayload = install.payload;
    if (!install.response.ok || installPayload?.success !== true) {
      fail(
        `Pipeline install failed (${install.response.status})`,
        JSON.stringify(installPayload, null, 2)
      );
    }
  }

  const { installedPipeline } = await waitForInstalledPipeline(
    selectedPipeline.id
  );
  const definitionPayload = await fetchPipelineDefinition(selectedPipeline.id);
  if (typeof definitionPayload?.name !== "string" || !definitionPayload.name) {
    fail(
      `Pipeline definition for ${selectedPipeline.id} was not loadable after install`,
      JSON.stringify(definitionPayload, null, 2)
    );
  }

  return {
    success: true,
    mode: "registry-smoke",
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
}

async function runDeterministicFixtureE2E() {
  const fixture = await startPipelineStoreFixture({
    fixtureUrl,
    pipelineId: fixturePipelineId,
  });

  try {
    await login();

    const initialStore = await fetchStore();
    const configuredRegistry = initialStore.registries?.find(
      (registry) => registry?.registryUrl === fixture.registryUrl
    );
    assert(
      configuredRegistry,
      `The running SeqDesk app is not configured for the local fixture registry ${fixture.registryUrl}`,
      JSON.stringify(initialStore.registries, null, 2)
    );

    const selectedPipeline = initialStore.pipelines?.find(
      (pipeline) =>
        pipeline?.id === fixturePipelineId &&
        pipeline?.source?.kind === "registry" &&
        pipeline?.source?.registryUrl === fixture.registryUrl
    );
    assert(
      selectedPipeline,
      `Fixture pipeline ${fixturePipelineId} was not returned by the Store endpoint`,
      JSON.stringify(initialStore, null, 2)
    );
    assert(
      selectedPipeline.latestVersion === PIPELINE_STORE_FIXTURE_V1 &&
        selectedPipeline.source?.downloadUrl === fixture.v1Url,
      "Store did not expose the expected v1 fixture package",
      JSON.stringify(selectedPipeline, null, 2)
    );

    const installedBefore = await fetchInstalledPipelines();
    assert(
      !findInstalledPipeline(installedBefore, fixturePipelineId),
      `Fixture pipeline ${fixturePipelineId} was already installed; use a clean SEQDESK_PIPELINES_DIR or a unique --fixture-pipeline-id`,
      JSON.stringify(
        findInstalledPipeline(installedBefore, fixturePipelineId),
        null,
        2
      )
    );

    const install = await installStorePipeline(selectedPipeline);
    assert(
      install.response.status === 200 &&
        install.payload?.success === true &&
        install.payload?.action === "install" &&
        install.payload?.enabled === false,
      `Fixture pipeline installation failed (${install.response.status})`,
      JSON.stringify(install.payload, null, 2)
    );

    const { installedPipeline: beforeConfig } =
      await waitForInstalledPipeline(fixturePipelineId);
    const definitionBeforeUpdate =
      await fetchPipelineDefinition(fixturePipelineId);
    const lintBeforeUpdate = await fetchPipelineLint(fixturePipelineId);
    const requiredConfigBefore = findReadinessItem(
      beforeConfig,
      "required-config"
    );
    const databaseBefore = findReadinessItem(beforeConfig, "databases");
    const resourceProperty =
      beforeConfig?.configSchema?.properties?.[
        PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY
      ];
    assert(
      beforeConfig.enabled === false &&
        beforeConfig.version === PIPELINE_STORE_FIXTURE_V1,
      "A newly installed fixture must be v1 and disabled",
      JSON.stringify(beforeConfig, null, 2)
    );
    assert(
      requiredConfigBefore?.status === "missing" &&
        databaseBefore?.status === "missing" &&
        beforeConfig.readiness?.canEnable === false &&
        requiredConfigBefore?.detail?.includes("Fixture label") &&
        databaseBefore?.detail?.includes("Fixture database"),
      "The missing fixture configuration and database did not block activation immediately after install",
      JSON.stringify(summarizeReadiness(beforeConfig), null, 2)
    );
    assert(
      resourceProperty?.type === "string" &&
        resourceProperty?.["x-seqdesk"]?.group === "databases" &&
        beforeConfig?.config?.[PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY] ===
          "",
      "The installed fixture did not expose its required local database path",
      JSON.stringify(
        {
          property: resourceProperty,
          config:
            beforeConfig?.config?.[
              PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY
            ],
        },
        null,
        2
      )
    );
    assert(
      definitionBeforeUpdate?.pipeline === fixturePipelineId &&
        definitionBeforeUpdate?.version === PIPELINE_STORE_FIXTURE_V1 &&
        definitionBeforeUpdate?.stepCount === 1,
      "The installed v1 definition was not loadable",
      JSON.stringify(definitionBeforeUpdate, null, 2)
    );
    assert(
      lintBeforeUpdate?.result?.valid === true &&
        lintBeforeUpdate?.result?.errors === 0,
      "The installed v1 package did not pass on-disk descriptor lint",
      JSON.stringify(lintBeforeUpdate, null, 2)
    );

    const configuredValue =
      pipelineStoreFixtureResourceMarker(fixturePipelineId);
    const fixtureResource = provisionPipelineStoreFixtureResource({
      pipelineId: fixturePipelineId,
      resourceRoot: resolveFixtureResourceRoot(),
    });
    const configuredSettings = await postPipelineSettings(
      fixturePipelineId,
      {
        fixtureLabel: configuredValue,
        [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]:
          fixtureResource.linkedPath,
      },
      false
    );
    assert(
      configuredSettings.response.status === 200 &&
        configuredSettings.payload?.success === true &&
        configuredSettings.payload?.enabled === false,
      `Fixture configuration failed (${configuredSettings.response.status})`,
      JSON.stringify(configuredSettings.payload, null, 2)
    );

    const configuredPayload = await fetchInstalledPipelines();
    const configuredPipeline = findInstalledPipeline(
      configuredPayload,
      fixturePipelineId
    );
    assert(
      configuredPipeline?.config?.fixtureLabel === configuredValue &&
        configuredPipeline?.config?.[
          PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY
        ] === fixtureResource.linkedPath &&
        configuredPipeline?.enabled === false,
      "The configured value, linked resource, or disabled state was not persisted",
      JSON.stringify(configuredPipeline, null, 2)
    );
    assert(
      findReadinessItem(configuredPipeline, "required-config")?.status ===
        "ready" &&
        findReadinessItem(configuredPipeline, "databases")?.status ===
          "ready",
      "Required configuration or linked database remained incomplete after saving it",
      JSON.stringify(summarizeReadiness(configuredPipeline), null, 2)
    );
    const pipelineConfigReadiness = findReadinessItem(
      configuredPipeline,
      "pipeline-config"
    );
    assert(
      pipelineConfigReadiness &&
        pipelineConfigReadiness.status !== "missing" &&
        fs.lstatSync(fixtureResource.linkedPath).isSymbolicLink() &&
        fs.readFileSync(fixtureResource.linkedPath, "utf8").trim() ===
          configuredValue,
      "Linked fixture database did not satisfy pipeline configuration readiness",
      JSON.stringify(
        {
          resource: fixtureResource,
          pipelineConfigReadiness,
        },
        null,
        2
      )
    );
    if (expectedExecutionMode) {
      assert(
        configuredPipeline?.executionPolicy?.mode === expectedExecutionMode,
        `Fixture execution mode is ${configuredPipeline?.executionPolicy?.mode}, expected ${expectedExecutionMode}`,
        JSON.stringify(configuredPipeline?.executionPolicy, null, 2)
      );
    }

    const runtimeItemIds = [
      "runtime-nextflow",
      "runtime-java",
      configuredPipeline?.executionPolicy?.mode === "slurm"
        ? "runtime-slurm"
        : "runtime-conda",
    ];
    const runtimeItems = runtimeItemIds.map((itemId) =>
      findReadinessItem(configuredPipeline, itemId)
    );
    assert(
      runtimeItems.every(Boolean),
      "Readiness did not expose the complete runtime prerequisite set",
      JSON.stringify(summarizeReadiness(configuredPipeline), null, 2)
    );

    let activation;
    if (expectedReadiness === "ready") {
      const blockingItems = configuredPipeline.readiness?.items?.filter(
        (item) =>
          item?.id !== "enabled" &&
          item?.blocking !== false &&
          item?.status !== "ready"
      );
      assert(
        configuredPipeline.readiness?.canEnable === true &&
          blockingItems?.length === 0 &&
          runtimeItems.every((item) => item?.status === "ready"),
        "Configured fixture is not ready to enable on this runner",
        JSON.stringify(summarizeReadiness(configuredPipeline), null, 2)
      );

      activation = await postPipelineSettings(
        fixturePipelineId,
        {
          fixtureLabel: configuredValue,
          [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]:
            fixtureResource.linkedPath,
        },
        true
      );
      assert(
        activation.response.status === 200 &&
          activation.payload?.success === true &&
          activation.payload?.enabled === true,
        `Ready fixture could not be enabled (${activation.response.status})`,
        JSON.stringify(activation.payload, null, 2)
      );
    } else {
      const blockingItems = configuredPipeline.readiness?.items?.filter(
        (item) =>
          item?.id !== "enabled" &&
          item?.blocking !== false &&
          item?.status !== "ready"
      );
      assert(
        configuredPipeline.readiness?.canEnable === false &&
          blockingItems?.length > 0 &&
          runtimeItems.some((item) => item?.status !== "ready"),
        "The fixture was expected to be blocked by a missing runtime prerequisite, but runtime readiness did not provide that evidence",
        JSON.stringify(summarizeReadiness(configuredPipeline), null, 2)
      );

      activation = await postPipelineSettings(
        fixturePipelineId,
        {
          fixtureLabel: configuredValue,
          [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]:
            fixtureResource.linkedPath,
        },
        true
      );
      assert(
        activation.response.status === 422 &&
          activation.payload?.error === "Pipeline is not ready to enable",
        `Blocked fixture activation did not fail safely (${activation.response.status})`,
        JSON.stringify(activation.payload, null, 2)
      );
    }

    const activatedPayload = await fetchInstalledPipelines();
    const activatedPipeline = findInstalledPipeline(
      activatedPayload,
      fixturePipelineId
    );
    const expectedEnabled = expectedReadiness === "ready";
    assert(
      activatedPipeline?.enabled === expectedEnabled &&
        activatedPipeline?.config?.fixtureLabel === configuredValue &&
        activatedPipeline?.config?.[
          PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY
        ] === fixtureResource.linkedPath,
      "Activation changed the configured value, linked resource, or persisted the wrong enabled state",
      JSON.stringify(activatedPipeline, null, 2)
    );
    if (expectedEnabled) {
      assert(
        ["ready", "warning"].includes(
          activatedPipeline.readiness?.status
        ) &&
          activatedPipeline.readiness?.canEnable === true &&
          findReadinessItem(activatedPipeline, "enabled")?.status === "ready",
        "Enabled fixture did not remain runnable after linking its database",
        JSON.stringify(summarizeReadiness(activatedPipeline), null, 2)
      );
    }

    fixture.advertiseBrokenUpdate();
    const updateStore = await fetchStore();
    const brokenUpdate = updateStore.pipelines?.find(
      (pipeline) =>
        pipeline?.id === fixturePipelineId &&
        pipeline?.latestVersion === PIPELINE_STORE_FIXTURE_V2
    );
    assert(
      brokenUpdate?.source?.downloadUrl === fixture.v2Url,
      "Store did not expose the deliberately invalid v2 update",
      JSON.stringify(updateStore, null, 2)
    );

    const update = await installStorePipeline(brokenUpdate, true);
    const updateFailureDetail = [update.payload?.error, update.payload?.details]
      .filter((value) => typeof value === "string")
      .join("\n");
    assert(
      update.response.status === 422 &&
        updateFailureDetail.includes("definition.pipeline") &&
        updateFailureDetail.includes(PIPELINE_STORE_FIXTURE_FAULT_PHASE),
      `Faulting v2 update was not rejected after the backup swap (${update.response.status})`,
      JSON.stringify(update.payload, null, 2)
    );

    const afterRollbackPayload = await fetchInstalledPipelines();
    const afterRollback = findInstalledPipeline(
      afterRollbackPayload,
      fixturePipelineId
    );
    const definitionAfterRollback =
      await fetchPipelineDefinition(fixturePipelineId);
    const lintAfterRollback = await fetchPipelineLint(fixturePipelineId);
    assert(
      afterRollback?.version === PIPELINE_STORE_FIXTURE_V1 &&
        afterRollback?.enabled === expectedEnabled &&
        afterRollback?.config?.fixtureLabel === configuredValue &&
        afterRollback?.config?.[
          PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY
        ] === fixtureResource.linkedPath &&
        fs.lstatSync(fixtureResource.linkedPath).isSymbolicLink() &&
        fs.readFileSync(fixtureResource.linkedPath, "utf8").trim() ===
          configuredValue,
      "Failed update did not preserve the installed v1 package, configuration, linked database, and enabled state",
      JSON.stringify(afterRollback, null, 2)
    );
    assert(
      definitionAfterRollback?.pipeline === fixturePipelineId &&
        definitionAfterRollback?.version === PIPELINE_STORE_FIXTURE_V1 &&
        definitionAfterRollback?.name === definitionBeforeUpdate?.name,
      "Failed update did not preserve the loadable v1 definition",
      JSON.stringify(definitionAfterRollback, null, 2)
    );
    assert(
      lintAfterRollback?.result?.valid === true &&
        lintAfterRollback?.result?.errors === 0 &&
        lintAfterRollback?.result?.packageId === fixturePipelineId,
      "Failed update did not preserve a valid package on disk",
      JSON.stringify(lintAfterRollback, null, 2)
    );
    assert(
      afterRollback?.readiness?.canEnable ===
        activatedPipeline?.readiness?.canEnable,
      "Failed update changed pipeline readiness",
      JSON.stringify(
        {
          before: summarizeReadiness(activatedPipeline),
          after: summarizeReadiness(afterRollback),
        },
        null,
        2
      )
    );

    const fixtureRequestCounts = fixture.requests.reduce((counts, entry) => {
      counts[entry.path] = (counts[entry.path] || 0) + 1;
      return counts;
    }, {});
    assert(
      fixtureRequestCounts[new URL(fixture.v1Url).pathname] >= 1 &&
        fixtureRequestCounts[new URL(fixture.v2Url).pathname] >= 1,
      "SeqDesk did not download both fixture package versions through the real install API",
      JSON.stringify(fixture.requests, null, 2)
    );

    return {
      success: true,
      mode: "deterministic-fixture",
      baseUrl,
      fixture: {
        pipelineId: fixturePipelineId,
        registryUrl: fixture.registryUrl,
        expectedReadiness,
        expectedExecutionMode: expectedExecutionMode || null,
        requests: fixture.requests,
      },
      store: {
        sourceId: selectedPipeline.source?.sourceId,
        initialVersion: selectedPipeline.latestVersion,
        updateVersion: brokenUpdate.latestVersion,
      },
      install: {
        status: install.response.status,
        action: install.payload.action,
        enabled: install.payload.enabled,
      },
      readinessBeforeConfiguration: summarizeReadiness(beforeConfig),
      configuration: {
        status: configuredSettings.response.status,
        value: configuredValue,
        resourceConfigKey: PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY,
        resourcePath: fixtureResource.linkedPath,
      },
      resource: fixtureResource,
      readinessAfterConfiguration: summarizeReadiness(configuredPipeline),
      activation: {
        status: activation.response.status,
        enabled: activatedPipeline.enabled,
        rejectedAsNotReady: expectedReadiness === "blocked",
      },
      failedUpdate: {
        status: update.response.status,
        version: PIPELINE_STORE_FIXTURE_V2,
        details: update.payload.details,
      },
      rollback: {
        preserved: true,
        version: afterRollback.version,
        enabled: afterRollback.enabled,
        configuredValue: afterRollback.config.fixtureLabel,
        definitionVersion: definitionAfterRollback.version,
        onDiskLintValid: lintAfterRollback.result.valid,
        readiness: summarizeReadiness(afterRollback),
      },
    };
  } finally {
    await fixture.close();
  }
}

function writeResult(result) {
  if (resultFile) {
    fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  const result = fixtureUrl
    ? await runDeterministicFixtureE2E()
    : await runLegacyStoreSmoke();
  writeResult(result);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const failure = {
    success: false,
    mode: fixtureUrl ? "deterministic-fixture" : "registry-smoke",
    baseUrl,
    fixturePipelineId: fixtureUrl ? fixturePipelineId : undefined,
    error: message,
  };
  if (resultFile) {
    fs.writeFileSync(resultFile, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  }
  console.error(message);
  process.exitCode = 1;
}
