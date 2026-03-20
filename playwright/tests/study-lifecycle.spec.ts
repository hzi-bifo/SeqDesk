import { expect, test } from "@playwright/test";

import { createAndSubmitOrder, createStudyFromOrderSamples } from "./helpers";

test.setTimeout(60000);

test.use({ storageState: "playwright/.auth/researcher.json" });

test("researcher can mark a study ready, return it to draft, and delete it from the studies list", async ({
  page,
}) => {
  const orderName = `Playwright Study Lifecycle Source ${Date.now()}`;
  const studyTitle = `Playwright Study Lifecycle ${Date.now()}`;

  await createAndSubmitOrder(page, orderName, [
    { volume: "31", concentration: "12" },
    { volume: "42", concentration: "23" },
  ]);

  await createStudyFromOrderSamples(page, studyTitle);

  await expect(page.getByRole("button", { name: "Mark as Ready" })).toBeVisible();
  await page.getByRole("button", { name: "Mark as Ready" }).click();

  const markReadyDialog = page.getByRole("dialog");
  await expect(markReadyDialog).toContainText("Mark Study as Ready");
  await markReadyDialog.getByRole("button", { name: "Mark as Ready" }).click();

  await expect(page.getByText("Awaiting Facility Review")).toBeVisible();
  await expect(page.getByText("Marked as Ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Draft" })).toBeVisible();

  await page.getByRole("button", { name: "Back to Draft" }).click();

  const backToDraftDialog = page.getByRole("dialog");
  await expect(backToDraftDialog).toContainText("Return to Draft");
  await backToDraftDialog.getByRole("button", { name: "Back to Draft" }).click();

  await expect(page.getByText("Awaiting Facility Review")).toHaveCount(0);
  await expect(page.getByText("Marked as Ready", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark as Ready" })).toBeVisible();

  await page.goto("/studies");
  await expect(page.getByRole("heading", { name: /^(My Studies|All Studies)$/ })).toBeVisible();

  const searchInput = page.getByPlaceholder("Search studies...");
  await searchInput.fill(studyTitle);

  await page.getByRole("button", { name: `Options for ${studyTitle}` }).click();
  await page.getByRole("menuitem", { name: /delete study/i }).click();

  const deleteDialog = page.getByRole("dialog");
  await expect(deleteDialog).toContainText("Delete Study");
  await deleteDialog.getByRole("button", { name: "Delete Study" }).click();

  await expect(
    page.getByText(/No studies (match your filters|yet)/),
  ).toBeVisible({ timeout: 15000 });
});
