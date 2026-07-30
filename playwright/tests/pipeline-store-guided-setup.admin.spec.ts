import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

test.use({ storageState: "playwright/.auth/admin.json" });

const PIPELINE_ID = "playwright-store-pipeline";
const PIPELINE_NAME = "Playwright Store Pipeline";

type SetupStage =
  | "configure"
  | "database"
  | "runtime"
  | "enable"
  | "complete";

type InstallRequest = {
  pipelineId?: string;
  replace?: boolean;
  version?: string;
};

type SettingsRequest = {
  pipelineId?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

interface PipelineApiMockOptions {
  initiallyInstalled?: boolean;
  installedVersion?: string;
  latestVersion?: string;
  fullGuidedSetup?: boolean;
  updateFailure?: {
    status: number;
    error: string;
    details: string;
  };
}

interface PipelineApiMock {
  installRequests: InstallRequest[];
  settingsRequests: SettingsRequest[];
  databaseRequests: Array<{
    pipelineId?: string;
    databaseId?: string;
  }>;
  getInstalledVersion(): string | null;
  markRuntimeReady(): void;
}

function json(route: Route, status: number, payload: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function readJson<T>(request: Request): Promise<T> {
  return JSON.parse(request.postData() || "{}") as T;
}

function buildReadiness(stage: SetupStage, fullGuidedSetup: boolean) {
  const packageItem = {
    id: "package",
    label: "Pipeline package",
    status: "ready",
    detail: "Descriptor package is installed.",
  };
  const configurationItem = {
    id: "configuration",
    label: "Pipeline configuration",
    status: stage === "configure" ? "missing" : "ready",
    detail:
      stage === "configure"
        ? "Choose an output directory."
        : "The output directory is configured.",
    ...(stage === "configure" ? { action: "configure" } : {}),
  };
  const databaseItem = {
    id: "databases",
    label: "Runtime databases",
    status: stage === "configure" || stage === "database" ? "missing" : "ready",
    detail:
      stage === "configure" || stage === "database"
        ? "Playwright fixture database is not installed."
        : "Required database assets are installed.",
    ...(stage === "configure" || stage === "database"
      ? { action: "download-db" }
      : {}),
    blocking: true,
  };
  const runtimeItem = {
    id: "runtime-nextflow",
    label: "Nextflow",
    status:
      stage === "configure" || stage === "database" || stage === "runtime"
        ? "missing"
        : "ready",
    detail:
      stage === "configure" || stage === "database" || stage === "runtime"
        ? "Verify the configured pipeline runtime."
        : "Nextflow is available.",
    ...(stage === "configure" || stage === "database" || stage === "runtime"
      ? {
          action: "configure-runtime",
          href: "/admin/pipeline-runtime#required-runtime",
        }
      : {}),
    blocking: true,
  };
  const enabledItem = {
    id: "enabled",
    label: "Enabled for users",
    status: stage === "complete" ? "ready" : "warning",
    detail:
      stage === "complete"
        ? "The pipeline is enabled."
        : "The pipeline is installed but disabled.",
    ...(stage === "complete" ? {} : { action: "enable" }),
  };

  if (stage === "configure") {
    return {
      status: "missing",
      summary: "Choose an output directory before enabling this pipeline.",
      canEnable: false,
      items: [
        packageItem,
        configurationItem,
        ...(fullGuidedSetup ? [databaseItem, runtimeItem] : []),
        enabledItem,
      ],
    };
  }

  if (stage === "database" || stage === "runtime") {
    return {
      status: "missing",
      summary:
        stage === "database"
          ? "Install the required database before checking the runtime."
          : "Verify the runtime before enabling this pipeline.",
      canEnable: false,
      items: [
        packageItem,
        configurationItem,
        databaseItem,
        runtimeItem,
        enabledItem,
      ],
    };
  }

  if (stage === "enable") {
    return {
      status: "warning",
      summary: "Configuration is complete. Enable the pipeline for users.",
      canEnable: true,
      items: [
        packageItem,
        configurationItem,
        ...(fullGuidedSetup ? [databaseItem, runtimeItem] : []),
        enabledItem,
      ],
    };
  }

  return {
    status: "ready",
    summary: "Ready to run",
    canEnable: true,
    items: [
      packageItem,
      configurationItem,
      ...(fullGuidedSetup ? [databaseItem, runtimeItem] : []),
      enabledItem,
    ],
  };
}

async function mockPipelineApis(
  page: Page,
  options: PipelineApiMockOptions = {},
): Promise<PipelineApiMock> {
  let installed = options.initiallyInstalled === true;
  let installedVersion = installed
    ? options.installedVersion || "1.0.0"
    : null;
  let enabled = installed;
  let setupStage: SetupStage = installed ? "complete" : "configure";
  let config: Record<string, unknown> = { outputDir: "" };
  const latestVersion = options.latestVersion || "1.0.0";
  const fullGuidedSetup = options.fullGuidedSetup === true;
  const installRequests: InstallRequest[] = [];
  const settingsRequests: SettingsRequest[] = [];
  const databaseRequests: Array<{
    pipelineId?: string;
    databaseId?: string;
  }> = [];

  const buildInstalledPipeline = () => ({
    pipelineId: PIPELINE_ID,
    name: PIPELINE_NAME,
    description: "A deterministic pipeline used by the Playwright store flow.",
    category: "analysis",
    version: installedVersion,
    icon: "beaker",
    enabled,
    catalogs: ["order"],
    config,
    configSchema: {
      required: ["outputDir"],
      properties: {
        outputDir: {
          type: "string",
          title: "Output directory",
          description: "Directory used for pipeline results.",
          default: "",
        },
      },
    },
    defaultConfig: { outputDir: "" },
    download: {
      status: "downloaded",
      version: installedVersion,
      expectedVersion: installedVersion,
      path: `nf-core/${PIPELINE_ID}`,
    },
    databaseDownloads: fullGuidedSetup
      ? [
          {
            id: "fixture-db",
            label: "Playwright fixture database",
            status:
              setupStage === "configure" || setupStage === "database"
                ? "missing"
                : "downloaded",
            expectedPath: "/tmp/playwright-fixture-db.txt",
            sourceUrl:
              "https://registry.playwright.invalid/databases/fixture-db.txt",
          },
        ]
      : [],
    readiness: buildReadiness(setupStage, fullGuidedSetup),
  });

  const storePipeline = {
    id: PIPELINE_ID,
    name: PIPELINE_NAME,
    description: "A deterministic pipeline used by the Playwright store flow.",
    category: "analysis",
    version: latestVersion,
    latestVersion,
    author: "SeqDesk Playwright",
    downloads: 1,
    icon: "beaker",
    catalogs: ["order"],
    source: {
      kind: "registry",
      sourceId: "registry:playwright",
      label: "Playwright Registry",
      registryUrl: "https://registry.playwright.invalid/api/registry",
      browseUrl: "https://registry.playwright.invalid/pipelines",
      downloadUrl: `https://registry.playwright.invalid/${PIPELINE_ID}/${latestVersion}`,
    },
  };

  await page.route(
    /\/api\/admin\/settings\/pipelines\/install(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() !== "POST") {
        await json(route, 405, { error: "Method not allowed" });
        return;
      }

      const body = await readJson<InstallRequest>(route.request());
      installRequests.push(body);

      if (body.replace === true && options.updateFailure) {
        await json(route, options.updateFailure.status, {
          error: options.updateFailure.error,
          details: options.updateFailure.details,
        });
        return;
      }

      installed = true;
      installedVersion = body.version || latestVersion;
      enabled = false;
      setupStage = "configure";
      config = { outputDir: "" };
      await json(route, 200, {
        success: true,
        pipelineId: PIPELINE_ID,
        version: installedVersion,
        action: body.replace === true ? "update" : "install",
      });
    },
  );

  await page.route(
    /\/api\/admin\/settings\/pipelines\/store(?:\?.*)?$/,
    (route) =>
      json(route, 200, {
        registries: [
          {
            id: "registry:playwright",
            label: "Playwright Registry",
            registryUrl: "https://registry.playwright.invalid/api/registry",
          },
        ],
        pipelines: [storePipeline],
        categories: [
          {
            id: "analysis",
            name: "Analysis",
          },
        ],
        registryErrors: [],
      }),
  );

  await page.route(
    /\/api\/admin\/settings\/pipelines(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() === "GET") {
        await json(route, 200, {
          pipelines: installed ? [buildInstalledPipeline()] : [],
        });
        return;
      }

      if (route.request().method() !== "POST") {
        await json(route, 405, { error: "Method not allowed" });
        return;
      }

      const body = await readJson<SettingsRequest>(route.request());
      settingsRequests.push(body);
      config = body.config || config;

      if (body.enabled === true) {
        enabled = true;
        setupStage = "complete";
      } else if (
        typeof config.outputDir === "string" &&
        config.outputDir.trim().length > 0
      ) {
        enabled = false;
        setupStage = fullGuidedSetup ? "database" : "enable";
      }

      await json(route, 200, {
        success: true,
        pipelineId: PIPELINE_ID,
        enabled,
      });
    },
  );

  await page.route(
    /\/api\/admin\/settings\/pipelines\/download-db\/preflight(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() !== "POST") {
        await json(route, 405, { error: "Method not allowed" });
        return;
      }
      await json(route, 200, {
        expectedBytes: 64,
        freeBytes: 1024 * 1024,
        partialBytes: 0,
        remainingBytes: 64,
        sufficient: true,
        hasSha256: true,
        targetPath: "/tmp/playwright-fixture-db.txt",
      });
    },
  );

  await page.route(
    /\/api\/admin\/settings\/pipelines\/download-db(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() !== "POST") {
        await json(route, 405, { error: "Method not allowed" });
        return;
      }
      const body = await readJson<{
        pipelineId?: string;
        databaseId?: string;
      }>(route.request());
      databaseRequests.push(body);
      setupStage = "runtime";
      await json(route, 200, {
        success: true,
        pipelineId: body.pipelineId,
        databaseId: body.databaseId,
        status: "downloaded",
      });
    },
  );

  await page.route(/\/api\/sequencing-tech(?:\?.*)?$/, (route) =>
    json(route, 200, { technologies: [] }),
  );
  await page.route(/\/api\/admin\/settings\/access(?:\?.*)?$/, (route) =>
    json(route, 200, { allowUserAssemblyDownload: false }),
  );

  return {
    installRequests,
    settingsRequests,
    databaseRequests,
    getInstalledVersion: () => installedVersion,
    markRuntimeReady: () => {
      if (setupStage !== "runtime") {
        throw new Error(
          `Runtime can only become ready from the runtime stage, current stage is ${setupStage}`,
        );
      }
      setupStage = "enable";
    },
  };
}

