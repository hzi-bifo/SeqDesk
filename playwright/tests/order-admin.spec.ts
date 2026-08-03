import { expect, test } from "@playwright/test";
import {
  createAndSubmitOrder,
  createStudyFromOrderSamples,
  deleteCurrentOrder,
  setAllowDeleteSubmittedOrders,
  withAllowDeleteSubmittedOrdersLock,
} from "./helpers";

test.setTimeout(60000);

test.use({ storageState: "playwright/.auth/admin.json" });

test("admin can create and submit an order", async ({ page }) => {
  const orderName = `Admin Order ${Date.now()}`;

  await createAndSubmitOrder(page, orderName, [
    { volume: "70", concentration: "28" },
  ]);

  await expect(page.getByText(orderName, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sequencing Order Details" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "70", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "28", exact: true })).toBeVisible();
});

test("admin can create a study from their own order samples", async ({ page }) => {
  const orderName = `Admin Study Source ${Date.now()}`;
  const studyTitle = `Admin Study ${Date.now()}`;

  await createAndSubmitOrder(page, orderName, [
    { volume: "26", concentration: "9" },
    { volume: "29", concentration: "10" },
  ]);

  const { sampleIds } = await createStudyFromOrderSamples(page, studyTitle);
  expect(sampleIds).toHaveLength(2);

  await page.getByRole("link", { name: "Open Samples", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      /^\/studies\/(?!new\/?$)[^/]+\/?$/.test(url.pathname) &&
      url.searchParams.get("tab") === "samples",
    { timeout: 15000 },
  );
  await expect(page.getByRole("heading", { name: "Samples (2)" })).toBeVisible({
    timeout: 15000,
  });
  for (const sampleId of sampleIds) {
    await expect(page.getByText(sampleId)).toBeVisible();
  }
});

test("admin can see researcher orders in all orders list", async ({ browser, page }) => {
  const researcherContext = await browser.newContext({
    storageState: "playwright/.auth/researcher.json",
  });
  const researcherPage = await researcherContext.newPage();

  const orderName = `Researcher Visible ${Date.now()}`;
  const { orderPath } = await createAndSubmitOrder(researcherPage, orderName, [
    { volume: "47", concentration: "18" },
  ]);
  await researcherContext.close();

  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: /all sequencing orders/i })).toBeVisible();

  const searchInput = page.getByPlaceholder("Search sequencing orders...");
  await searchInput.fill(orderName);

  const orderLink = page.locator(`a[href="${orderPath}"]:visible`).first();
  await expect(orderLink).toBeVisible();
  const orderRow = page
    .locator("div.divide-y.divide-border > div")
    .filter({ has: orderLink })
    .first();
  await expect(orderRow).toContainText(orderName);
  await expect(orderRow).toContainText("Submitted");
});

test("admin cannot delete submitted orders when Data Handling disables it", async ({ page }) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Admin Protected Delete ${Date.now()}`;

    await setAllowDeleteSubmittedOrders(page, false);
    await createAndSubmitOrder(page, orderName, [
      { volume: "51", concentration: "19" },
    ]);

    await deleteCurrentOrder(page);

    await expect(
      page.getByText("Deletion of submitted orders is disabled. Enable it in"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /settings > data handling/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/orders\/.+/);
    await expect(page.getByRole("heading", { name: "Sequencing Order Details" })).toBeVisible();
    await expect(page.getByText(orderName).first()).toBeVisible();
  });
});

test("admin can delete submitted orders when Data Handling enables it", async ({ page }) => {
  await withAllowDeleteSubmittedOrdersLock(async () => {
    const orderName = `Admin Allowed Delete ${Date.now()}`;

    await setAllowDeleteSubmittedOrders(page, true);

    try {
      await createAndSubmitOrder(page, orderName, [
        { volume: "58", concentration: "21" },
      ]);

      await deleteCurrentOrder(page);

      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 15000 })
        .toBe("/orders");

      const searchInput = page.getByPlaceholder("Search sequencing orders...");
      await searchInput.fill(orderName);
      await expect(page.getByText("No sequencing orders match your filters")).toBeVisible();
    } finally {
      await setAllowDeleteSubmittedOrders(page, false);
    }
  });
});
