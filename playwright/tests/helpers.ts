import { expect, type Browser, type Locator, type Page } from "@playwright/test";

export type SampleInput = {
  volume: string;
  concentration: string;
};

async function findSampleField(
  page: Page,
  rowIndex: number,
  columnIds: string[],
): Promise<Locator | null> {
  for (const columnId of columnIds) {
    const field = page.getByTestId(`sample-cell-${rowIndex}-${columnId}`);
    if (await field.count()) {
      return field;
    }
  }

  return null;
}

export async function fillSampleFieldIfPresent(
  page: Page,
  rowIndex: number,
  columnIds: string[],
  value: string,
) {
  const field = await findSampleField(page, rowIndex, columnIds);
  if (!field) return false;

  await field.fill(value);
  await field.blur();
  return true;
}

export async function fillOrganismFieldIfPresent(page: Page, rowIndex: number, value: string) {
  const field = await findSampleField(page, rowIndex, ["organism", "_organism"]);
  if (!field) return false;

  await field.fill(value);
  await expect(field).toHaveValue(value);
  await field.blur();

  if (/^\d+$/.test(value)) {
    await expect(field).toHaveValue(/Escherichia coli/i);
  }

  // Organism selection commits on a delayed blur handler.
  await page.waitForTimeout(200);
  return true;
}

async function completeSequencingParameters(page: Page) {
  const sequencingTechHeading = page.getByRole("heading", { name: "Illumina", level: 3 });
  const platformField = page.getByTestId("order-field-platform");

  if (await sequencingTechHeading.isVisible()) {
    await sequencingTechHeading.scrollIntoViewIfNeeded();
    await page.getByRole("heading", { name: "MiSeq", level: 4, exact: true }).click();
  } else if (await platformField.isVisible()) {
    await selectRadixOption(page, "order-field-platform", /Illumina/i);

    const instrumentModel = page.getByTestId("order-field-instrumentModel");
    if (await instrumentModel.isVisible()) {
      await selectRadixOption(page, "order-field-instrumentModel", /MiSeq/i);
    }
  }

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
}

export async function goToNewOrderSamplesStep(
  page: Page,
  orderName: string,
  sampleCount: number,
) {
  await page.goto("/orders");
  await expect(
    page.getByRole("heading", { name: /^(My Orders|All Orders)$/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: "New Order" }).first().click();
  await expect(page.getByRole("heading", { name: "New Sequencing Order" })).toBeVisible();

  await page.getByTestId("order-field-name").fill(orderName);
  await page.getByTestId("order-field-numberOfSamples").fill(String(sampleCount));
  await page.getByTestId("next-step-button").click();

  await completeSequencingParameters(page);
  await expect(page.getByText("Add your samples below.")).toBeVisible();
}

export async function fillRequiredSampleRow(
  page: Page,
  rowIndex: number,
  sample: SampleInput,
) {
  await fillOrganismFieldIfPresent(page, rowIndex, "562");
  await fillSampleFieldIfPresent(
    page,
    rowIndex,
    ["sample_title", "_sampleTitle", "sampleTitle"],
    `Playwright sample ${rowIndex + 1}`,
  );

  const volumeField = page.getByTestId(`sample-cell-${rowIndex}-sample_volume`);
  await volumeField.fill(sample.volume);
  await volumeField.blur();

  const concentrationField = page.getByTestId(`sample-cell-${rowIndex}-sample_concentration`);
  await concentrationField.fill(sample.concentration);
  await concentrationField.blur();

  await selectBarcodeIfAvailable(page, rowIndex, rowIndex);
  await page.waitForTimeout(200);
}

export async function selectRadixOption(
  page: Page,
  testId: string,
  optionName: RegExp | string,
) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionName }).click();
}

