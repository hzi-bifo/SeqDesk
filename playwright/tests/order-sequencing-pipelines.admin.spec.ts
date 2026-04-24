import fs from "fs/promises";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import { expect, test, type Page } from "@playwright/test";
import {
  createDraftOrder,
  deleteCurrentOrder,
  setAllowDeleteSubmittedOrders,
  withAllowDeleteSubmittedOrdersLock,
} from "./helpers";

test.setTimeout(240000);

test.use({ storageState: "playwright/.auth/admin.json" });

type PipelineRunSummary = {
  id: string;
  runNumber: string;
  status: string;
};

type PipelineRunDetails = {
  config?: Record<string, unknown> | null;
};

type PipelineConfigResponse = {
  enabled: boolean;
  config: Record<string, unknown>;
};

async function getAllowDeleteSubmittedOrdersState(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/admin/settings/access");
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    allowDeleteSubmittedOrders?: boolean;
  };
  return payload.allowDeleteSubmittedOrders === true;
}

async function getLatestPipelineRun(
  page: Page,
  orderId: string,
  pipelineId: string,
): Promise<PipelineRunSummary | null> {
  const response = await page.request.get(
    `/api/pipelines/runs?orderId=${orderId}&pipelineId=${pipelineId}&limit=1`,
  );
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as { runs?: PipelineRunSummary[] };
  return payload.runs?.[0] ?? null;
}

async function getPipelineRunDetails(
  page: Page,
  runId: string,
): Promise<PipelineRunDetails> {
  const response = await page.request.get(`/api/pipelines/runs/${runId}`);
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as { run?: PipelineRunDetails };
  expect(payload.run).toBeTruthy();
  return payload.run as PipelineRunDetails;
}

async function getPipelineConfig(
  page: Page,
  pipelineId: string,
): Promise<PipelineConfigResponse> {
  const response = await page.request.get("/api/admin/settings/pipelines?catalog=order");
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as {
    pipelines?: Array<{
      pipelineId: string;
      enabled: boolean;
      config: Record<string, unknown>;
    }>;
  };
  const pipeline = payload.pipelines?.find((item) => item.pipelineId === pipelineId);
  expect(pipeline).toBeTruthy();
  return {
    enabled: pipeline!.enabled,
    config: pipeline!.config ?? {},
  };
}

async function setPipelineConfig(
  page: Page,
  pipelineId: string,
  config: Record<string, unknown>,
  enabled = true,
) {
  const response = await page.request.post("/api/admin/settings/pipelines", {
    data: {
      pipelineId,
      config,
      enabled,
    },
  });
  expect(response.ok()).toBeTruthy();
}

