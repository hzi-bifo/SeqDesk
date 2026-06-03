import { expect, test, type Page } from "@playwright/test";
import {
  createAndSubmitOrder,
  createStudyFromOrderSamples,
} from "./helpers";

// Admin context. The study MIxS metadata page is a draft editor: it renders the
// study's resolved checklist fields (required ones marked with *) and persists
// edits without blocking on required fields — required-field enforcement lives at
// the new-study wizard (form-config-roundtrip) and ENA submission (ena-submission-ui),
// tested separately. This spec covers what the metadata page itself does: the MIxS
// form renders from the registry-resolved checklist and round-trips on save.
//
// Runs as FACILITY_ADMIN because the studies PUT route persists study-level
// studyMetadata verbatim for admins, whereas for researchers it filters it to the
// configured study FORM fields (so MIxS checklist study-level keys would not
// round-trip). Sample-level checklistData persists for either role.
test.use({ storageState: "playwright/.auth/admin.json" });
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

test("a study's MIxS metadata form renders the checklist fields and round-trips on save", async ({
  page,
}) => {
  const stamp = Date.now();
  const orderName = `Playwright MIxS Meta Order ${stamp}`;
  const studyTitle = `Playwright MIxS Meta Study ${stamp}`;
  const value = `RoundTrip-${stamp}`;
  let createdTitle: string | null = null;

  try {
    await createAndSubmitOrder(page, orderName, [{ volume: "30", concentration: "12" }]);
    // createStudyFromOrderSamples selects the "Human Associated" checklist
    // (GSC MIxS human associated, ERC000014) and returns the new study's path.
    createdTitle = studyTitle;
    const { studyPath } = await createStudyFromOrderSamples(page, studyTitle);

    await page.goto(`${studyPath}/metadata`);

    // The MIxS form is rendered from the registry-resolved checklist.
    await expect(
      page.getByText(/GSC MIxS human associated/i),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole("heading", { name: /Study-Level Fields/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/Required fields are marked with an asterisk/i),
    ).toBeVisible();

    // Round-trip: enter a value in the first MIxS field, save, reload, confirm it
    // persisted (study-level fields are expanded by default). Scope to the
    // Study-Level Fields card so we don't grab the sidebar's "Search studies..."
    // input, which is the first textbox on the page.
    const studyCard = page
      .locator("div", { has: page.getByRole("heading", { name: /Study-Level Fields/i }) })
      .last();
    const firstField = studyCard.getByRole("textbox").first();
    await expect(firstField).toBeVisible();
    await firstField.fill(value);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(
      page.getByText("Metadata saved successfully"),
    ).toBeVisible({ timeout: 15000 });

    await page.reload();
    await expect(firstField).toHaveValue(value, { timeout: 20000 });
  } finally {
    if (createdTitle) await deleteStudyFromList(page, createdTitle).catch(() => {});
  }
});
