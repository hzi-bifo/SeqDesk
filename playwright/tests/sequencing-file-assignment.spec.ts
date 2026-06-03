import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createDraftOrder,
  deleteCurrentOrder,
  setAllowDeleteSubmittedOrders,
  withAllowDeleteSubmittedOrdersLock,
} from "./helpers";

// This spec exercises the facility-admin sequencing-file flow, so it must run with
// the admin storage state (which also has the data base path configured by
// admin.setup.ts). The file naming keeps it in the default chromium project, so we
// override the storage state explicitly here.
test.use({ storageState: "playwright/.auth/admin.json" });

test.setTimeout(120000);

const READ_FIXTURE = path.join(__dirname, "..", "fixtures", "sample_R1.fastq");

type SequencingReadSummary = {
  file1: string | null;
  file2: string | null;
  filesMissing?: boolean | null;
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

async function getAllowDeleteSubmittedOrdersState(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/admin/settings/access");
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { allowDeleteSubmittedOrders?: boolean };
  return payload.allowDeleteSubmittedOrders === true;
}

async function createSubmittedOrder(
  page: Page,
  orderName: string,
): Promise<{ orderId: string; orderPath: string; sampleId: string }> {
  const draft = await createDraftOrder(page, orderName, 1);
  const sampleId = `S-PW-FILE-${Date.now()}`;

  const samplesResponse = await page.request.post(
    `/api/orders/${draft.orderId}/samples`,
    {
      headers: {
        "Content-Type": "application/json",
        "x-seqdesk-e2e": "playwright",
      },
      data: {
        samples: [
          {
            sampleId,
            sampleTitle: "Playwright file-assignment sample",
            scientificName: "Escherichia coli",
            taxId: "562",
            isNew: true,
          },
        ],
      },
    },
  );
  expect(samplesResponse.ok()).toBeTruthy();

  const submitResponse = await page.request.put(`/api/orders/${draft.orderId}`, {
    headers: {
      "Content-Type": "application/json",
      "x-seqdesk-e2e": "playwright",
    },
    data: { status: "SUBMITTED" },
  });
  expect(submitResponse.ok()).toBeTruthy();

  return { orderId: draft.orderId, orderPath: draft.orderPath, sampleId };
}

test("admin uploads a read file and it is assigned to a sample", async ({ page }) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Playwright File Assignment ${Date.now()}`;
    const originalAllowDeleteSetting = await getAllowDeleteSubmittedOrdersState(page);
    let orderPath: string | null = null;
    let orderId: string | null = null;

    try {
      await setAllowDeleteSubmittedOrders(page, true);

      const created = await createSubmittedOrder(page, orderName);
      orderPath = created.orderPath;
      orderId = created.orderId;
      const { sampleId } = created;

      // Navigate to the order's sequencing/files area.
      await page.goto(`${orderPath}/sequencing`, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "Sequencing Data", level: 1 }),
      ).toBeVisible({ timeout: 30000 });

      // The seeded sample should render with no reads linked yet. The "No reads
      // linked" summary is present in both the mobile and desktop layouts; assert
      // on the visible (desktop) instance for this viewport.
      await expect(page.getByText(sampleId).first()).toBeVisible({ timeout: 30000 });
      await expect(
        page.locator(':text("No reads linked"):visible').first(),
      ).toBeVisible();

      // Open the per-sample actions menu and start a read upload for this sample.
      await page.getByRole("button", { name: `Actions for ${sampleId}` }).first().click();
      await page.getByRole("menuitem", { name: "Upload Reads" }).click();

      // The upload dialog opens pre-targeted at this sample with Read Role R1.
      const uploadDialog = page.getByRole("dialog");
      await expect(uploadDialog.getByText("Upload Files")).toBeVisible();

      // Provide the read file via the dialog's file input.
      await uploadDialog.locator('input[type="file"]').setInputFiles(READ_FIXTURE);

      // Submit the upload. The button reads "Upload File".
      await uploadDialog.getByRole("button", { name: "Upload File" }).click();

      // Upload + write-back completes by closing the dialog.
      await expect(uploadDialog).toBeHidden({ timeout: 60000 });

      // The sample now shows a linked read in the UI (single-end after R1 only).
      await expect(
        page.locator(':text("Single read linked"):visible').first(),
      ).toBeVisible({ timeout: 30000 });

      // End-to-end confirmation via the sequencing API: the uploaded file is linked
      // to this sample as file1 and is present on disk (not a stale/missing link).
      await expect
        .poll(
          async () => {
            const samples = await getOrderSequencingSamples(page, orderId as string);
            const sample = samples.find((item) => item.sampleId === sampleId);
            return Boolean(
              sample?.read?.file1 && sample.read.filesMissing !== true,
            );
          },
          { timeout: 60000, intervals: [1000, 2000, 3000] },
        )
        .toBe(true);

      const samples = await getOrderSequencingSamples(page, orderId);
      const sample = samples.find((item) => item.sampleId === sampleId);
      expect(sample?.read?.file1).toContain("sample_R1");
      expect(sample?.read?.file2).toBeFalsy();
    } finally {
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
