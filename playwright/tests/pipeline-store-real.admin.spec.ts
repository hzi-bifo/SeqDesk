import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import {
  PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY,
  PIPELINE_STORE_FIXTURE_DATABASE_ID,
  PIPELINE_STORE_FIXTURE_DATABASE_FILE_NAME,
  PIPELINE_STORE_FIXTURE_DATABASE_PATH,
  PIPELINE_STORE_FIXTURE_DATABASE_SHA256,
  PIPELINE_STORE_FIXTURE_ID,
  PIPELINE_STORE_FIXTURE_V1,
  PIPELINE_STORE_FIXTURE_V2,
  buildValidPipelineStorePackage,
  pipelineStoreFixtureResourceMarker,
  provisionPipelineStoreFixtureResource,
  startPipelineStoreFixture,
} from "../../scripts/lib/pipeline-store-e2e-fixture.mjs";
import { advancePipelinePackageGeneration } from "../../src/lib/pipelines/package-cache-generation";

const fixtureUrl = process.env.SEQDESK_PLAYWRIGHT_STORE_FIXTURE_URL;
const PIPELINE_ID = PIPELINE_STORE_FIXTURE_ID;
const CONFIGURED_LABEL = pipelineStoreFixtureResourceMarker(PIPELINE_ID);
const TEST_RESOURCE_PREFIX = "seqdesk-playwright-store-resource-";
const LOCAL_PIPELINES_ROOT_PREFIX = "seqdesk-playwright-pipelines.";
const CI_PIPELINES_ROOT_NAME = "playwright-real-store-pipelines";
const DATABASE_STATE_FILES = [
  ".pipeline-database-downloads.json",
  ".pipeline-database-download-status.json",
  ".pipeline-database-download-logs",
] as const;

interface SiteSettingsSnapshot {
  exists: boolean;
  extraSettings: string | null;
}

interface PipelineExecutionPaths {
  pipelineRunDir: string;
  pipelineDatabaseDir: string;
}

interface PipelineStoreCatalogResponse {
  pipelines?: Array<{ id?: string }>;
}

function getIsolatedPipelinesRoot() {
  const configuredRoot = process.env.SEQDESK_PIPELINES_DIR;
  if (!configuredRoot) {
    throw new Error(
      "SEQDESK_PIPELINES_DIR is required for the real Pipeline Store browser fixture.",
    );
  }

  const resolvedRoot = path.resolve(configuredRoot);
  if (resolvedRoot === path.parse(resolvedRoot).root) {
    throw new Error(
      `Refusing to use the filesystem root as a Pipeline Store root: ${resolvedRoot}`,
    );
  }
  const rootName = path.basename(resolvedRoot);
  const explicitlyAllowedRoot =
    process.env.SEQDESK_PLAYWRIGHT_STORE_PIPELINES_ROOT;
  const matchesExplicitRoot =
    explicitlyAllowedRoot !== undefined &&
    path.resolve(explicitlyAllowedRoot) === resolvedRoot;
  if (
    !matchesExplicitRoot &&
    rootName !== CI_PIPELINES_ROOT_NAME &&
    !rootName.startsWith(LOCAL_PIPELINES_ROOT_PREFIX)
  ) {
    throw new Error(
      `Refusing to clean a non-isolated Pipeline Store root: ${resolvedRoot}`,
    );
  }
  return resolvedRoot;
}

