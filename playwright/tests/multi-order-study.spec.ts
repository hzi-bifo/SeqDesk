import { expect, test, type Page } from "@playwright/test";

import { createAndSubmitOrder, getOrderSampleIds } from "./helpers";

// A study can include samples drawn from more than one order: the study
// creation wizard's "Select Samples" step lists every unassigned sample the
// user owns (GET /api/samples) in a single flat list, regardless of which order
// each sample came from (src/app/(dashboard)/studies/new/page.tsx renders one
// <button> per sample with the sample id + source order in the accessible
// name). This spec creates two submitted orders, each with one sample, then
// builds one study that selects the sample from BOTH orders. It asserts that
// both samples and both source order names appear on the study's Samples tab,
// then exercises a state transition (Mark as Ready -> Back to Draft) and finally
// deletes the study for cleanup.
//
// Cleanup note: createAndSubmitOrder leaves the orders in SUBMITTED state, and
// deleting submitted orders requires the admin-only allowDeleteSubmittedOrders
// setting (src/app/api/orders/[id]/route.ts), which a researcher cannot toggle.
// So, exactly like study-lifecycle.spec.ts and order-create.spec.ts, we only
// clean up the study; deleting it unassigns its samples. The two submitted
// orders are left behind as harmless timestamped test data.
//
// Patterns reused from order-create.spec.ts / order-admin.spec.ts /
// study-lifecycle.spec.ts: createAndSubmitOrder + getOrderSampleIds, the
// wizard-step navigation, the Mark-as-Ready / Back-to-Draft dialogs, and the
// studies-list delete flow.

test.setTimeout(120000);

test.use({ storageState: "playwright/.auth/researcher.json" });

// Step through the study wizard, selecting an explicit set of sample ids that
// may span multiple orders. Mirrors createStudyFromOrderSamples in helpers.ts,
// but takes the sample ids directly instead of scraping a single order page.
async function createStudyFromSampleIds(
  page: Page,
  studyTitle: string,
  sampleIds: string[],
): Promise<{ studyPath: string }> {
  await page.goto("/studies/new");
  await expect(page.getByRole("heading", { name: "New Study" })).toBeVisible();

  for (const sampleId of sampleIds) {
    // Each unassigned sample renders as a button whose accessible name contains
    // the sample id; this list is shared across all of the user's orders.
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
  const studyNavigation = page.waitForURL(/\/studies\/.+/, { timeout: 20000 });
  await page.getByRole("button", { name: /create study/i }).click();

  // Missing optional per-sample metadata only produces a soft warning.
  const createAnywayButton = page.getByRole("button", { name: /create anyway/i });
  if (await createAnywayButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole("button", { name: /create anyway/i }).click();
  }

  await studyNavigation;
  await expect(
    page.getByRole("heading", { name: studyTitle, exact: true }),
  ).toBeVisible({ timeout: 15000 });

  return { studyPath: new URL(page.url()).pathname };
}

async function deleteStudyFromList(page: Page, studyTitle: string) {
  await page.goto("/studies");
  await expect(
    page.getByRole("heading", { name: /^(My Studies|All Studies)$/ }),
  ).toBeVisible();

  await page.getByPlaceholder("Search studies...").fill(studyTitle);

  const optionsButton = page.getByRole("button", { name: `Options for ${studyTitle}` });
  if (!(await optionsButton.isVisible({ timeout: 10000 }).catch(() => false))) {
    return;
  }

  await optionsButton.click();
  await page.getByRole("menuitem", { name: /delete study/i }).click();

  const deleteDialog = page.getByRole("dialog");
  await expect(deleteDialog).toContainText("Delete Study");
  await deleteDialog.getByRole("button", { name: "Delete Study" }).click();

  await expect(
    page.getByText(/No studies (match your filters|yet)/),
  ).toBeVisible({ timeout: 15000 });
}

test("researcher builds a study spanning samples from two orders and transitions it", async ({
  page,
}) => {
  const stamp = Date.now();
  const orderNameA = `Playwright Multi-Order A ${stamp}`;
  const orderNameB = `Playwright Multi-Order B ${stamp}`;
  const studyTitle = `Playwright Multi-Order Study ${stamp}`;

  let studyTitleToCleanup: string | null = null;

  try {
    // Order A with a single sample.
    await createAndSubmitOrder(page, orderNameA, [{ volume: "31", concentration: "12" }]);
    const sampleIdsA = await getOrderSampleIds(page);
    expect(sampleIdsA.length).toBe(1);

    // Order B with a single sample.
    await createAndSubmitOrder(page, orderNameB, [{ volume: "42", concentration: "23" }]);
    const sampleIdsB = await getOrderSampleIds(page);
    expect(sampleIdsB.length).toBe(1);

    const allSampleIds = [...sampleIdsA, ...sampleIdsB];
    expect(new Set(allSampleIds).size).toBe(2);

    // Build one study that selects the sample from BOTH orders.
    studyTitleToCleanup = studyTitle;
    const { studyPath } = await createStudyFromSampleIds(page, studyTitle, allSampleIds);

    // Open the study's Samples tab and assert both samples are present...
    await page.getByRole("link", { name: "Open Samples", exact: true }).click();
    await expect(page).toHaveURL(/\/studies\/.+\?tab=samples/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: "Samples (2)" })).toBeVisible();

    for (const sampleId of allSampleIds) {
      await expect(page.getByText(sampleId).first()).toBeVisible();
    }

    // ...and that BOTH source orders are referenced, proving the study truly
    // spans more than one order. The Samples tab renders each sample's source
    // order name next to the sample id.
    await expect(page.getByText(orderNameA, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(orderNameB, { exact: false }).first()).toBeVisible();

    // State transition: a draft study can be marked ready and returned to draft.
    await page.goto(studyPath);
    await expect(page.getByRole("button", { name: "Mark as Ready" })).toBeVisible();
    await page.getByRole("button", { name: "Mark as Ready" }).click();

    const markReadyDialog = page.getByRole("dialog");
    await expect(markReadyDialog).toContainText("Mark Study as Ready");
    await markReadyDialog.getByRole("button", { name: "Mark as Ready" }).click();

    await expect(page.getByText("Awaiting Facility Review")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to Draft" })).toBeVisible();

    await page.getByRole("button", { name: "Back to Draft" }).click();
    const backToDraftDialog = page.getByRole("dialog");
    await expect(backToDraftDialog).toContainText("Return to Draft");
    await backToDraftDialog.getByRole("button", { name: "Back to Draft" }).click();

    await expect(page.getByText("Awaiting Facility Review")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark as Ready" })).toBeVisible();
  } finally {
    // Delete the study (this unassigns its samples). The two submitted orders
    // cannot be deleted by a researcher and are intentionally left behind, as in
    // study-lifecycle.spec.ts / order-create.spec.ts.
    if (studyTitleToCleanup) {
      await deleteStudyFromList(page, studyTitleToCleanup).catch(() => {});
    }
  }
});
