import { expect, test, type Page } from "@playwright/test";

import {
  fillSampleFieldIfPresent,
  fillRequiredSampleRow,
  goToNewOrderSamplesStep,
  selectRadixOption,
  withResearcherPage,
} from "./helpers";

test.setTimeout(90000);

type FormConfigResponse = {
  fields: unknown[];
  groups: Array<{ name: string }>;
  enabledMixsChecklists?: string[];
};

async function readFormConfig(page: Page): Promise<FormConfigResponse> {
  const response = await page.request.get("/api/admin/form-config");
  if (!response.ok()) {
    throw new Error(`Failed to fetch form config: ${response.status()}`);
  }

  return response.json();
}

async function restoreFormConfig(page: Page, config: FormConfigResponse) {
  const response = await page.request.put("/api/admin/form-config", {
    headers: { "Content-Type": "application/json" },
    data: {
      fields: config.fields,
      groups: config.groups,
      enabledMixsChecklists: config.enabledMixsChecklists ?? [],
    },
  });

  if (!response.ok()) {
    throw new Error(`Failed to restore form config: ${response.status()}`);
  }
}

async function addField(
  page: Page,
  options: {
    addButtonTestId: string;
    tabName?: string;
    fieldLabel: string;
    fieldName: string;
    groupName?: string;
    required?: boolean;
    adminOnly?: boolean;
  },
) {
  const dialog = page.getByRole("dialog");

  if (options.tabName) {
    await page.getByRole("tab", { name: options.tabName }).click();
  }

  await page.getByTestId(options.addButtonTestId).click();
  await expect(dialog).toContainText("Add New Field");

  await page.getByTestId("form-builder-field-label").fill(options.fieldLabel);
  await page.getByTestId("form-builder-field-name").fill(options.fieldName);

  if (options.required) {
    await page.getByTestId("form-builder-field-required").check();
  }

  if (options.adminOnly) {
    await page.getByTestId("form-builder-field-admin-only").check();
  }

  if (options.groupName) {
    const groupField = page.getByTestId("form-builder-field-group");
    if (await groupField.count()) {
      await selectRadixOption(page, "form-builder-field-group", options.groupName);
    }
  }

  await page.getByTestId("form-builder-save-field-button").click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(options.fieldLabel, { exact: true }).first()).toBeVisible();
}

test("admin form-builder changes appear for researchers and enforce required validation", async ({
  browser,
  page,
}) => {
  await page.goto("/admin/form-builder");
  await expect(page.getByRole("heading", { name: "Order Configuration" })).toBeVisible();

  const originalConfig = await readFormConfig(page);
  const groupName =
    originalConfig.groups.find((group) => group.name === "Order Details")?.name
      ?? originalConfig.groups[0]?.name;

  expect(groupName).toBeTruthy();

  const uniqueSuffix = Date.now();
  const fieldLabel = `Playwright Required Field ${uniqueSuffix}`;
  const fieldName = `playwright_required_field_${uniqueSuffix}`;

  try {
    await addField(page, {
      addButtonTestId: "form-builder-order-add-field-button",
      tabName: "Per-Order Fields",
      fieldLabel,
      fieldName,
      groupName,
      required: true,
    });

    await page.getByTestId("form-builder-save-config-button").click();
    await expect(page.getByTestId("form-builder-save-config-button")).toContainText("Saved");

    await withResearcherPage(browser, async (researcherPage) => {
      await researcherPage.goto("/orders/new");
      await expect(researcherPage.getByTestId(`order-field-${fieldName}`)).toBeVisible();

      await researcherPage.getByTestId("order-field-name").fill(`Round Trip ${uniqueSuffix}`);
      await researcherPage.getByTestId("order-field-numberOfSamples").fill("1");
      await researcherPage.getByTestId("next-step-button").click();

      await expect(researcherPage.getByText("Required", { exact: true })).toBeVisible();
      await expect(researcherPage.getByRole("heading", { name: "Order Details" })).toBeVisible();

      await researcherPage.getByTestId(`order-field-${fieldName}`).fill("REQ-001");
      await researcherPage.getByTestId("next-step-button").click();
      await expect(
        researcherPage.getByRole("heading", {
          name: /Sequencing (Information|Parameters)/,
        }),
      ).toBeVisible();
    });
  } finally {
    await restoreFormConfig(page, originalConfig);
  }
});