async function removeInstalledFixtureState() {
  const pipelinesRoot = getIsolatedPipelinesRoot();
  if (fs.existsSync(pipelinesRoot)) {
    for (const entry of fs.readdirSync(pipelinesRoot)) {
      const isFixturePath =
        entry === PIPELINE_ID ||
        entry.startsWith(`${PIPELINE_ID}.__tmp-`) ||
        entry.startsWith(`${PIPELINE_ID}.__backup-`);
      if (!isFixturePath) continue;

      const target = path.resolve(pipelinesRoot, entry);
      if (path.dirname(target) !== pipelinesRoot) {
        throw new Error(
          `Refusing to remove a Pipeline Store path outside the isolated root: ${target}`,
        );
      }
      fs.rmSync(target, { recursive: true, force: true });
    }
    for (const stateFile of DATABASE_STATE_FILES) {
      fs.rmSync(path.join(pipelinesRoot, stateFile), {
        recursive: true,
        force: true,
      });
    }
  }
  // The app process keeps an in-memory package index. Manual fixture cleanup
  // must advance the shared generation marker so repeat/retry workers do not
  // keep treating the removed fixture as installed.
  await advancePipelinePackageGeneration(pipelinesRoot);

  const prisma = new PrismaClient();
  try {
    await prisma.pipelineConfig.deleteMany({
      where: { pipelineId: PIPELINE_ID },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function readSiteSettingsSnapshot(): Promise<SiteSettingsSnapshot> {
  const prisma = new PrismaClient();
  try {
    const settings = await prisma.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    return {
      exists: settings !== null,
      extraSettings: settings?.extraSettings ?? null,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function withPipelineExecutionPaths(
  extraSettings: string | null,
  pipelineRunDir: string,
  pipelineDatabaseDir: string,
): string {
  let extra: Record<string, unknown> = {};
  if (extraSettings) {
    try {
      const parsed = JSON.parse(extraSettings);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extra = parsed as Record<string, unknown>;
      }
    } catch {
      // The real settings API also recovers from malformed legacy JSON.
    }
  }
  const pipelineExecution =
    extra.pipelineExecution &&
    typeof extra.pipelineExecution === "object" &&
    !Array.isArray(extra.pipelineExecution)
      ? (extra.pipelineExecution as Record<string, unknown>)
      : {};

  return JSON.stringify({
    ...extra,
    pipelineExecution: {
      ...pipelineExecution,
      pipelineRunDir,
      pipelineDatabaseDir,
    },
  });
}

async function setPipelineExecutionPaths(
  pipelineRunDir: string,
  pipelineDatabaseDir: string,
): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const current = await prisma.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    const extraSettings = withPipelineExecutionPaths(
      current?.extraSettings ?? null,
      pipelineRunDir,
      pipelineDatabaseDir,
    );
    await prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", extraSettings },
      update: { extraSettings },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function restoreSiteSettings(
  snapshot: SiteSettingsSnapshot,
  persistentHandoff?: PipelineExecutionPaths,
): Promise<void> {
  const prisma = new PrismaClient();
  try {
    if (!snapshot.exists && !persistentHandoff) {
      await prisma.siteSettings.deleteMany({ where: { id: "singleton" } });
      return;
    }

    const extraSettings = persistentHandoff
      ? withPipelineExecutionPaths(
          snapshot.extraSettings,
          persistentHandoff.pipelineRunDir,
          persistentHandoff.pipelineDatabaseDir,
        )
      : snapshot.extraSettings;
    await prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", extraSettings },
      update: { extraSettings },
    });
  } finally {
    await prisma.$disconnect();
  }
}

function resolvePersistentHandoffPaths(
  temporaryResourceRoot: string,
): PipelineExecutionPaths | undefined {
  const rawRunDirectory =
    process.env.SEQDESK_PLAYWRIGHT_HANDOFF_RUN_DIR?.trim();
  const rawDatabaseDirectory =
    process.env.SEQDESK_PLAYWRIGHT_HANDOFF_DATABASE_DIR?.trim();
  if (!rawRunDirectory && !rawDatabaseDirectory) return undefined;
  if (!rawRunDirectory || !rawDatabaseDirectory) {
    throw new Error(
      "Pipeline Store handoff requires both SEQDESK_PLAYWRIGHT_HANDOFF_RUN_DIR and SEQDESK_PLAYWRIGHT_HANDOFF_DATABASE_DIR.",
    );
  }

  const resolveDirectory = (value: string, label: string): string => {
    if (!path.isAbsolute(value)) {
      throw new Error(`${label} must be absolute: ${value}`);
    }
    const resolved = path.resolve(value);
    if (resolved === path.parse(resolved).root) {
      throw new Error(`${label} cannot be the filesystem root: ${resolved}`);
    }
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      throw new Error(`${label} is not a directory: ${resolved}`);
    }
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    return resolved;
  };

  const handoff = {
    pipelineRunDir: resolveDirectory(
      rawRunDirectory,
      "Persistent Pipeline Store run-directory handoff",
    ),
    pipelineDatabaseDir: resolveDirectory(
      rawDatabaseDirectory,
      "Persistent Pipeline Store database-directory handoff",
    ),
  };
  const resolvedTemporaryRoot = path.resolve(temporaryResourceRoot);
  for (const [label, directory] of Object.entries(handoff)) {
    if (
      directory === resolvedTemporaryRoot ||
      directory.startsWith(`${resolvedTemporaryRoot}${path.sep}`)
    ) {
      throw new Error(
        `${label} cannot point into the disposable Pipeline Store resource root: ${directory}`,
      );
    }
  }
  return handoff;
}

function resolveReadyRuntimeDirectory(resourceRoot: string): string {
  const configured =
    process.env.SEQDESK_PLAYWRIGHT_RUNTIME_READY_DIR?.trim();
  if (configured && !path.isAbsolute(configured)) {
    throw new Error(
      `Playwright runtime directory must be absolute: ${configured}`,
    );
  }
  const resolved = path.resolve(
    configured || path.join(resourceRoot, "runtime-ready"),
  );
  if (resolved === path.parse(resolved).root) {
    throw new Error(`Unsafe Playwright runtime directory: ${resolved}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

async function loginAsSeededAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/orders$/);
}

async function waitForFixtureStoreCatalog(page: Page): Promise<void> {
  const response = await page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname ===
        "/api/admin/settings/pipelines/store" &&
      candidate.request().method() === "GET",
    { timeout: 60_000 },
  );
  if (!response.ok()) {
    throw new Error(
      `Pipeline Store catalog request failed (${response.status()}): ${await response.text()}`,
    );
  }

  const catalog = (await response.json()) as PipelineStoreCatalogResponse;
  expect(
    catalog.pipelines?.some((pipeline) => pipeline.id === PIPELINE_ID),
    `Pipeline Store catalog did not contain the fixture ${PIPELINE_ID}`,
  ).toBe(true);
}

function removeTestResourceRoot(resourceRoot: string) {
  const resolvedRoot = path.resolve(resourceRoot);
  const resolvedTempRoot = path.resolve(os.tmpdir());
  if (
    path.dirname(resolvedRoot) !== resolvedTempRoot ||
    !path.basename(resolvedRoot).startsWith(TEST_RESOURCE_PREFIX)
  ) {
    throw new Error(
      `Refusing to remove a non-test Pipeline Store resource root: ${resolvedRoot}`,
    );
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

async function readFixtureDatabaseJobState(
  page: Page,
): Promise<"running" | "success" | "error" | null> {
  const response = await page.request.get("/api/admin/settings/pipelines");
  if (!response.ok()) {
    throw new Error(
      `Could not inspect Pipeline Store cleanup state (${response.status()}): ${await response.text()}`,
    );
  }
  const payload = await response.json();
  const pipeline = payload.pipelines?.find(
    (entry: { pipelineId?: string }) => entry.pipelineId === PIPELINE_ID,
  );
  const database = pipeline?.databaseDownloads?.find(
    (entry: { id?: string }) =>
      entry.id === PIPELINE_STORE_FIXTURE_DATABASE_ID,
  );
  const state = database?.job?.state;
  return state === "running" || state === "success" || state === "error"
    ? state
    : null;
}

async function waitForFixtureDatabaseJobToStop(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if ((await readFixtureDatabaseJobState(page)) !== "running") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return false;
}

async function ensureFixtureDatabaseDownloadStopped(
  page: Page,
  targetPath: string,
): Promise<void> {
  if (await waitForFixtureDatabaseJobToStop(page, 10_000)) return;

  const cancelResponse = await page.request.post(
    "/api/admin/settings/pipelines/download-db/cancel",
    {
      data: {
        pipelineId: PIPELINE_ID,
        databaseId: PIPELINE_STORE_FIXTURE_DATABASE_ID,
      },
    },
  );
  if (!cancelResponse.ok() && cancelResponse.status() !== 409) {
    throw new Error(
      `Could not cancel the Pipeline Store fixture database download (${cancelResponse.status()}): ${await cancelResponse.text()}`,
    );
  }
  if (!(await waitForFixtureDatabaseJobToStop(page, 10_000))) {
    throw new Error(
      "Pipeline Store fixture database download remained active after cancellation.",
    );
  }
  await expect
    .poll(() => fs.existsSync(targetPath), { timeout: 10_000 })
    .toBe(false);
}

function removeFixtureDatabaseTarget(
  targetPath: string,
  databaseRoot: string,
): void {
  const resolvedRoot = path.resolve(databaseRoot);
  const expectedTarget = path.join(
    resolvedRoot,
    PIPELINE_ID,
    PIPELINE_STORE_FIXTURE_DATABASE_ID,
    PIPELINE_STORE_FIXTURE_DATABASE_FILE_NAME,
  );
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== expectedTarget) {
    throw new Error(
      `Refusing to remove unexpected Pipeline Store database target: ${resolvedTarget}`,
    );
  }

  fs.rmSync(resolvedTarget, { force: true });
  for (const directory of [
    path.dirname(resolvedTarget),
    path.join(resolvedRoot, PIPELINE_ID),
  ]) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    }
  }
}

function collectRegularPackageFiles(
  packageDirectory: string,
  currentDirectory = packageDirectory,
): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(currentDirectory)) {
    const entryPath = path.join(currentDirectory, entry);
    const stats = fs.lstatSync(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Restored Pipeline Store package contains a symbolic link: ${entryPath}`,
      );
    }
    if (stats.isDirectory()) {
      files.push(...collectRegularPackageFiles(packageDirectory, entryPath));
      continue;
    }
    if (!stats.isFile()) {
      throw new Error(
        `Restored Pipeline Store package contains a non-regular file: ${entryPath}`,
      );
    }
    files.push(path.relative(packageDirectory, entryPath));
  }
  return files.sort();
}

function assertActiveFixturePackageOnDisk(): string {
  const pipelinesRoot = getIsolatedPipelinesRoot();
  const packageDirectory = path.resolve(pipelinesRoot, PIPELINE_ID);
  if (path.dirname(packageDirectory) !== pipelinesRoot) {
    throw new Error(
      `Fixture package escaped the isolated Pipeline Store root: ${packageDirectory}`,
    );
  }

  const packageStats = fs.lstatSync(packageDirectory);
  expect(packageStats.isSymbolicLink()).toBe(false);
  expect(packageStats.isDirectory()).toBe(true);

  const expectedPackage = buildValidPipelineStorePackage(PIPELINE_ID);
  const expectedFiles = Object.entries(expectedPackage.files).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  expect(collectRegularPackageFiles(packageDirectory)).toEqual(
    expectedFiles.map(([relativePath]) => relativePath),
  );
  for (const [relativePath, expectedContent] of expectedFiles) {
    const filePath = path.resolve(packageDirectory, relativePath);
    if (!filePath.startsWith(`${packageDirectory}${path.sep}`)) {
      throw new Error(
        `Expected fixture package file escaped its package directory: ${relativePath}`,
      );
    }
    expect(fs.readFileSync(filePath, "utf8")).toBe(expectedContent);
  }

  expect(
    fs
      .readdirSync(pipelinesRoot)
      .filter(
        (entry) =>
          entry.startsWith(`${PIPELINE_ID}.__tmp-`) ||
          entry.startsWith(`${PIPELINE_ID}.__backup-`),
      ),
  ).toEqual([]);
  return packageDirectory;
}

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180_000);

test(
  "drives the real Store install, config, database, runtime, enable, and failed-update flow",
  async ({ page }) => {
    test.skip(
      !fixtureUrl,
      "The real Store browser fixture is enabled only by the dedicated CI step.",
    );

    const resourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), TEST_RESOURCE_PREFIX),
    );
    let fixture:
      | Awaited<ReturnType<typeof startPipelineStoreFixture>>
      | undefined;
    let siteSettingsSnapshot: SiteSettingsSnapshot | undefined;
    let downloadedDatabasePath: string | undefined;
    let effectiveDatabaseDirectory: string | undefined;
    let databaseDownloadStarted = false;
    let persistentHandoff: PipelineExecutionPaths | undefined;

    try {
      // Capture the caller-owned settings before creating any per-test runtime
      // or database directories. Repeated runs must restore this exact baseline
      // unless CI explicitly requests a persistent handoff.
      siteSettingsSnapshot = await readSiteSettingsSnapshot();
      await removeInstalledFixtureState();
      persistentHandoff = resolvePersistentHandoffPaths(resourceRoot);
      const readyRuntimeDirectory =
        resolveReadyRuntimeDirectory(resourceRoot);
      const databaseDirectory = path.join(resourceRoot, "databases");
      fs.mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
      const runtimeBlocker = path.join(resourceRoot, "not-a-directory");
      fs.writeFileSync(runtimeBlocker, "blocks directory creation\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      const blockedRuntimeDirectory = path.join(
        runtimeBlocker,
        "pipeline-runs",
      );
      await setPipelineExecutionPaths(
        blockedRuntimeDirectory,
        databaseDirectory,
      );

      const resource = provisionPipelineStoreFixtureResource({
        pipelineId: PIPELINE_ID,
        resourceRoot,
      });
      const activeFixture = await startPipelineStoreFixture({
        fixtureUrl: fixtureUrl!,
        pipelineId: PIPELINE_ID,
        blockResourceDownload: true,
      });
      fixture = activeFixture;

      await loginAsSeededAdmin(page);
      const blockedRuntimeResponse = await page.request.get(
        "/api/admin/settings/pipelines/execution",
      );
      expect(blockedRuntimeResponse.ok()).toBeTruthy();
      const blockedRuntimePayload = await blockedRuntimeResponse.json();
      expect(blockedRuntimePayload).toEqual(
        expect.objectContaining({
          settings: expect.objectContaining({
            pipelineRunDir: blockedRuntimeDirectory,
          }),
        }),
      );
      effectiveDatabaseDirectory =
        blockedRuntimePayload.settings?.pipelineDatabaseDir;
      if (
        typeof effectiveDatabaseDirectory !== "string" ||
        !path.isAbsolute(effectiveDatabaseDirectory) ||
        path.resolve(effectiveDatabaseDirectory) ===
          path.parse(path.resolve(effectiveDatabaseDirectory)).root
      ) {
        throw new Error(
          `Expected a safe absolute Pipeline database directory, received ${String(effectiveDatabaseDirectory)}`,
        );
      }
      downloadedDatabasePath = path.join(
        path.resolve(effectiveDatabaseDirectory),
        PIPELINE_ID,
        PIPELINE_STORE_FIXTURE_DATABASE_ID,
        PIPELINE_STORE_FIXTURE_DATABASE_FILE_NAME,
      );
      expect(fs.existsSync(downloadedDatabasePath)).toBe(false);

      const storeCatalogReady = waitForFixtureStoreCatalog(page);
      await Promise.all([
        storeCatalogReady,
        page.goto("/admin/settings/pipelines", {
          waitUntil: "domcontentloaded",
        }),
      ]);
      await expect(
        page.getByRole("heading", { name: "Pipeline Catalog" }),
      ).toBeVisible();

      const availableButton = page.getByRole("button", {
        name: /^Available\b/,
      });
      const availableCard = page.getByTestId(
        `available-pipeline-${PIPELINE_ID}`,
      );
      await availableButton.click();
      await expect(availableCard).toBeVisible({ timeout: 10_000 });
      await availableCard
        .getByRole("button", { name: "Install", exact: true })
        .click();

      const installedCard = page.getByTestId(
        `installed-pipeline-${PIPELINE_ID}`,
      );
      const guidedSetup = page.getByTestId("guided-pipeline-setup");
      await expect(installedCard).toBeVisible({ timeout: 30_000 });
      await expect(guidedSetup).toHaveAttribute(
        "data-pipeline-id",
        PIPELINE_ID,
        { timeout: 30_000 },
      );
      await expect(guidedSetup).toHaveAttribute(
        "data-setup-action",
        "configure",
        { timeout: 30_000 },
      );
      await expect(
        installedCard.getByRole("button", {
          name: "Enable after setup",
          exact: true,
        }),
      ).toBeDisabled();

      await page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`).click();
      await expect(
        page.getByRole("heading", {
          name: "Configure SeqDesk Store E2E Fixture",
        }),
      ).toBeVisible();
      await page.getByLabel("Fixture label").fill(CONFIGURED_LABEL);
      const [configResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/admin/settings/pipelines") &&
            response.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Save changes" }).click(),
      ]);
      expect(configResponse.ok()).toBeTruthy();
      await expect(configResponse.json()).resolves.toEqual(
        expect.objectContaining({
          success: true,
          enabled: false,
        }),
      );
      const configuredResponse = await page.request.get(
        "/api/admin/settings/pipelines",
      );
      expect(configuredResponse.ok()).toBeTruthy();
      const configuredPayload = await configuredResponse.json();
      const configuredPipeline = configuredPayload.pipelines?.find(
        (pipeline: { pipelineId?: string }) =>
          pipeline.pipelineId === PIPELINE_ID,
      );
      expect(configuredPipeline).toEqual(
        expect.objectContaining({
          enabled: false,
          config: expect.objectContaining({
            fixtureLabel: CONFIGURED_LABEL,
            [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]: "",
          }),
          readiness: expect.objectContaining({ canEnable: false }),
        }),
      );
      expect(
        configuredPipeline.readiness?.items?.find(
          (item: { id?: string }) => item.id === "databases",
        ),
      ).toEqual(
        expect.objectContaining({
          status: "missing",
          action: "download-db",
        }),
      );

      await expect(guidedSetup).toHaveAttribute(
        "data-setup-action",
        "download-db",
        { timeout: 30_000 },
      );
      await page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`).click();
      await expect(
        page.getByRole("heading", { name: "Download Fixture database" }),
      ).toBeVisible();
      await expect(page.getByLabel("Target path")).toHaveValue(
        downloadedDatabasePath,
      );
      await expect(
        page.getByText("sha256 checksum will be verified after download."),
      ).toBeVisible();
      databaseDownloadStarted = true;
      const [downloadResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .endsWith("/api/admin/settings/pipelines/download-db") &&
            response.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Download", exact: true }).click(),
      ]);
      expect(downloadResponse.ok()).toBeTruthy();
      await expect(downloadResponse.json()).resolves.toEqual(
        expect.objectContaining({
          success: true,
          pipelineId: PIPELINE_ID,
          databaseId: PIPELINE_STORE_FIXTURE_DATABASE_ID,
        }),
      );

      await expect
        .poll(
          () =>
            activeFixture.requests.some(
              (request) =>
                request.method === "GET" &&
                request.path === PIPELINE_STORE_FIXTURE_DATABASE_PATH,
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
      await activeFixture.waitForResourceDownloadRequest();
      const runningResponse = await page.request.get(
        "/api/admin/settings/pipelines",
      );
      expect(runningResponse.ok()).toBeTruthy();
      const runningPayload = await runningResponse.json();
      const runningPipeline = runningPayload.pipelines?.find(
        (pipeline: { pipelineId?: string }) =>
          pipeline.pipelineId === PIPELINE_ID,
      );
      expect(runningPipeline).toEqual(
        expect.objectContaining({
          enabled: false,
          config: expect.objectContaining({
            fixtureLabel: CONFIGURED_LABEL,
            [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]: "",
          }),
          readiness: expect.objectContaining({
            canEnable: false,
          }),
          databaseDownloads: expect.arrayContaining([
            expect.objectContaining({
              id: PIPELINE_STORE_FIXTURE_DATABASE_ID,
              status: "missing",
              expectedPath: downloadedDatabasePath,
              job: expect.objectContaining({
                state: "running",
                phase: "downloading",
                targetPath: downloadedDatabasePath,
                sourceUrl: activeFixture.resourceUrl,
              }),
            }),
          ]),
        }),
      );
      expect(
        runningPipeline.readiness?.items?.find(
          (item: { id?: string }) => item.id === "databases",
        ),
      ).toEqual(
        expect.objectContaining({
          status: "missing",
          action: "download-db",
        }),
      );
      await expect(guidedSetup).toHaveAttribute(
        "data-setup-action",
        "download-db",
      );

      activeFixture.releaseResourceDownload();
      await expect(guidedSetup).toHaveAttribute(
        "data-setup-action",
        "configure-runtime",
        { timeout: 30_000 },
      );
      const databaseLinkedResponse = await page.request.get(
        "/api/admin/settings/pipelines",
      );
      expect(databaseLinkedResponse.ok()).toBeTruthy();
      const databaseLinkedPayload = await databaseLinkedResponse.json();
      const databaseLinkedPipeline = databaseLinkedPayload.pipelines?.find(
        (pipeline: { pipelineId?: string }) =>
          pipeline.pipelineId === PIPELINE_ID,
      );
      expect(databaseLinkedPipeline).toEqual(
        expect.objectContaining({
          enabled: false,
          config: expect.objectContaining({
            fixtureLabel: CONFIGURED_LABEL,
            [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]:
              downloadedDatabasePath,
          }),
          databaseDownloads: expect.arrayContaining([
            expect.objectContaining({
              id: PIPELINE_STORE_FIXTURE_DATABASE_ID,
              status: "downloaded",
              path: downloadedDatabasePath,
              sourceUrl: activeFixture.resourceUrl,
              job: expect.objectContaining({
                state: "success",
                targetPath: downloadedDatabasePath,
                sourceUrl: activeFixture.resourceUrl,
                progressPercent: 100,
              }),
            }),
          ]),
        }),
      );
      const downloadedDatabase =
        databaseLinkedPipeline.databaseDownloads?.find(
          (database: { id?: string }) =>
            database.id === PIPELINE_STORE_FIXTURE_DATABASE_ID,
        );
      const expectedDatabaseBytes = Buffer.byteLength(
        `${resource.marker}\n`,
        "utf8",
      );
      expect(downloadedDatabase?.job).toEqual(
        expect.objectContaining({
          state: "success",
          bytesDownloaded: expectedDatabaseBytes,
          totalBytes: expectedDatabaseBytes,
          progressPercent: 100,
        }),
      );
      expect(fs.lstatSync(downloadedDatabasePath).isFile()).toBe(true);
      expect(
        fs.lstatSync(downloadedDatabasePath).isSymbolicLink(),
      ).toBe(false);
      const downloadedDatabaseSha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(downloadedDatabasePath))
        .digest("hex");
      expect(downloadedDatabaseSha256).toBe(
        PIPELINE_STORE_FIXTURE_DATABASE_SHA256,
      );

      const downloadLogPath = downloadedDatabase?.job?.logPath;
      if (typeof downloadLogPath !== "string") {
        throw new Error("Successful database download did not expose its log path");
      }
      const resolvedDownloadLogPath = path.resolve(downloadLogPath);
      const expectedLogDirectory = path.join(
        getIsolatedPipelinesRoot(),
        ".pipeline-database-download-logs",
      );
      if (path.dirname(resolvedDownloadLogPath) !== expectedLogDirectory) {
        throw new Error(
          `Database download log escaped the isolated Pipeline Store root: ${resolvedDownloadLogPath}`,
        );
      }
      await expect
        .poll(
          () =>
            fs.existsSync(resolvedDownloadLogPath)
              ? fs.readFileSync(resolvedDownloadLogPath, "utf8")
              : "",
          { timeout: 10_000 },
        )
        .toContain(
          `Checksum OK (sha256 ${PIPELINE_STORE_FIXTURE_DATABASE_SHA256}).`,
        );

      await page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`).click();
      await page.waitForURL(/\/admin\/pipeline-runtime#required-runtime$/);
      await expect(
        page.getByRole("heading", { name: "Pipeline Runtime" }),
      ).toBeVisible();
      const runDirectoryInput = page.getByLabel("Pipeline Run Directory");
      await expect(runDirectoryInput).toHaveValue(blockedRuntimeDirectory);
      await runDirectoryInput.fill(readyRuntimeDirectory);
      const runDirectoryRow = page
        .locator("#runtime-run-dir")
        .locator("..")
        .locator("..");
      const [runtimeCheckResponse] = await Promise.all([
        page.waitForResponse(
          (response) => {
            if (
              !response
                .url()
                .endsWith("/api/admin/settings/pipelines/test-setting") ||
              response.request().method() !== "POST"
            ) {
              return false;
            }
            const requestBody = response.request().postDataJSON() as {
              setting?: unknown;
              value?: unknown;
            };
            return (
              requestBody.setting === "pipelineRunDir" &&
              requestBody.value === readyRuntimeDirectory
            );
          },
        ),
        runDirectoryRow
          .getByRole("button", { name: "Test", exact: true })
          .click(),
      ]);
      expect(runtimeCheckResponse.ok()).toBeTruthy();
      await expect(runtimeCheckResponse.json()).resolves.toEqual(
        expect.objectContaining({
          success: true,
          message: "Exists and writable",
        }),
      );
      await expect(
        runDirectoryRow.getByText("Exists and writable"),
      ).toBeVisible();

      const [runtimeSaveResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response
              .url()
              .endsWith("/api/admin/settings/pipelines/execution") &&
            response.request().method() === "POST",
        ),
        page
          .getByRole("button", { name: "Save Runtime Settings" })
          .click(),
      ]);
      expect(runtimeSaveResponse.ok()).toBeTruthy();
      await expect(runtimeSaveResponse.json()).resolves.toEqual(
        expect.objectContaining({
          success: true,
          settings: expect.objectContaining({
            pipelineRunDir: readyRuntimeDirectory,
          }),
        }),
      );
      await expect(
        page.getByRole("button", { name: "Saved!" }),
      ).toBeVisible();

      await page.goto("/admin/settings/pipelines", {
        waitUntil: "domcontentloaded",
      });
      const resumedGuidedSetup = page.getByTestId("guided-pipeline-setup");
      await expect(resumedGuidedSetup).toHaveAttribute(
        "data-pipeline-id",
        PIPELINE_ID,
        { timeout: 30_000 },
      );
      await expect(resumedGuidedSetup).toHaveAttribute(
        "data-setup-action",
        "enable",
        { timeout: 30_000 },
      );
      await page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`).click();
      await expect(resumedGuidedSetup).toHaveAttribute(
        "data-setup-action",
        "complete",
        { timeout: 30_000 },
      );
      await expect(resumedGuidedSetup).toContainText(
        "Pipeline setup complete",
      );

      const enabledResponse = await page.request.get(
        "/api/admin/settings/pipelines",
      );
      expect(enabledResponse.ok()).toBeTruthy();
      const enabledPayload = await enabledResponse.json();
      const enabledPipeline = enabledPayload.pipelines?.find(
        (pipeline: { pipelineId?: string }) =>
          pipeline.pipelineId === PIPELINE_ID,
      );
      expect(enabledPipeline).toEqual(
        expect.objectContaining({
          pipelineId: PIPELINE_ID,
          version: PIPELINE_STORE_FIXTURE_V1,
          enabled: true,
          config: expect.objectContaining({
            fixtureLabel: CONFIGURED_LABEL,
            [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]:
              downloadedDatabasePath,
          }),
        }),
      );
      const executionMode = enabledPipeline?.executionPolicy?.mode;
      if (executionMode !== "local" && executionMode !== "slurm") {
        throw new Error(
          `Expected the installed fixture to resolve to local or slurm execution, received ${String(executionMode)}`,
        );
      }
      const expectedReadinessStatus = enabledPipeline.readiness?.status;
      expect(expectedReadinessStatus).toBe("ready");
      expect(enabledPipeline.executionPolicy).toEqual(
        expect.objectContaining({ mode: executionMode }),
      );
      expect(enabledPipeline.readiness).toEqual(
        expect.objectContaining({
          status: expectedReadinessStatus,
          canEnable: true,
        }),
      );
      const readinessItems = new Map<
        string,
        { status?: string; blocking?: boolean }
      >(
        (enabledPipeline.readiness?.items || []).map(
          (item: { id: string; status?: string; blocking?: boolean }) => [
            item.id,
            item,
          ] as const,
        ),
      );
      const requiredReadinessItemIds = [
        "package",
        "workflow",
        "required-config",
        "databases",
        "pipeline-config",
        "runtime-nextflow",
        "runtime-java",
        executionMode === "slurm" ? "runtime-slurm" : "runtime-conda",
        "data-storage-path",
        "pipeline-run-directory",
        "enabled",
      ];
      for (const itemId of requiredReadinessItemIds) {
        expect(
          readinessItems.get(itemId),
          `missing or incomplete readiness item: ${itemId}`,
        ).toEqual(expect.objectContaining({ status: "ready" }));
      }
      expect(
        enabledPipeline.readiness?.items?.find(
          (item: { id?: string }) => item.id === "pipeline-config",
        ),
      ).toEqual(
        expect.objectContaining({
          status: "ready",
        }),
      );
      expect(enabledPipeline.databaseDownloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: PIPELINE_STORE_FIXTURE_DATABASE_ID,
            status: "downloaded",
            path: downloadedDatabasePath,
            sourceUrl: activeFixture.resourceUrl,
            job: expect.objectContaining({
              state: "success",
              targetPath: downloadedDatabasePath,
            }),
          }),
        ]),
      );
      expect(
        enabledPipeline.readiness?.items?.filter(
          (item: {
            id?: string;
            status?: string;
            blocking?: boolean;
          }) =>
            item.id !== "enabled" &&
            item.blocking !== false &&
            item.status !== "ready",
        ),
      ).toEqual([]);

      activeFixture.advertiseBrokenUpdate();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "Pipeline Catalog" }),
      ).toBeVisible();

      const updateCard = page.getByTestId(
        `installed-pipeline-${PIPELINE_ID}`,
      );
      await expect(updateCard).toContainText("Package update", {
        timeout: 30_000,
      });
      const detailsToggle = page.getByRole("button", {
        name: "Show details",
      });
      await detailsToggle.click();
      await expect(
        page.getByRole("button", { name: "Hide details" }),
      ).toBeVisible();
      await expect(updateCard).toContainText(
        `Latest version: v${PIPELINE_STORE_FIXTURE_V2}`,
      );
      await updateCard
        .getByRole("button", { name: "Update", exact: true })
        .click();

      await expect(
        page.getByText(/definition\.pipeline/i).first(),
      ).toBeVisible();
      await expect(
        updateCard.getByText(`v${PIPELINE_STORE_FIXTURE_V1}`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        updateCard.getByRole("button", { name: "Update", exact: true }),
      ).toBeVisible();

      const rollbackResponse = await page.request.get(
        "/api/admin/settings/pipelines",
      );
      expect(rollbackResponse.ok()).toBeTruthy();
      const rollbackPayload = await rollbackResponse.json();
      const preservedPipeline = rollbackPayload.pipelines?.find(
        (pipeline: { pipelineId?: string }) =>
          pipeline.pipelineId === PIPELINE_ID,
      );
      expect(preservedPipeline).toEqual(
        expect.objectContaining({
          pipelineId: PIPELINE_ID,
          version: PIPELINE_STORE_FIXTURE_V1,
          enabled: true,
          config: expect.objectContaining({
            fixtureLabel: CONFIGURED_LABEL,
            [PIPELINE_STORE_FIXTURE_RESOURCE_CONFIG_KEY]:
              downloadedDatabasePath,
          }),
          readiness: expect.objectContaining({
            status: expectedReadinessStatus,
            canEnable: true,
          }),
          databaseDownloads: expect.arrayContaining([
            expect.objectContaining({
              id: PIPELINE_STORE_FIXTURE_DATABASE_ID,
              status: "downloaded",
              path: downloadedDatabasePath,
              sourceUrl: activeFixture.resourceUrl,
              job: expect.objectContaining({
                state: "success",
                targetPath: downloadedDatabasePath,
              }),
            }),
          ]),
        }),
      );
      const restoredPackageDirectory = assertActiveFixturePackageOnDisk();
      const lintResponse = await page.request.get(
        `/api/admin/settings/pipelines/${encodeURIComponent(PIPELINE_ID)}/lint`,
      );
      expect(lintResponse.ok()).toBeTruthy();
      await expect(lintResponse.json()).resolves.toEqual(
        expect.objectContaining({
          result: expect.objectContaining({
            packageId: PIPELINE_ID,
            packageDir: restoredPackageDirectory,
            valid: true,
            errors: 0,
          }),
        }),
      );
      expect(fs.lstatSync(downloadedDatabasePath).isFile()).toBe(true);
      expect(
        fs.lstatSync(downloadedDatabasePath).isSymbolicLink(),
      ).toBe(false);
      expect(fs.readFileSync(downloadedDatabasePath, "utf8").trim()).toBe(
        resource.marker,
      );
      expect(
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(downloadedDatabasePath))
          .digest("hex"),
      ).toBe(PIPELINE_STORE_FIXTURE_DATABASE_SHA256);
      expect(activeFixture.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            path: new URL(activeFixture.v1Url).pathname,
          }),
          expect.objectContaining({
            method: "GET",
            path: new URL(activeFixture.v2Url).pathname,
          }),
          expect.objectContaining({
            method: "HEAD",
            path: PIPELINE_STORE_FIXTURE_DATABASE_PATH,
          }),
          expect.objectContaining({
            method: "GET",
            path: PIPELINE_STORE_FIXTURE_DATABASE_PATH,
          }),
        ]),
      );
    } finally {
      let databaseDownloadStopped = !databaseDownloadStarted;
      try {
        fixture?.releaseResourceDownload();
        if (databaseDownloadStarted) {
          if (!downloadedDatabasePath) {
            throw new Error(
              "Database download started without a resolved fixture target path.",
            );
          }
          await ensureFixtureDatabaseDownloadStopped(
            page,
            downloadedDatabasePath,
          );
          databaseDownloadStopped = true;
        }
      } finally {
        try {
          if (databaseDownloadStopped && fixture) {
            const cacheResetResponse = await page.request.post(
              "/api/admin/settings/pipelines/install",
              {
                data: {
                  pipelineId: PIPELINE_ID,
                  version: PIPELINE_STORE_FIXTURE_V1,
                  replace: true,
                  source: {
                    kind: "registry",
                    label: "SeqDesk local E2E registry cleanup",
                    downloadUrl: fixture.v1Url,
                  },
                },
              },
            );
            if (!cacheResetResponse.ok()) {
              throw new Error(
                `Could not reset the Pipeline Store fixture cache before cleanup (${cacheResetResponse.status()}): ${await cacheResetResponse.text()}`,
              );
            }
          }
        } finally {
          try {
            if (databaseDownloadStopped) {
              await removeInstalledFixtureState();
            }
          } finally {
            try {
              if (
                databaseDownloadStopped &&
                downloadedDatabasePath &&
                effectiveDatabaseDirectory
              ) {
                removeFixtureDatabaseTarget(
                  downloadedDatabasePath,
                  effectiveDatabaseDirectory,
                );
              }
            } finally {
              try {
                if (siteSettingsSnapshot) {
                  await restoreSiteSettings(
                    siteSettingsSnapshot,
                    persistentHandoff,
                  );
                }
              } finally {
                try {
                  await fixture?.close();
                } finally {
                  if (databaseDownloadStopped) {
                    removeTestResourceRoot(resourceRoot);
                  } else {
                    console.error(
                      `Preserving Pipeline Store fixture state because database-job termination was not proven: ${resourceRoot}`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  },
);
