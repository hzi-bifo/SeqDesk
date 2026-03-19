import { expect, test } from "@playwright/test";
import {
  continueToReviewFromDetailPage,
  createDraftOrder,
  createAndSubmitOrder,
  deleteCurrentOrder,
  getOrderSampleIds,
} from "./helpers";

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
  await expect(page.getByRole("main").getByText(orderName, { exact: true })).toBeVisible();
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

  await expect(page.getByRole("main").getByText(orderName, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Samples (2)" })).toBeVisible();
  const sampleRows = page.locator("tbody tr");
  await expect(sampleRows).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "60", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "30", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "40", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "15", exact: true })).toBeVisible();
});

test("researcher can delete a draft order from the detail page", async ({ page }) => {
  const orderName = `Playwright Draft Delete ${Date.now()}`;
  const { orderPath } = await createDraftOrder(page, orderName, 1);

  await page.goto(orderPath);
  await expect(page.getByRole("heading", { name: "Order Details" })).toBeVisible();
  await expect(page.getByText(orderName).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Samples (0)" })).toBeVisible();

  await deleteCurrentOrder(page);

  await expect(page).toHaveURL("/orders");
  const searchInput = page.getByPlaceholder("Search orders...");
  await searchInput.fill(orderName);
  await expect(page.getByText("No orders match your filters")).toBeVisible();
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

  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Order Details" })).toBeVisible();
  await expect(page.getByRole("main").getByText(updatedName, { exact: true })).toBeVisible();
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

  const orderLink = page.locator(`a[href="${orderPath}"]:visible`).first();
  await expect(orderLink).toBeVisible();

  const orderRow = page
    .locator("div.divide-y.divide-border > div")
    .filter({ has: orderLink })
    .first();
  await expect(orderRow).toContainText(orderName);
  await expect(orderRow).toContainText("Submitted");
  await expect(orderRow.locator("span.text-sm.text-muted-foreground.tabular-nums").first()).toHaveText("2");
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
  await expect(page.getByRole("heading", { name: studyTitle, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open Samples", exact: true }).click();
  await expect(page).toHaveURL(/\/studies\/.+\?tab=samples/);
  await expect(page.getByRole("heading", { name: "Samples (2)" })).toBeVisible();
  for (const sampleId of sampleIds) {
    await expect(page.getByText(sampleId)).toBeVisible();
  }
});
