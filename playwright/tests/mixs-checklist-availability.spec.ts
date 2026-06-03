import { expect, test } from "@playwright/test";
import { createAndSubmitOrder, getOrderSampleIds } from "./helpers";

// Admin context: an admin controls which checklists researchers can pick via the
// per-checklist availability toggle on the MIxS Checklists admin page. Disabling
// one must remove it from the new-study picker (both the picker's data source and
// the wizard UI). The original config is restored afterwards.
//
// ERC000050 (ENA binned metagenome) is in the baseline and is NOT selected or
// asserted by any other spec, so toggling it here cannot race them.
test.use({ storageState: "playwright/.auth/admin.json" });
test.setTimeout(120000);

const TARGET_ACCESSION = "ERC000050"; // ENA binned metagenome
const TARGET_NAME = /ENA binned metagenome/i;
const KEPT_NAME = /GSC MIxS soil/i; // stays available, used as the positive control

async function pickerSourceAccessions(page: import("@playwright/test").Page): Promise<string[]> {
  const res = await page.request.get("/api/mixs-checklists");
  expect(res.ok()).toBeTruthy();
  const data = (await res.json()) as { checklists?: Array<{ accession?: string }> };
  return (data.checklists ?? []).map((c) => c.accession ?? "");
}

test("an admin availability toggle removes a checklist from the new-study picker", async ({
  page,
}) => {
  // Capture the current config so we can restore it no matter what.
  const beforeRes = await page.request.get("/api/admin/mixs-checklists");
  expect(beforeRes.ok()).toBeTruthy();
  const originalConfig = (await beforeRes.json()).config;
  expect(Array.isArray(originalConfig?.checklists)).toBeTruthy();

  // Sanity: the target is currently offered by the picker source.
  expect(await pickerSourceAccessions(page)).toContain(TARGET_ACCESSION);

  try {
    // Drive the admin UI: turn the target's availability switch off and save.
    await page.goto("/admin/mixs-checklists");
    await expect(page.getByRole("heading", { name: "MIxS Checklists" })).toBeVisible({
      timeout: 20000,
    });
    const toggle = page.locator(`#avail-${TARGET_ACCESSION}`);
    await expect(toggle).toBeVisible({ timeout: 20000 });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.getByRole("button", { name: /Save Changes/i }).click();

    // The picker's data source no longer offers it, while a still-available
    // checklist remains.
    await expect
      .poll(async () => {
        const accs = await pickerSourceAccessions(page);
        return { hasTarget: accs.includes(TARGET_ACCESSION), hasSoil: accs.includes("ERC000022") };
      }, { timeout: 15000 })
      .toEqual({ hasTarget: false, hasSoil: true });

    // And the wizard UI reflects it: build an order, step to the picker, and
    // confirm the disabled checklist is gone while an available one is offered.
    await createAndSubmitOrder(page, `Playwright Availability Order ${Date.now()}`, [
      { volume: "30", concentration: "12" },
    ]);
    const sampleIds = await getOrderSampleIds(page);
    expect(sampleIds.length).toBe(1);

    await page.goto("/studies/new");
    await expect(page.getByRole("heading", { name: "New Study" })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(sampleIds[0]) }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Study Title *").fill(`Availability Check ${Date.now()}`);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Environment Type" })).toBeVisible();

    await expect(page.getByRole("button", { name: KEPT_NAME })).toBeVisible();
    await expect(page.getByRole("button", { name: TARGET_NAME })).toHaveCount(0);
  } finally {
    // Restore the original config regardless of outcome.
    await page.request
      .put("/api/admin/mixs-checklists", {
        headers: { "Content-Type": "application/json" },
        data: { config: originalConfig },
      })
      .catch(() => undefined);
  }
});
