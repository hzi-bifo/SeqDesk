import { expect, test, type Page } from "@playwright/test";
import {
  createAndSubmitOrder,
  deleteCurrentOrder,
  getOrderSampleIds,
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

async function getAllowDeleteSubmittedOrdersState(page: Page): Promise<boolean> {
  await page.goto("/admin/form-builder?tab=settings#data-handling");
  await expect(page.getByRole("heading", { name: "Advanced Settings" })).toBeVisible();

  return page
    .getByRole("checkbox", { name: /allow deletion of submitted orders/i })
    .isChecked();
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

test("admin can run simulate reads with default settings", async ({ page }) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Playwright Simulate Reads ${Date.now()}`;
    const originalAllowDeleteSetting = await getAllowDeleteSubmittedOrdersState(page);
    let orderPath: string | null = null;
    let runId: string | null = null;

    try {
      await setAllowDeleteSubmittedOrders(page, true);

      const created = await createAndSubmitOrder(page, orderName, [
        { volume: "44", concentration: "18" },
      ]);
      orderPath = created.orderPath;
      const orderId = orderPath.split("/").at(-1);
      expect(orderId).toBeTruthy();

      const sampleIds = await getOrderSampleIds(page);
      expect(sampleIds).toHaveLength(1);

      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Simulate Reads" })).toBeVisible();

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
      await expect(runRow.getByText("Completed", { exact: true })).toBeVisible();

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
        await page.goto(orderPath);
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

      const created = await createAndSubmitOrder(page, orderName, [
        { volume: "30", concentration: "10" },
      ]);
      orderPath = created.orderPath;
      const orderId = orderPath.split("/").at(-1) as string;
      expect(orderId).toBeTruthy();

      // ---- Run 1: paired-end, custom counts, replaceExisting OFF ----
      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Simulate Reads" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      // Verify default values
      const readCountInput = page.getByLabel("Read Count");
      const readLengthInput = page.getByLabel("Read Length");
      const replaceSwitch = page.locator("#config-replaceExisting");

      await expect(readCountInput).toHaveValue("1000");
      await expect(readLengthInput).toHaveValue("150");

      // The switch defaults to checked (replaceExisting: true)
      await expect(replaceSwitch).toBeChecked();

      // Toggle the switch OFF (force: true because the checkbox is sr-only)
      await replaceSwitch.click({ force: true });
      await expect(replaceSwitch).not.toBeChecked();

      // Set custom read count and length
      await readCountInput.fill("500");
      await readLengthInput.fill("100");

      // Change mode to single-end
      const modeTrigger = page.locator("button[role='combobox']").filter({ hasText: "Paired-end" });
      await modeTrigger.click();
      await page.getByRole("option", { name: "Single-end" }).click();

      // Start the pipeline
      const runButton = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton).toBeEnabled({ timeout: 90000 });
      await runButton.click();

      const run1 = await waitForPipelineRunToComplete(page, orderId, "simulate-reads");
      runIds.push(run1.id);

      // Verify ALL config values were persisted
      const run1Details = await getPipelineRunDetails(page, run1.id);
      expect(run1Details.config).toMatchObject({
        mode: "shortReadSingle",
        readCount: 500,
        readLength: 100,
        replaceExisting: false,
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

      await readCountInput.fill("200");
      await readLengthInput.fill("5000");

      // replaceExisting stays ON (default)
      await expect(replaceSwitch).toBeChecked();

      const runButton2 = page.getByRole("button", { name: /Run All Ready/ });
      await expect(runButton2).toBeEnabled({ timeout: 90000 });
      await runButton2.click();

      const run2 = await waitForPipelineRunToComplete(page, orderId, "simulate-reads", runIds);
      runIds.push(run2.id);

      const run2Details = await getPipelineRunDetails(page, run2.id);
      expect(run2Details.config).toMatchObject({
        mode: "longRead",
        readCount: 200,
        readLength: 5000,
        replaceExisting: true,
      });
    } finally {
      for (const runId of runIds) {
        await deletePipelineRun(page, runId);
      }

      if (orderPath) {
        await page.goto(orderPath);
        await deleteCurrentOrder(page);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
          .toBe("/orders");
      }

      await setAllowDeleteSubmittedOrders(page, originalAllowDeleteSetting);
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

      const created = await createAndSubmitOrder(page, orderName, [
        { volume: "30", concentration: "10" },
      ]);
      orderPath = created.orderPath;
      const orderId = orderPath.split("/").at(-1) as string;
      expect(orderId).toBeTruthy();

      // ---- Run 1: replaceExisting ON (default) — creates initial reads ----
      await page.goto(`${orderPath}/sequencing?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Simulate Reads" })).toBeVisible();

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
        await page.goto(orderPath);
        await deleteCurrentOrder(page);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
          .toBe("/orders");
      }

      await setAllowDeleteSubmittedOrders(page, originalAllowDeleteSetting);
    }
  });
});
