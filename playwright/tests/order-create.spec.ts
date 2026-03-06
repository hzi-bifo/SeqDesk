import { expect, test, type Page } from "@playwright/test";

async function selectRadixOption(page: Page, testId: string, optionName: RegExp | string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.setTimeout(60000);

test("researcher can create and submit an order", async ({ page }) => {
  const orderName = `Playwright Order ${Date.now()}`;

  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: /orders/i })).toBeVisible();

  await page.getByRole("link", { name: "New Order" }).first().click();
  await expect(page.getByRole("heading", { name: "New Sequencing Order" })).toBeVisible();

  await page.getByTestId("order-field-name").fill(orderName);
  await page.getByTestId("order-field-numberOfSamples").fill("1");
  await page.getByTestId("next-step-button").click();

  await page.getByRole("heading", { name: "Illumina", level: 3 }).scrollIntoViewIfNeeded();
  await page.getByRole("heading", { name: "MiSeq", level: 4 }).click();
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
  await page.getByTestId("next-step-button").click();

  await expect(page.getByText("Ready to submit")).toBeVisible();
  await page.getByTestId("submit-order-button").click();

  await expect(page.getByRole("dialog")).toContainText("Order Submitted");
  await page.getByRole("button", { name: /view order/i }).click();

  await expect(page).toHaveURL(/\/orders\/.+/);
  await expect(page.getByText(orderName)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order Details" })).toBeVisible();
});