test("facility-only order fields stay hidden from researchers and appear for admins", async ({
  browser,
  page,
}) => {
  await page.goto("/admin/form-builder");
  await expect(page.getByRole("heading", { name: "Order Configuration" })).toBeVisible();

  const originalConfig = await readFormConfig(page);
  const groupName =
    originalConfig.groups.find((group) => group.name === "Order Details")?.name
      ?? originalConfig.groups[0]?.name;

  expect(groupName).toBeTruthy();

  const uniqueSuffix = Date.now();
  const fieldLabel = `Playwright Admin Field ${uniqueSuffix}`;
  const fieldName = `playwright_admin_field_${uniqueSuffix}`;

  try {
    await addField(page, {
      addButtonTestId: "form-builder-order-add-field-button",
      tabName: "Per-Order Fields",
      fieldLabel,
      fieldName,
      groupName,
      adminOnly: true,
    });

    await page.getByTestId("form-builder-save-config-button").click();
    await expect(page.getByTestId("form-builder-save-config-button")).toContainText("Saved");

    await page.goto("/orders/new");
    await expect(page.getByRole("button", { name: "Facility Fields" })).toBeVisible();

    await goToNewOrderSamplesStep(page, `Admin Facility ${uniqueSuffix}`, 1);
    await fillRequiredSampleRow(page, 0, { volume: "45", concentration: "18" });
    await page.getByTestId("next-step-button").click();

    await expect(page.getByRole("heading", { name: "Facility Fields" })).toBeVisible();
    await expect(page.getByTestId(`order-field-${fieldName}`)).toBeVisible();
    await page.getByTestId(`order-field-${fieldName}`).fill("admin-only");
    await page.getByTestId("next-step-button").click();
    await expect(page.getByText("Ready to submit")).toBeVisible();

    await withResearcherPage(browser, async (researcherPage) => {
      await researcherPage.goto("/orders/new");
      await expect(
        researcherPage.getByRole("button", { name: "Facility Fields" }),
      ).toHaveCount(0);
      await expect(researcherPage.getByTestId(`order-field-${fieldName}`)).toHaveCount(0);
    });
  } finally {
    await restoreFormConfig(page, originalConfig);
  }
});

test("required per-sample fields added by admins appear in the sample table and block progress", async ({
  browser,
  page,
}) => {
  await page.goto("/admin/form-builder");
  await expect(page.getByRole("heading", { name: "Order Configuration" })).toBeVisible();

  const originalConfig = await readFormConfig(page);
  const uniqueSuffix = Date.now();
  const fieldLabel = `Playwright Sample Field ${uniqueSuffix}`;
  const fieldName = `playwright_sample_field_${uniqueSuffix}`;

  try {
    await addField(page, {
      addButtonTestId: "form-builder-sample-add-field-button",
      tabName: "Per-Sample",
      fieldLabel,
      fieldName,
      required: true,
    });

    await page.getByTestId("form-builder-save-config-button").click();
    await expect(page.getByTestId("form-builder-save-config-button")).toContainText("Saved");

    await withResearcherPage(browser, async (researcherPage) => {
      await goToNewOrderSamplesStep(researcherPage, `Sample Config ${uniqueSuffix}`, 1);
      await expect(researcherPage.getByTestId(`sample-cell-0-${fieldName}`)).toBeVisible();

      await fillRequiredSampleRow(researcherPage, 0, { volume: "52", concentration: "24" });
      await researcherPage.getByTestId("next-step-button").click();

      await expect(
        researcherPage.getByText(`Sample 1: ${fieldLabel} is required`),
      ).toBeVisible();
      await expect(researcherPage.getByRole("heading", { name: "Samples" })).toBeVisible();

      await fillSampleFieldIfPresent(researcherPage, 0, [fieldName], "configured sample value");
      await researcherPage.getByTestId("next-step-button").click();
      await expect(researcherPage.getByText("Ready to submit")).toBeVisible();
    });
  } finally {
    await restoreFormConfig(page, originalConfig);
  }
});