test("installs a store pipeline and guides config, database, runtime, and enablement", async ({
  page,
}) => {
  const api = await mockPipelineApis(page, { fullGuidedSetup: true });

  await page.goto("/admin/settings/pipelines", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Pipeline Catalog" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Available\s+1$/ }).click();
  const availableCard = page.getByTestId(
    `available-pipeline-${PIPELINE_ID}`,
  );
  await expect(availableCard).toBeVisible();
  await availableCard
    .getByRole("button", { name: "Install", exact: true })
    .click();

  const installedCard = page.getByTestId(
    `installed-pipeline-${PIPELINE_ID}`,
  );
  const guidedSetup = page.getByTestId("guided-pipeline-setup");
  await expect(installedCard).toBeVisible();
  await expect(guidedSetup).toHaveAttribute("data-pipeline-id", PIPELINE_ID);
  await expect(guidedSetup).toHaveAttribute("data-setup-action", "configure");
  await expect(
    page.getByRole("button", { name: /^Needs setup\s+1$/ }),
  ).toBeVisible();

  await page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`).click();
  await expect(
    page.getByRole("heading", { name: `Configure ${PIPELINE_NAME}` }),
  ).toBeVisible();
  await page.getByLabel("Output directory").fill("/tmp/playwright-results");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(guidedSetup).toHaveAttribute(
    "data-setup-action",
    "download-db",
  );
  await expect(
    page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`),
  ).toHaveText("Install DB");
  await page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`).click();
  const databaseDialog = page.getByRole("dialog");
  await expect(
    databaseDialog.getByRole("heading", {
      name: "Download Playwright fixture database",
    }),
  ).toBeVisible();
  await expect(databaseDialog.getByLabel("Target path")).toHaveValue(
    "/tmp/playwright-fixture-db.txt",
  );
  await databaseDialog
    .getByRole("button", { name: "Download", exact: true })
    .click();

  await expect(guidedSetup).toHaveAttribute(
    "data-setup-action",
    "configure-runtime",
  );
  await expect(
    page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`),
  ).toHaveText("Configure runtime");
  await Promise.all([
    page.waitForURL(/\/admin\/pipeline-runtime#required-runtime$/),
    page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`).click(),
  ]);

  api.markRuntimeReady();
  await page.goto("/admin/settings/pipelines", {
    waitUntil: "domcontentloaded",
  });
  const resumedGuidedSetup = page.getByTestId("guided-pipeline-setup");
  await expect(resumedGuidedSetup).toHaveAttribute(
    "data-setup-action",
    "enable",
  );
  await expect(
    page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`),
  ).toHaveText("Enable");
  await page.getByTestId(`pipeline-setup-next-${PIPELINE_ID}`).click();

  await expect(guidedSetup).toHaveAttribute("data-setup-action", "complete");
  await expect(guidedSetup).toContainText("Pipeline setup complete");
  await expect(
    page.getByRole("button", { name: /^Installed\s+1$/ }),
  ).toBeVisible();
  await expect(installedCard).toBeVisible();

  expect(api.installRequests).toEqual([
    expect.objectContaining({
      pipelineId: PIPELINE_ID,
      version: "1.0.0",
    }),
  ]);
  expect(api.installRequests[0]?.replace).not.toBe(true);
  expect(api.databaseRequests).toEqual([
    expect.objectContaining({
      pipelineId: PIPELINE_ID,
      databaseId: "fixture-db",
    }),
  ]);
  expect(api.settingsRequests).toEqual([
    expect.objectContaining({
      pipelineId: PIPELINE_ID,
      enabled: false,
      config: expect.objectContaining({
        outputDir: "/tmp/playwright-results",
      }),
    }),
    expect.objectContaining({
      pipelineId: PIPELINE_ID,
      enabled: true,
      config: expect.objectContaining({
        outputDir: "/tmp/playwright-results",
      }),
    }),
  ]);
});

