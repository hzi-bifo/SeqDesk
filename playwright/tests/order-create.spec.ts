import { expect, test, type Page } from "@playwright/test";

async function selectRadixOption(page: Page, testId: string, optionName: RegExp | string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionName }).click();
}

async function selectBarcodeIfAvailable(page: Page, rowIndex: number, optionIndex = 0) {
  const barcodeCell = page.getByTestId(`sample-cell-${rowIndex}-_barcode`);
  if (!(await barcodeCell.isVisible())) return;

  const barcodeText = (await barcodeCell.textContent())?.trim() || "";
  if (!barcodeText || /select kit first/i.test(barcodeText)) {
    return;
  }

  await barcodeCell.click();
  const barcodeOptions = page.getByRole("menuitem").filter({ hasText: /^barcode\d+/i });
  const optionCount = await barcodeOptions.count();
  if (optionCount === 0) return;

  await barcodeOptions.nth(Math.min(optionIndex, optionCount - 1)).click();
}

type SampleInput = {
  volume: string;
  concentration: string;
};

async function createAndSubmitOrder(
  page: Page,
  orderName: string,
  samples: SampleInput[],
): Promise<{ orderPath: string }> {
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: /orders/i })).toBeVisible();

  await page.getByRole("link", { name: "New Order" }).first().click();
  await expect(page.getByRole("heading", { name: "New Sequencing Order" })).toBeVisible();

  await page.getByTestId("order-field-name").fill(orderName);
  await page.getByTestId("order-field-numberOfSamples").fill(String(samples.length));
  await page.getByTestId("next-step-button").click();

  await page.getByRole("heading", { name: "Illumina", level: 3 }).scrollIntoViewIfNeeded();
  await page.getByRole("heading", { name: "MiSeq", level: 4, exact: true }).click();
  await page.getByTestId("next-step-button").click();

  const additionalDetailsHeading = page.getByRole("heading", { name: "Additional Details" });
  if (await additionalDetailsHeading.isVisible()) {
    const libraryStrategy = page.getByTestId("order-field-libraryStrategy");
    if (await libraryStrategy.isVisible()) {
      await selectRadixOption(page, "order-field-libraryStrategy", /WGS/i);
    }

    const librarySource = page.getByTestId("order-field-librarySource");
    if (await librarySource.isVisible()) {
      await selectRadixOption(page, "order-field-librarySource", /Metagenomic/i);
    }

    await page.getByTestId("next-step-button").click();
  }

  await expect(page.getByText("Add your samples below.")).toBeVisible();

  for (const [index, sample] of samples.entries()) {
    await page.getByTestId(`sample-cell-${index}-sample_volume`).fill(sample.volume);
    await page.getByTestId(`sample-cell-${index}-sample_concentration`).fill(sample.concentration);
    await selectBarcodeIfAvailable(page, index, index);
  }

  await page.getByTestId("next-step-button").click();

  await expect(page.getByText("Ready to submit")).toBeVisible();
  await page.getByTestId("submit-order-button").click();

  await expect(page.getByRole("dialog")).toContainText("Order Submitted");
  await page.getByRole("button", { name: /view order/i }).click();

  await expect(page).toHaveURL(/\/orders\/.+/);
  const url = new URL(page.url());
  return { orderPath: url.pathname };
}

async function getOrderSampleIds(page: Page): Promise<string[]> {
  const sampleIdCells = page.locator("code.text-xs.bg-muted");
  const count = await sampleIdCells.count();
  const sampleIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const text = (await sampleIdCells.nth(i).textContent())?.trim();
    if (text?.startsWith("S-")) {
      sampleIds.push(text);
    }
  }

  return sampleIds;
}

async function continueToReviewFromDetailPage(page: Page) {
  for (let i = 0; i < 5; i++) {
    if (await page.getByText("Ready to update").isVisible()) {
      return;
    }

    if (await page.getByRole("heading", { name: "Sequencing Parameters" }).isVisible()) {
      await page.getByRole("heading", { name: "Illumina", level: 3 }).scrollIntoViewIfNeeded();
      await page.getByRole("heading", { name: "MiSeq", level: 4, exact: true }).click();
    }

    if (await page.getByRole("heading", { name: "Additional Details" }).isVisible()) {
      const libraryStrategy = page.getByTestId("order-field-libraryStrategy");
      if (await libraryStrategy.isVisible()) {
        await selectRadixOption(page, "order-field-libraryStrategy", /WGS/i);
      }

      const librarySource = page.getByTestId("order-field-librarySource");
      if (await librarySource.isVisible()) {
        await selectRadixOption(page, "order-field-librarySource", /Metagenomic/i);
      }
    }

    await page.getByTestId("next-step-button").click();
  }

  await expect(page.getByText("Ready to update")).toBeVisible();
}

test.setTimeout(60000);

test.use({ storageState: "playwright/.auth/researcher.json" });