export async function selectBarcodeIfAvailable(page: Page, rowIndex: number, optionIndex = 0) {
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

export async function createAndSubmitOrder(
  page: Page,
  orderName: string,
  samples: SampleInput[],
): Promise<{ orderPath: string }> {
  await goToNewOrderSamplesStep(page, orderName, samples.length);

  for (const [index, sample] of samples.entries()) {
    await fillRequiredSampleRow(page, index, sample);
  }

  await page.waitForTimeout(150);
  await page.getByTestId("next-step-button").click();

  for (let i = 0; i < 3; i++) {
    const submitButton = page.getByTestId("submit-order-button");
    if (await submitButton.isVisible()) {
      break;
    }

    const facilityFieldsHeading = page.getByRole("heading", { name: "Facility Fields" });
    if (await facilityFieldsHeading.isVisible()) {
      const facilityTextboxes = page.getByRole("textbox");
      const textboxCount = await facilityTextboxes.count();
      for (let j = 0; j < textboxCount; j++) {
        const textbox = facilityTextboxes.nth(j);
        if (await textbox.isVisible()) {
          await textbox.fill(`Playwright admin note ${Date.now()} for facility review`);
          await textbox.blur();
        }
      }
    }

    const nextButton = page.getByTestId("next-step-button");
    if (await nextButton.isVisible()) {
      await nextButton.click();
      continue;
    }

    break;
  }

  await expect(page.getByText("Ready to submit")).toBeVisible();
  await page.getByTestId("submit-order-button").click();

  await expect(page.getByRole("dialog")).toContainText("Order Submitted");
  await page.getByRole("button", { name: /view order/i }).click();

  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/^\/orders\/(?!new$)[^/]+$/);
  const url = new URL(page.url());
  return { orderPath: url.pathname };
}

export async function createDraftOrder(
  page: Page,
  orderName: string,
  numberOfSamples = 1,
): Promise<{ orderId: string; orderPath: string }> {
  const response = await page.request.post("/api/orders", {
    headers: {
      "Content-Type": "application/json",
      "x-seqdesk-e2e": "playwright",
    },
    data: {
      name: orderName,
      numberOfSamples: String(numberOfSamples),
    },
  });

  expect(response.ok()).toBeTruthy();

  const order = await response.json();
  return {
    orderId: order.id as string,
    orderPath: `/orders/${order.id as string}`,
  };
}

export async function setAllowDeleteSubmittedOrders(page: Page, enabled: boolean) {
  await page.goto("/admin/form-builder?tab=settings#data-handling");
  await expect(page.getByRole("heading", { name: "Advanced Settings" })).toBeVisible();

  const deleteSwitch = page.getByRole("checkbox", {
    name: /allow deletion of submitted orders/i,
  });
  await expect(deleteSwitch).toBeVisible();

  const isChecked = await deleteSwitch.isChecked();
  if (isChecked !== enabled) {
    await deleteSwitch.setChecked(enabled, { force: true });
  }

  if (enabled) {
    await expect(deleteSwitch).toBeChecked();
  } else {
    await expect(deleteSwitch).not.toBeChecked();
  }
}

export async function deleteCurrentOrder(page: Page) {
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Delete Order");

  const confirmInput = page.getByPlaceholder("Type DELETE to confirm");
  if (await confirmInput.isVisible()) {
    await confirmInput.fill("DELETE");
  }

  await page.getByRole("button", { name: "Delete Order", exact: true }).click();
}

export async function getOrderSampleIds(page: Page): Promise<string[]> {
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

export async function createStudyFromOrderSamples(
  page: Page,
  studyTitle: string,
) {
  const sampleIds = await getOrderSampleIds(page);
  await expect(sampleIds.length).toBeGreaterThan(0);

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
  return { sampleIds, studyPath: new URL(page.url()).pathname };
}

export async function withResearcherPage<T>(
  browser: Browser,
  callback: (page: Page) => Promise<T>,
) {
  const context = await browser.newContext({
    storageState: "playwright/.auth/researcher.json",
  });
  const page = await context.newPage();

  try {
    return await callback(page);
  } finally {
    await context.close();
  }
}

export async function continueToReviewFromDetailPage(page: Page) {
  for (let i = 0; i < 5; i++) {
    if (await page.getByText("Ready to update").isVisible()) {
      return;
    }

    if (await page.getByRole("heading", { name: "Sequencing Parameters" }).isVisible()) {
      const sequencingTechHeading = page.getByRole("heading", { name: "Illumina", level: 3 });
      const platformField = page.getByTestId("order-field-platform");

      if (await sequencingTechHeading.isVisible()) {
        await sequencingTechHeading.scrollIntoViewIfNeeded();
        await page.getByRole("heading", { name: "MiSeq", level: 4, exact: true }).click();
      } else if (await platformField.isVisible()) {
        await selectRadixOption(page, "order-field-platform", /Illumina/i);

        const instrumentModel = page.getByTestId("order-field-instrumentModel");
        if (await instrumentModel.isVisible()) {
          await selectRadixOption(page, "order-field-instrumentModel", /MiSeq/i);
        }
      }
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
