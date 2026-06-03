import { expect, test, type Page } from "@playwright/test";
import { createAndSubmitOrder, getOrderSampleIds } from "./helpers";

// Researcher context (default chromium project). Verifies the new-study checklist
// picker is populated from the MIxS registry (not the old hardcoded list): a study
// is created against a checklist that was never in the hardcoded set, the chosen
// checklist's ENA accession is persisted, and the metadata page resolves it (the
// previously broken /api/mixs/checklists fetch is now fixed).
test.setTimeout(120000);

async function deleteStudyFromList(page: Page, studyTitle: string) {
  await page.goto("/studies");
  await expect(
    page.getByRole("heading", { name: /^(My Studies|All Studies)$/ }),
  ).toBeVisible();
  await page.getByPlaceholder("Search studies...").fill(studyTitle);
  const optionsButton = page.getByRole("button", { name: `Options for ${studyTitle}` });
  if (!(await optionsButton.isVisible({ timeout: 10000 }).catch(() => false))) return;
  await optionsButton.click();
  await page.getByRole("menuitem", { name: /delete study/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete Study");
  await dialog.getByRole("button", { name: "Delete Study" }).click();
  await expect(
    page.getByText(/No studies (match your filters|yet)/),
  ).toBeVisible({ timeout: 15000 });
}

test("the new-study checklist picker is populated from the registry", async ({ page }) => {
  const stamp = Date.now();
  const orderName = `Playwright Picker Order ${stamp}`;
  const studyTitle = `Playwright Picker Study ${stamp}`;
  let createdTitle: string | null = null;

  try {
    await createAndSubmitOrder(page, orderName, [{ volume: "30", concentration: "12" }]);
    const sampleIds = await getOrderSampleIds(page);
    expect(sampleIds.length).toBe(1);

    await page.goto("/studies/new");
    await expect(page.getByRole("heading", { name: "New Study" })).toBeVisible();
    for (const sampleId of sampleIds) {
      await page.getByRole("button", { name: new RegExp(sampleId) }).click();
    }
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Study Title *").fill(studyTitle);
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Environment Type step — the picker is now registry-driven.
    await expect(page.getByRole("heading", { name: "Environment Type" })).toBeVisible();

    // Neither of these was in the old hardcoded picker. Their presence proves the
    // picker is built from the registry: a GSC environment package (human vaginal,
    // ERC000018) and a non-environmental genome checklist (GSC MIMAGS, ERC000047).
    await expect(
      page.getByRole("button", { name: /GSC MIxS human vaginal/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /GSC MIMAGS/i })).toBeVisible();

    // Select the human-vaginal package and finish the wizard.
    createdTitle = studyTitle;
    await page.getByRole("button", { name: /GSC MIxS human vaginal/i }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    const metadataHeading = page.getByRole("heading", { name: "Sample Metadata" });
    if (await metadataHeading.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
    await expect(page.getByText("Ready to create your study")).toBeVisible();
    const studyNavigation = page.waitForURL(/\/studies\/.+/, { timeout: 20000 });
    await page.getByRole("button", { name: /create study/i }).click();
    const createAnyway = page.getByRole("button", { name: /create anyway/i });
    if (await createAnyway.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createAnyway.click();
    }
    await studyNavigation;
    await expect(
      page.getByRole("heading", { name: studyTitle, exact: true }),
    ).toBeVisible({ timeout: 15000 });

    // The study persists the ENA accession (not a legacy slug).
    const studyId = new URL(page.url()).pathname.split("/").filter(Boolean).pop() as string;
    const studyRes = await page.request.get(`/api/studies/${studyId}`);
    expect(studyRes.ok()).toBeTruthy();
    const study = await studyRes.json();
    expect(study.checklistType).toBe("ERC000018");

    // The metadata page resolves the checklist by accession (the previously broken
    // fetch is fixed): the header shows the resolved registry name. If resolution
    // failed it would instead show the raw "ERC000018".
    await page.goto(`/studies/${studyId}/metadata`);
    await expect(
      page.getByText(/GSC MIxS human vaginal/i),
    ).toBeVisible({ timeout: 20000 });
  } finally {
    if (createdTitle) await deleteStudyFromList(page, createdTitle).catch(() => {});
  }
});