function buildTemplateFastq(
  sampleId: string,
  mate: "1" | "2",
  sequences: string[],
): Buffer {
  const lines: string[] = [];
  for (const [index, sequence] of sequences.entries()) {
    lines.push(
      `@TPL:${sampleId}:${index + 1} ${mate}:N:0:${sampleId}`,
      sequence,
      "+",
      "I".repeat(sequence.length),
    );
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

async function waitForPipelineRunToComplete(
  page: Page,
  orderId: string,
  pipelineId: string,
  excludeRunIds: string[] = [],
): Promise<PipelineRunSummary> {
  const excluded = new Set(excludeRunIds);
  const startedAt = Date.now();
  let latestStatus = "missing";

  while (Date.now() - startedAt < 180000) {
    const run = await getLatestPipelineRun(page, orderId, pipelineId);
    if (run && !excluded.has(run.id)) {
      latestStatus = run.status;
      if (run.status === "completed") {
        return run;
      }
      if (run.status === "failed" || run.status === "cancelled") {
        throw new Error(
          `Pipeline run ${run.runNumber} ended with status ${run.status}`,
        );
      }
    }

    await page.waitForTimeout(2000);
  }

  throw new Error(
    `Timed out waiting for ${pipelineId} to complete; latest status: ${latestStatus}`,
  );
}

async function waitForPipelineRunToFail(
  page: Page,
  orderId: string,
  pipelineId: string,
  excludeRunIds: string[] = [],
): Promise<PipelineRunSummary> {
  const excluded = new Set(excludeRunIds);
  const startedAt = Date.now();
  let latestStatus = "missing";

  while (Date.now() - startedAt < 180000) {
    const run = await getLatestPipelineRun(page, orderId, pipelineId);
    if (run && !excluded.has(run.id)) {
      latestStatus = run.status;
      if (run.status === "failed") {
        return run;
      }
      if (run.status === "completed" || run.status === "cancelled") {
        throw new Error(
          `Pipeline run ${run.runNumber} ended with status ${run.status}`,
        );
      }
    }

    await page.waitForTimeout(2000);
  }

  throw new Error(
    `Timed out waiting for ${pipelineId} to fail; latest status: ${latestStatus}`,
  );
}

async function deletePipelineRun(page: Page, runId: string) {
  const response = await page.request.post(`/api/pipelines/runs/${runId}/delete`);
  expect(response.ok()).toBeTruthy();
}

type SequencingReadSummary = {
  pipelineRunId: string | null;
  pipelineRunNumber: string | null;
  file1: string | null;
  file2: string | null;
};

type SequencingSample = {
  id: string;
  sampleId: string;
  read: SequencingReadSummary | null;
};

async function getOrderSequencingSamples(
  page: Page,
  orderId: string,
): Promise<SequencingSample[]> {
  const response = await page.request.get(`/api/orders/${orderId}/sequencing`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { samples?: SequencingSample[] };
  return payload.samples ?? [];
}

async function createSubmittedOrder(
  page: Page,
  orderName: string,
  sampleCount: number,
): Promise<{ orderId: string; orderPath: string; sampleIds: string[] }> {
  const draft = await createDraftOrder(page, orderName, sampleCount);
  const sampleIds = Array.from({ length: sampleCount }, (_, index) =>
    `S-PW-${Date.now()}-${index + 1}`,
  );

  const samplesResponse = await page.request.post(`/api/orders/${draft.orderId}/samples`, {
    headers: {
      "Content-Type": "application/json",
      "x-seqdesk-e2e": "playwright",
    },
    data: {
      samples: sampleIds.map((sampleId, index) => ({
        sampleId,
        sampleTitle: `Playwright sample ${index + 1}`,
        scientificName: "Escherichia coli",
        taxId: "562",
        isNew: true,
      })),
    },
  });
  expect(samplesResponse.ok()).toBeTruthy();

  const submitResponse = await page.request.put(`/api/orders/${draft.orderId}`, {
    headers: {
      "Content-Type": "application/json",
      "x-seqdesk-e2e": "playwright",
    },
    data: {
      status: "SUBMITTED",
    },
  });
  expect(submitResponse.ok()).toBeTruthy();

  return {
    orderId: draft.orderId,
    orderPath: draft.orderPath,
    sampleIds,
  };
}

test("admin can run simulate reads with default settings", async ({ page }) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Playwright Simulate Reads ${Date.now()}`;
    const originalAllowDeleteSetting = await getAllowDeleteSubmittedOrdersState(page);
    let orderPath: string | null = null;
    let runId: string | null = null;

    try {
      await setAllowDeleteSubmittedOrders(page, true);

      const created = await createSubmittedOrder(page, orderName, 1);
      orderPath = created.orderPath;
      const orderId = created.orderId;
      expect(created.sampleIds).toHaveLength(1);

      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { name: "Simulate Reads" })).toBeVisible({
        timeout: 30000,
      });

      // Verify settings section exists with all controls
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await expect(page.getByLabel("Read Count")).toBeVisible();
      await expect(page.getByLabel("Read Length")).toBeVisible();
      // Switch checkbox is sr-only; verify it's attached instead of visible
      await expect(page.getByLabel("Replace Existing Reads")).toBeAttached();

      // Keep defaults, just change read count for verification
      await page.getByLabel("Read Count").fill("42");

      const runButton = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton).toBeEnabled({ timeout: 90000 });
      await runButton.click();

      const run = await waitForPipelineRunToComplete(
        page,
        orderId as string,
        "simulate-reads",
      );
      runId = run.id;

      const runDetails = await getPipelineRunDetails(page, run.id);
      expect(runDetails.config?.readCount).toBe(42);

      const runRow = page.locator("tbody tr").filter({
        has: page.getByText(`#${run.runNumber.split("-").pop()}`, { exact: true }),
      }).first();
      await expect(runRow).toBeVisible({ timeout: 15000 });
      await expect(runRow).toContainText("Completed");

      await page.goto(`${orderPath}/sequencing`);
      await expect(page.getByRole("heading", { name: "Sequencing Data" })).toBeVisible();
      await expect(
        page.getByText("Paired FASTQ linked", { exact: true }),
      ).toBeVisible({ timeout: 30000 });
    } finally {
      if (runId) {
        await deletePipelineRun(page, runId);
      }

      if (orderPath) {
        await page.goto(orderPath, { waitUntil: "domcontentloaded" });
        await deleteCurrentOrder(page);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
          .toBe("/orders");
      }

      await setAllowDeleteSubmittedOrders(page, originalAllowDeleteSetting);
    }
  });
});

