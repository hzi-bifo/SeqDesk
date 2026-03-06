import { writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
  fillOrganismFieldIfPresent,
  fillRequiredSampleRow,
  fillSampleFieldIfPresent,
  goToNewOrderSamplesStep,
} from "./helpers";

test.setTimeout(60000);

test.use({ storageState: "playwright/.auth/researcher.json" });

async function getSampleField(page: Page, rowIndex: number, columnIds: string[]) {
  for (const columnId of columnIds) {
    const field = page.getByTestId(`sample-cell-${rowIndex}-${columnId}`);
    if (await field.count()) {
      return field;
    }
  }

  throw new Error(`No sample field found for row ${rowIndex}: ${columnIds.join(", ")}`);
}

async function createExcelImportFile(
  filePath: string,
  rows: Array<Record<string, unknown>>,
) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Samples");
  const headers = [
    "Sample ID",
    "_organism_taxId",
    "sample_title",
    "sample_volume",
    "sample_concentration",
  ];

  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(headers.map((header) => row[header] ?? null));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(filePath, Buffer.from(buffer));
}

test("sample table supports copying organism and add/remove row actions", async ({ page }) => {
  await goToNewOrderSamplesStep(page, `Playwright Sample Actions ${Date.now()}`, 2);

  await fillOrganismFieldIfPresent(page, 0, "562");

  await page.getByTestId("sample-quick-actions-button").click();
  await page.getByTestId("sample-quick-action-copy-organism").click();

  const secondRowOrganism = await getSampleField(page, 1, ["organism", "_organism"]);
  await expect(secondRowOrganism).toHaveValue(/Escherichia coli/i);

  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.getByTestId("remove-sample-button-1").click();
  await expect(page.locator("tbody tr")).toHaveCount(1);

  await page.getByTestId("add-row-button").click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
});

test("sample table blocks duplicate sample aliases", async ({ page }) => {
  await goToNewOrderSamplesStep(page, `Playwright Duplicate Alias ${Date.now()}`, 2);

  await fillRequiredSampleRow(page, 0, { volume: "60", concentration: "30" });
  await fillRequiredSampleRow(page, 1, { volume: "40", concentration: "15" });

  await fillSampleFieldIfPresent(page, 0, ["sample_alias", "_sampleAlias", "sampleAlias"], "alias-1");
  await fillSampleFieldIfPresent(page, 1, ["sample_alias", "_sampleAlias", "sampleAlias"], "alias-1");

  await page.getByTestId("next-step-button").click();

  await expect(page.getByText("Sample Alias values must be unique")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Samples" })).toBeVisible();
});

test("excel import populates sample rows and allows continuing", async ({ page }, testInfo) => {
  await goToNewOrderSamplesStep(page, `Playwright Excel Import ${Date.now()}`, 1);

  const filePath = testInfo.outputPath("sample-import.xlsx");
  await createExcelImportFile(filePath, [
    {
      "Sample ID": "S-PLAY-001",
      _organism_taxId: "562",
      sample_title: "Imported sample 1",
      sample_volume: "51",
      sample_concentration: "19",
    },
    {
      "Sample ID": "S-PLAY-002",
      _organism_taxId: "9606",
      sample_title: "Imported sample 2",
      sample_volume: "74",
      sample_concentration: "28",
    },
  ]);

  await page.getByTestId("sample-excel-file-input").setInputFiles(filePath);
  await expect(page.getByTestId("sample-excel-validation-dialog")).toBeVisible();
  await expect(page.getByText("Parsed 2 rows from the uploaded file.")).toBeVisible();
  await page.getByTestId("sample-excel-import-all-button").click();

  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByText("S-PLAY-001", { exact: true })).toBeVisible();
  await expect(page.getByText("S-PLAY-002", { exact: true })).toBeVisible();
  await expect(await getSampleField(page, 0, ["organism", "_organism"])).toHaveValue(/Escherichia coli/i);
  await expect(await getSampleField(page, 1, ["organism", "_organism"])).toHaveValue(/Homo sapiens/i);
  await expect(await getSampleField(page, 0, ["sample_title", "_sampleTitle", "sampleTitle"])).toHaveValue(
    "Imported sample 1",
  );
  await expect(await getSampleField(page, 1, ["sample_title", "_sampleTitle", "sampleTitle"])).toHaveValue(
    "Imported sample 2",
  );
  await expect(page.getByTestId("sample-cell-0-sample_volume")).toHaveValue("51");
  await expect(page.getByTestId("sample-cell-0-sample_concentration")).toHaveValue("19");
  await expect(page.getByTestId("sample-cell-1-sample_volume")).toHaveValue("74");
  await expect(page.getByTestId("sample-cell-1-sample_concentration")).toHaveValue("28");

  await page.getByTestId("next-step-button").click();
  await expect(page.getByText("Ready to submit")).toBeVisible();
});
