import { expect, test, type Page } from "@playwright/test";
import {
  createAndSubmitOrder,
  createStudyFromOrderSamples,
} from "./helpers";

// Researcher context. The study MIxS metadata page builds its form from the
// study's checklist, resolved from the registry by accession. This spec verifies
// that render path: the resolved checklist's name appears and its fields are
// rendered (required ones marked with *).
//
// It deliberately does NOT assert a save round-trip: study-level studyMetadata
// only persists verbatim for FACILITY_ADMIN (the researcher PUT path filters it
// to configured study FORM fields), so a researcher round-trip would not persist
// MIxS checklist keys. Required-field enforcement is covered at the new-study
// wizard (form-config-roundtrip) and at ENA submission (ena-submission-ui).
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

test("a study's MIxS metadata page renders the resolved checklist's fields", async ({
  page,
}) => {
  const stamp = Date.now();
  const orderName = `Playwright MIxS Meta Order ${stamp}`;
  const studyTitle = `Playwright MIxS Meta Study ${stamp}`;
  let createdTitle: string | null = null;

  try {
    await createAndSubmitOrder(page, orderName, [{ volume: "30", concentration: "12" }]);
    // Selects the "Human Associated" checklist (GSC MIxS human associated, ERC000014).
    createdTitle = studyTitle;
    const { studyPath } = await createStudyFromOrderSamples(page, studyTitle);

    await page.goto(`${studyPath}/metadata`);

    // The form is built from the registry-resolved checklist: the header shows the
    // resolved checklist name (proves the accession -> checklist fetch works), and
    // the study-level section renders with the required-field legend.
    await expect(
      page.getByText(/GSC MIxS human associated/i),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole("heading", { name: /Study-Level Fields/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/Required fields are marked with an asterisk/i),
    ).toBeVisible();

    // The checklist's fields render as editable inputs. Scope to the Study-Level
    // Fields card so we don't match the sidebar's "Search studies..." input.
    const studyCard = page
      .locator("div", { has: page.getByRole("heading", { name: /Study-Level Fields/i }) })
      .last();
    await expect(studyCard.getByRole("textbox").first()).toBeVisible({ timeout: 20000 });
  } finally {
    if (createdTitle) await deleteStudyFromList(page, createdTitle).catch(() => {});
  }
});