test("simulate reads settings: switch, mode, readCount, readLength all persist", async ({
  page,
}) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Playwright SimReads Config ${Date.now()}`;
    const originalAllowDeleteSetting = await getAllowDeleteSubmittedOrdersState(page);
    let orderPath: string | null = null;
    const runIds: string[] = [];

    try {
      await setAllowDeleteSubmittedOrders(page, true);

      const created = await createSubmittedOrder(page, orderName, 1);
      orderPath = created.orderPath;
      const orderId = created.orderId;
      expect(orderId).toBeTruthy();

      // ---- Run 1: paired-end, custom counts, replaceExisting OFF ----
      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Simulate Reads" })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      // Verify default values
      const readCountInput = page.getByLabel("Read Count");
      const readLengthInput = page.getByLabel("Read Length");
      const replaceSwitch = page.locator("#config-replaceExisting");
      const sourceTrigger = page.getByLabel("Simulation Source");
      const qualityTrigger = page.getByLabel("Quality Profile");

      await expect(readCountInput).toHaveValue("1000");
      await expect(readLengthInput).toHaveValue("150");

      // The switch defaults to checked (replaceExisting: true)
      await expect(replaceSwitch).toBeChecked();

      // Explicit synthetic mode for advanced settings coverage
      await sourceTrigger.click();
      await page.getByRole("option", { name: "Synthetic" }).click();

      // Toggle the switch OFF (force: true because the checkbox is sr-only)
      await replaceSwitch.click({ force: true });
      await expect(replaceSwitch).not.toBeChecked();

      // Set custom read count and length
      await readCountInput.fill("50");
      await readLengthInput.fill("100");

      await qualityTrigger.click();
      await page.getByRole("option", { name: "Noisy" }).click();

      await page.getByRole("button", { name: "Advanced settings" }).click();
      await expect(page.getByLabel("Insert Mean")).toBeEnabled();
      await expect(page.getByLabel("Insert Std Dev")).toBeEnabled();
      await page.getByLabel("Insert Mean").fill("420");
      await page.getByLabel("Insert Std Dev").fill("25");
      await page.getByLabel("Seed").fill("77");

      // Start the pipeline
      const runButton = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton).toBeEnabled({ timeout: 90000 });
      await runButton.click();

      const run1 = await waitForPipelineRunToComplete(page, orderId, "simulate-reads");
      runIds.push(run1.id);

      // Verify ALL config values were persisted
      const run1Details = await getPipelineRunDetails(page, run1.id);
      expect(run1Details.config).toMatchObject({
        simulationMode: "synthetic",
        mode: "shortReadPaired",
        readCount: 50,
        readLength: 100,
        replaceExisting: false,
        qualityProfile: "noisy",
        insertMean: 420,
        insertStdDev: 25,
        seed: 77,
      });

      // ---- Run 2: long-read mode, replaceExisting ON, different counts ----
      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      // Settings should reset to defaults on page reload
      await expect(readCountInput).toHaveValue("1000");
      await expect(replaceSwitch).toBeChecked();

      // Set long-read mode
      const modeTrigger2 = page.locator("button[role='combobox']").filter({ hasText: "Paired-end" });
      await modeTrigger2.click();
      await page.getByRole("option", { name: "Long read" }).click();

      await readCountInput.fill("10");
      await readLengthInput.fill("1200");

      // replaceExisting stays ON (default)
      await expect(replaceSwitch).toBeChecked();

      const runButton2 = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton2).toBeEnabled({ timeout: 90000 });
      await runButton2.click();

      const run2 = await waitForPipelineRunToComplete(page, orderId, "simulate-reads", runIds);
      runIds.push(run2.id);

      const run2Details = await getPipelineRunDetails(page, run2.id);
      expect(run2Details.config).toMatchObject({
        simulationMode: "auto",
        mode: "longRead",
        readCount: 10,
        readLength: 1200,
        replaceExisting: true,
      });
    } finally {
      for (const runId of runIds) {
        await deletePipelineRun(page, runId);
      }

      if (orderPath) {
        await page.goto(orderPath, { waitUntil: "domcontentloaded" });
        await deleteCurrentOrder(page);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
          .toBe("/orders");
      }

      await setAllowDeleteSubmittedOrders(page, originalAllowDeleteSetting);
    }
  });
});

test("simulate reads template mode replays facility templates and writes back reads", async ({
  page,
}) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Playwright Template Reads ${Date.now()}`;
    const originalAllowDeleteSetting = await getAllowDeleteSubmittedOrdersState(page);
    const originalPipelineConfig = await getPipelineConfig(page, "simulate-reads");
    const templateRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-playwright-template-"),
    );
    let orderPath: string | null = null;
    let runId: string | null = null;

    try {
      await fs.writeFile(
        path.join(templateRoot, "template_1_1.fastq.gz"),
        gzipSync(buildTemplateFastq("TPL", "1", ["ACGTAC", "TTGGCC"])),
      );
      await fs.writeFile(
        path.join(templateRoot, "template_1_2.fastq.gz"),
        gzipSync(buildTemplateFastq("TPL", "2", ["GTACGT", "GGCCAA"])),
      );

      await setPipelineConfig(
        page,
        "simulate-reads",
        {
          ...originalPipelineConfig.config,
          templateDir: templateRoot,
        },
        originalPipelineConfig.enabled,
      );
      await setAllowDeleteSubmittedOrders(page, true);

      const created = await createSubmittedOrder(page, orderName, 1);
      orderPath = created.orderPath;
      const orderId = created.orderId;

      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Simulate Reads" })).toBeVisible({
        timeout: 15000,
      });

      await page.getByLabel("Simulation Source").click();
      await page.getByRole("option", { name: "Template replay" }).click();

      const runButton = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton).toBeEnabled({ timeout: 90000 });
      await runButton.click();

      const run = await waitForPipelineRunToComplete(page, orderId, "simulate-reads");
      runId = run.id;

      const runDetails = await getPipelineRunDetails(page, run.id);
      expect(runDetails.config).toMatchObject({
        simulationMode: "template",
        templateDir: templateRoot,
      });

      const sequencingSamples = await getOrderSequencingSamples(page, orderId);
      expect(sequencingSamples[0].read?.pipelineRunId).toBe(run.id);
      expect(sequencingSamples[0].read?.file1).toBeTruthy();
      expect(sequencingSamples[0].read?.file2).toBeTruthy();
    } finally {
      if (runId) {
        await deletePipelineRun(page, runId);
      }

      if (orderPath) {
        await page.goto(orderPath, { waitUntil: "domcontentloaded" });
        await deleteCurrentOrder(page);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
          .toBe("/orders");
      }

      await setPipelineConfig(
        page,
        "simulate-reads",
        originalPipelineConfig.config,
        originalPipelineConfig.enabled,
      );
      await fs.rm(templateRoot, { recursive: true, force: true });
      await setAllowDeleteSubmittedOrders(page, originalAllowDeleteSetting);
    }
  });
});