test("keeps the previous package visible when a broken update is rolled back", async ({
  page,
}) => {
  const rollbackDetails =
    "Invalid pipeline package: manifest.json is missing. Previous installation restored.";
  const api = await mockPipelineApis(page, {
    initiallyInstalled: true,
    installedVersion: "1.0.0",
    latestVersion: "2.0.0",
    updateFailure: {
      status: 422,
      error: "Failed to install pipeline",
      details: rollbackDetails,
    },
  });

  await page.goto("/admin/settings/pipelines", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Pipeline Catalog" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show details" }).click();

  const installedCard = page.getByTestId(
    `installed-pipeline-${PIPELINE_ID}`,
  );
  await expect(installedCard).toBeVisible();
  await expect(
    installedCard.getByText("v1.0.0", { exact: true }),
  ).toBeVisible();
  await expect(installedCard).toContainText("Latest version: v2.0.0");

  await installedCard
    .getByRole("button", { name: "Update", exact: true })
    .click();

  await expect(page.getByText(rollbackDetails).first()).toBeVisible();
  await expect(installedCard).toBeVisible();
  await expect(
    installedCard.getByText("v1.0.0", { exact: true }),
  ).toBeVisible();
  await expect(
    installedCard.getByRole("button", { name: "Update", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("guided-pipeline-setup")).toHaveCount(0);

  expect(api.installRequests).toEqual([
    expect.objectContaining({
      pipelineId: PIPELINE_ID,
      version: "2.0.0",
      replace: true,
    }),
  ]);
  expect(api.getInstalledVersion()).toBe("1.0.0");
  expect(api.settingsRequests).toHaveLength(0);
});
