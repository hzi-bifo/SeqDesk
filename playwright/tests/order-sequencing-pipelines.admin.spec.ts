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
): Promise<PipelineRunSummary> {
  const startedAt = Date.now();
  let latestStatus = "missing";

  while (Date.now() - startedAt < 180000) {
    const run = await getLatestPipelineRun(page, orderId, pipelineId);
    if (run) {
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

test("admin can run simulate reads from sequencing workspace", async ({ page }) => {
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

      await page.goto(`${orderPath}/pipelines?pipeline=simulate-reads`);
      await expect(page.getByRole("heading", { name: "Order Pipelines" })).toBeVisible();
      await expect(page.getByText("Simulate Reads").first()).toBeVisible();
      await expect(
        page.getByText(/Generate dummy .* files for the samples in an order/i).first(),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Pipeline Configuration" })).toBeVisible();
      await page.getByLabel("Read Count").fill("42");

      const startPipelineButton = page.getByRole("button", { name: "Start Pipeline" });
      await expect(startPipelineButton).toBeEnabled({ timeout: 90000 });
      await startPipelineButton.click();

      const run = await waitForPipelineRunToComplete(
        page,
        orderId as string,
        "simulate-reads",
      );
      runId = run.id;

      const runDetails = await getPipelineRunDetails(page, run.id);
      expect(runDetails.config?.readCount).toBe(42);

      const runRow = page.locator("tbody tr").filter({
        has: page.getByText(run.runNumber, { exact: true }),
      }).first();
      await expect(runRow).toBeVisible({ timeout: 15000 });
      await expect(runRow.getByRole("cell").nth(2)).toContainText("Completed");

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