test("simulate reads shows a clear error when template mode has no usable templates", async ({
  page,
}) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Playwright Empty Template ${Date.now()}`;
    const originalAllowDeleteSetting = await getAllowDeleteSubmittedOrdersState(page);
    const originalPipelineConfig = await getPipelineConfig(page, "simulate-reads");
    const templateRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-playwright-empty-template-"),
    );
    let orderId: string | null = null;
    let orderPath: string | null = null;
    let runId: string | null = null;

    try {
      await setPipelineConfig(
        page,
        "simulate-reads",
        {
          ...originalPipelineConfig.config,
          templateDir: templateRoot,
        },
        originalPipelineConfig.enabled,
      );
      await setAllowDeleteSubmittedOrders(page, true);

      const created = await createSubmittedOrder(page, orderName, 1);
      orderId = created.orderId;
      orderPath = created.orderPath;

      const createRunResponse = await page.request.post("/api/pipelines/runs", {
        data: {
          pipelineId: "simulate-reads",
          orderId: created.orderId,
          config: {
            simulationMode: "template",
            templateDir: templateRoot,
          },
        },
      });
      expect(createRunResponse.ok()).toBeTruthy();
      const createRunPayload = (await createRunResponse.json()) as {
        run?: { id?: string };
      };
      runId = createRunPayload.run?.id ?? null;
      expect(runId).toBeTruthy();

      const startRunResponse = await page.request.post(`/api/pipelines/runs/${runId}/start`);
      expect(startRunResponse.ok()).toBeTruthy();

      const run = await waitForPipelineRunToFail(page, created.orderId, "simulate-reads");
      runId = run.id;
      const runDetails = await getPipelineRunDetails(page, run.id);
      expect(runDetails.config).toMatchObject({
        simulationMode: "template",
        templateDir: templateRoot,
      });

      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { name: "Simulate Reads" })).toBeVisible({
        timeout: 30000,
      });

      const runRow = page.locator("tbody tr").filter({
        has: page.getByText(`#${run.runNumber.split("-").pop()}`, { exact: true }),
      }).first();
      await expect(runRow).toContainText("Failed");

      await runRow.getByRole("button", { name: `Actions for ${run.runNumber}` }).click();
      await page.getByRole("menuitem", { name: /View details/i }).click();
      await expect(
        page.locator("pre").filter({ hasText: /No template FASTQ pairs found/i }),
      ).toBeVisible({ timeout: 30000 });
    } finally {
      if (runId) {
        void deletePipelineRun(page, runId).catch(() => {});
      }

      if (orderId) {
        void page.request.delete(`/api/orders/${orderId}`).catch(() => {});
      }

      void setPipelineConfig(
        page,
        "simulate-reads",
        originalPipelineConfig.config,
        originalPipelineConfig.enabled,
      ).catch(() => {});
      void fs.rm(templateRoot, { recursive: true, force: true }).catch(() => {});
      void setAllowDeleteSubmittedOrders(page, originalAllowDeleteSetting).catch(() => {});
    }
  });
});

