import { expect, test, type Page } from "@playwright/test";
import { createDraftOrder } from "./helpers";

test.setTimeout(90000);

async function openDemo(page: Page) {
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/orders$/);
  await expect(
    page.getByRole("heading", { name: /^(My Orders|All Orders)$/ })
  ).toBeVisible();
  await expect(page.getByTestId("demo-reset-button")).toBeVisible();
}

async function fetchOrderIdByName(
  page: Page,
  orderName: string
) {
  const response = await page.request.get("/api/orders");
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as {
    orders: Array<{ id: string; name: string | null }>;
  };
  const match = payload.orders.find((order) => order.name === orderName);
  expect(match).toBeTruthy();
  return match!.id;
}

async function fetchStudyIdByTitle(
  page: Page,
  title: string
) {
  const response = await page.request.get("/api/studies");
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as Array<{ id: string; title: string }>;
  const match = payload.find((study) => study.title === title);
  expect(match).toBeTruthy();
  return match!.id;
}

async function expectOrderInApi(page: Page, orderName: string, exists: boolean) {
  const response = await page.request.get("/api/orders");
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as {
    orders: Array<{ name: string | null }>;
  };
  const match = payload.orders.some((order) => order.name === orderName);
  expect(match).toBe(exists);
}

test("public demo boots with seeded researcher data and hides infra-backed tabs", async ({
  page,
}) => {
  await openDemo(page);

  const seededOrderId = await fetchOrderIdByName(page, "Gut recovery metagenome cohort");
  await page.goto(`/orders/${seededOrderId}`);
  await expect(page.getByRole("heading", { name: "Order Details" })).toBeVisible();
  await expect(page.getByText("Projects")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Read Files/i })).toHaveCount(0);
  await expect(page.getByText("Manage Files")).toHaveCount(0);

  const seededStudyId = await fetchStudyIdByTitle(page, "Gut Recovery Cohort");
  await page.goto(`/studies/${seededStudyId}`);
  await expect(page.getByText("Gut Recovery Cohort").first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /Read Files/i })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "ENA" })).toHaveCount(0);
});

test("demo changes persist in one browser session and disappear after reset", async ({
  page,
}) => {
  await openDemo(page);

  const orderName = `Demo Session ${Date.now()}`;
  const { orderPath } = await createDraftOrder(page, orderName, 1);

  await page.goto(orderPath);
  await expect(page.getByRole("heading", { name: "Order Details" })).toBeVisible();

  await expectOrderInApi(page, orderName, true);

  await page.reload();
  await expectOrderInApi(page, orderName, true);

  await page.getByTestId("demo-reset-button").click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole("heading", { name: /^(My Orders|All Orders)$/ })).toBeVisible();

  await expectOrderInApi(page, orderName, false);
});

test("different browser contexts stay isolated, while /demo and /demo/embed share one context", async ({
  browser,
  page,
}) => {
  await openDemo(page);

  const orderName = `Demo Shared ${Date.now()}`;
  await createDraftOrder(page, orderName, 1);
  await expectOrderInApi(page, orderName, true);

  const isolatedContext = await browser.newContext();
  const isolatedPage = await isolatedContext.newPage();
  await openDemo(isolatedPage);
  await expectOrderInApi(isolatedPage, orderName, false);
  await isolatedContext.close();

  const embedPage = await page.context().newPage();
  await embedPage.goto("/demo/embed");
  await expect(embedPage).toHaveURL(/\/orders$/);
  await expectOrderInApi(embedPage, orderName, true);

  await embedPage.close();
});