test("wizard blocks progress when order name is missing", async ({ page }) => {
  await page.goto("/orders/new");
  await expect(page.getByRole("heading", { name: "New Sequencing Order" })).toBeVisible();

  await page.getByTestId("next-step-button").click();

  await expect(page.getByText("Required")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order Details" })).toBeVisible();
  await expect(page.getByText(/Step 1 of/i)).toBeVisible();
});

test("researcher can create and submit an order", async ({ page }) => {
  const orderName = `Playwright Order ${Date.now()}`;
  await createAndSubmitOrder(page, orderName, [
    { volume: "50", concentration: "25" },
  ]);
  await expect(page.getByText(orderName)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order Details" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "50", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "25", exact: true })).toBeVisible();
});

test("researcher can create an order with multiple samples", async ({ page }) => {
  const orderName = `Playwright Multi ${Date.now()}`;

  await createAndSubmitOrder(page, orderName, [
    { volume: "60", concentration: "30" },
    { volume: "40", concentration: "15" },
  ]);

  await expect(page.getByText(orderName)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Samples (2)" })).toBeVisible();
  const sampleRows = page.locator("tbody tr");
  await expect(sampleRows).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "60", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "30", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "40", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "15", exact: true })).toBeVisible();
});

test("researcher can edit submitted order information", async ({ page }) => {
  const originalName = `Playwright Editable ${Date.now()}`;
  const updatedName = `${originalName} Updated`;

  await createAndSubmitOrder(page, originalName, [
    { volume: "55", concentration: "22" },
  ]);

  await expect(page.getByRole("link", { name: /change order information/i })).toBeVisible();
  await page.getByRole("link", { name: /change order information/i }).click();

  await expect(page).toHaveURL(/\/orders\/.+\/edit/);
  await expect(page.getByTestId("order-field-name")).toHaveValue(originalName);

  await page.getByTestId("order-field-name").fill(updatedName);
  await continueToReviewFromDetailPage(page);

  await expect(page.getByText("Ready to update")).toBeVisible();
  await page.getByRole("button", { name: /update order/i }).click();

  await expect(page).toHaveURL(/\/orders\/.+/);
  await expect(page.getByText(updatedName)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Samples (1)" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "55", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "22", exact: true })).toBeVisible();
});

test("submitted order appears on the orders list with sample count", async ({ page }) => {
  const orderName = `Playwright Listed ${Date.now()}`;
  const { orderPath } = await createAndSubmitOrder(page, orderName, [
    { volume: "33", concentration: "11" },
    { volume: "44", concentration: "22" },
  ]);

  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: /orders/i })).toBeVisible();

  const searchInput = page.getByPlaceholder("Search orders...");
  await searchInput.fill(orderName);

  const orderLink = page.locator(`a[href="${orderPath}"]`).first();
  await expect(orderLink).toBeVisible();

  const orderRow = page.locator("div").filter({ has: orderLink }).first();
  await expect(orderRow).toContainText(orderName);
  await expect(orderRow).toContainText("Submitted");
  await expect(orderRow).toContainText("2");
});

test("submitted order can be marked as sent", async ({ page }) => {
  const orderName = `Playwright Sent ${Date.now()}`;
  await createAndSubmitOrder(page, orderName, [
    { volume: "35", concentration: "14" },
  ]);

  const orderProcessSection = page.locator("div").filter({
    has: page.getByRole("heading", { name: "Order Process" }),
  }).first();

  await expect(orderProcessSection.getByText("Send Samples to Institutions")).toBeVisible();
  await expect(orderProcessSection.getByRole("button", { name: /mark sent/i })).toBeVisible();
  await expect(orderProcessSection.getByText("In Progress")).toBeVisible();

  await orderProcessSection.getByRole("button", { name: /mark sent/i }).click();

  await expect(orderProcessSection.getByText(/Marked as sent by .* on/)).toBeVisible();
  await expect(orderProcessSection.getByText("Done")).toHaveCount(2);
  await expect(orderProcessSection.getByRole("button", { name: /mark sent/i })).toHaveCount(0);
  await expect(page.getByText("Samples marked as sent to institution")).toBeVisible();
});

test("researcher can create a study from order samples", async ({ page }) => {
  const orderName = `Playwright Study Source ${Date.now()}`;
  const studyTitle = `Playwright Study ${Date.now()}`;

  await createAndSubmitOrder(page, orderName, [
    { volume: "31", concentration: "12" },
    { volume: "42", concentration: "23" },
  ]);

  const sampleIds = await getOrderSampleIds(page);
  await expect(sampleIds.length).toBe(2);

  await page.goto("/studies/new");
  await expect(page.getByRole("heading", { name: "New Study" })).toBeVisible();

  for (const sampleId of sampleIds) {
    await page.getByRole("button", { name: new RegExp(sampleId) }).click();
  }

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Study Title *").fill(studyTitle);
  await page.getByRole("button", { name: "Next", exact: true }).click();

  const environmentHeading = page.getByRole("heading", { name: "Environment Type" });
  if (await environmentHeading.isVisible()) {
    await page.getByRole("button", { name: /Human Associated/i }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  const metadataHeading = page.getByRole("heading", { name: "Sample Metadata" });
  if (await metadataHeading.isVisible()) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  await expect(page.getByText("Ready to create your study")).toBeVisible();
  await page.getByRole("button", { name: /create study/i }).click();

  const warningDialog = page.getByRole("dialog");
  if (await warningDialog.isVisible()) {
    await page.getByRole("button", { name: /create anyway/i }).click();
  }

  await expect(page).toHaveURL(/\/studies\/.+/);
  await expect(page.getByText(studyTitle)).toBeVisible();
  await page.getByRole("tab", { name: /samples/i }).click();
  await expect(page.getByRole("heading", { name: "Samples (2)" })).toBeVisible();
  for (const sampleId of sampleIds) {
    await expect(page.getByText(sampleId)).toBeVisible();
  }
});