test("replaceExisting=false preserves original reads and source run", async ({ page }) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Playwright Replace Toggle ${Date.now()}`;
    const originalAllowDeleteSetting = await getAllowDeleteSubmittedOrdersState(page);
    let orderPath: string | null = null;
    const runIds: string[] = [];

    try {
      await setAllowDeleteSubmittedOrders(page, true);

      const created = await createSubmittedOrder(page, orderName, 1);
      orderPath = created.orderPath;
      const orderId = created.orderId;
      expect(orderId).toBeTruthy();

      // ---- Run 1: replaceExisting ON (default) — creates initial reads ----
      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Simulate Reads" })).toBeVisible({
        timeout: 15000,
      });

      const readCountInput = page.getByLabel("Read Count");
      await readCountInput.fill("100");

      const runButton1 = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton1).toBeEnabled({ timeout: 90000 });
      await runButton1.click();

      const run1 = await waitForPipelineRunToComplete(page, orderId, "simulate-reads");
      runIds.push(run1.id);

      // Verify reads are linked and source points to run1
      const samplesAfterRun1 = await getOrderSequencingSamples(page, orderId);
      expect(samplesAfterRun1).toHaveLength(1);
      expect(samplesAfterRun1[0].read).toBeTruthy();
      expect(samplesAfterRun1[0].read!.file1).toBeTruthy();
      expect(samplesAfterRun1[0].read!.pipelineRunId).toBe(run1.id);
      expect(samplesAfterRun1[0].read!.pipelineRunNumber).toBe(run1.runNumber);
      const originalFile1 = samplesAfterRun1[0].read!.file1;

      // ---- Run 2: replaceExisting OFF — should NOT change reads or source ----
      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      const replaceSwitch = page.locator("#config-replaceExisting");
      await expect(replaceSwitch).toBeChecked();
      await replaceSwitch.click({ force: true });
      await expect(replaceSwitch).not.toBeChecked();

      await readCountInput.fill("200");

      const runButton2 = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton2).toBeEnabled({ timeout: 90000 });
      await runButton2.click();

      const run2 = await waitForPipelineRunToComplete(
        page,
        orderId,
        "simulate-reads",
        runIds,
      );
      runIds.push(run2.id);

      // Verify reads are UNCHANGED — still from run1
      const samplesAfterRun2 = await getOrderSequencingSamples(page, orderId);
      expect(samplesAfterRun2[0].read).toBeTruthy();
      expect(samplesAfterRun2[0].read!.file1).toBe(originalFile1);
      expect(samplesAfterRun2[0].read!.pipelineRunId).toBe(run1.id);
      expect(samplesAfterRun2[0].read!.pipelineRunNumber).toBe(run1.runNumber);

      // ---- Run 3: replaceExisting ON — should update reads and source ----
      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      await expect(replaceSwitch).toBeChecked();
      await readCountInput.fill("300");

      const runButton3 = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton3).toBeEnabled({ timeout: 90000 });
      await runButton3.click();

      const run3 = await waitForPipelineRunToComplete(
        page,
        orderId,
        "simulate-reads",
        runIds,
      );
      runIds.push(run3.id);

      // Verify reads are NOW from run3
      const samplesAfterRun3 = await getOrderSequencingSamples(page, orderId);
      expect(samplesAfterRun3[0].read).toBeTruthy();
      expect(samplesAfterRun3[0].read!.pipelineRunId).toBe(run3.id);
      expect(samplesAfterRun3[0].read!.pipelineRunNumber).toBe(run3.runNumber);

      // Verify the Source column shows the correct run number in the UI
      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByText(run3.runNumber, { exact: true }).first()).toBeVisible({
        timeout: 15000,
      });
    } finally {
      // Clean up runs in reverse order
      for (const runId of [...runIds].reverse()) {
        await deletePipelineRun(page, runId);
      }

      if (orderPath) {
        await page.goto(orderPath, { waitUntil: "domcontentloaded" });
        await deleteCurrentOrder(page);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
          .toBe("/orders");
      }

      await setAllowDeleteSubmittedOrders(page, originalAllowDeleteSetting);
    }
  });
});
