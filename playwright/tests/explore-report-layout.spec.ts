import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/** Read-only layout coverage: reuse an authorized report, never create or edit one. */
async function existingReport(request: APIRequestContext): Promise<{ id: string; targetKey: string; updatedAt: string } | null> {
  const scopesResponse = await request.get("/api/explore/scopes");
  expect(scopesResponse.ok()).toBeTruthy();
  const { scopes } = await scopesResponse.json() as { scopes: Array<{ targetKey: string; access: string }> };
  const writable = scopes.filter(scope => scope.access === "write");
  const explicitId = process.env.EXPLORE_LAYOUT_REPORT_ID;
  if (explicitId) {
    const response = await request.get(`/api/explore/reports/${encodeURIComponent(explicitId)}`);
    expect(response.ok()).toBeTruthy();
    const { report } = await response.json();
    expect(writable.some(scope => scope.targetKey === report.targetKey), "the layout report must be editable").toBe(true);
    return report;
  }
  for (const scope of writable) {
    const response = await request.get(`/api/explore/reports?targetKey=${encodeURIComponent(scope.targetKey)}`);
    expect(response.ok()).toBeTruthy();
    const { reports } = await response.json() as { reports: Array<{ id: string }> };
    if (reports.length) {
      const detail = await request.get(`/api/explore/reports/${encodeURIComponent(reports[0].id)}`);
      expect(detail.ok()).toBeTruthy();
      return (await detail.json()).report;
    }
  }
  return null;
}

async function expectToolbarFits(page: Page) {
  const toolbar = page.getByRole("group", { name: "Report toolbar", exact: true });
  const actions = page.getByRole("group", { name: "Report actions", exact: true });
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(1);
  await expect(actions.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  // Visibility alone allows clipped/covered controls. Check their full bounds too.
  await expect.poll(() => toolbar.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const panel = document.querySelector('aside[aria-label="Add to the page"]');
    const right = panel && getComputedStyle(panel).display !== "none" ? panel.getBoundingClientRect().left : window.innerWidth;
    return [...element.querySelectorAll("button")].every(button => {
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) return true;
      return rect.left >= Math.max(0, bounds.left) - 1 && rect.right <= Math.min(right, bounds.right) + 1
        && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    });
  }), { message: "document toolbar must not overlap the full-height sidebar" }).toBe(true);
  await expect.poll(() => actions.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll("button")].every(button => {
      const rect = button.getBoundingClientRect();
      return rect.left >= Math.max(0, bounds.left) - 1 && rect.right <= Math.min(window.innerWidth, bounds.right) + 1
        && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
    });
  }), { message: "the single set of report actions must remain fully visible" }).toBe(true);
  // Trial checks hit-testing without leaving the editor or saving a report.
  await actions.getByRole("button", { name: "Done", exact: true }).click({ trial: true });
}

test("Undo and Done stay in the main header beside a full-height sidebar without duplicate controls", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const report = await existingReport(request);
  test.skip(!report, "requires an existing report in a writable scope; EXPLORE_LAYOUT_REPORT_ID can select one");
  if (!report) return;
  await page.addInitScript(() => {
    localStorage.setItem("sidebar-collapsed", "false");
    localStorage.setItem("sidebar-width-v2", "360");
    localStorage.setItem("seqdesk:explore:page-panel", "shown");
  });
  const writes: string[] = [];
  page.on("request", req => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method()) && req.url().includes("/api/explore/")) writes.push(req.url());
  });
  await page.goto(`/explore/reports/${report.id}?scope=${encodeURIComponent(report.targetKey)}&mode=edit&view=page`);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible({ timeout: 30_000 });
  for (const width of [1600, 1440, 1280, 1200, 1100, 1024, 900, 768, 640, 390, 320]) {
    await test.step(`${width}px viewport with expanded navigation`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await expectToolbarFits(page);
      if (width >= 1024) {
        const toolbar = page.getByRole("group", { name: "Report toolbar", exact: true });
        await expect(page.getByRole("button", { name: "Hide the panel", exact: true })).toHaveCount(1);
        await expect(toolbar.getByRole("button", { name: "Hide the panel", exact: true })).toHaveCount(0);
        const sidebar = page.getByRole("complementary", { name: "Add to the page" });
        await expect(sidebar.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
        await expect(sidebar.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
        await expect.poll(() => sidebar.evaluate(element => Math.abs(element.getBoundingClientRect().top - element.parentElement!.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
        // Undo and Done belong in the same top row as the view switch, not below it.
        await expect.poll(async () => {
          const view = await toolbar.getByRole("group", { name: "View", exact: true }).boundingBox();
          const done = await toolbar.getByRole("button", { name: "Done", exact: true }).boundingBox();
          const undo = await toolbar.getByRole("button", { name: "Undo", exact: true }).boundingBox();
          return Boolean(view && done && undo && Math.abs(view.y - done.y) <= 2 && Math.abs(view.y - undo.y) <= 2);
        }).toBe(true);
      }
      if (width === 1200 || width === 390) await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`), animations: "disabled" });
    });
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  const toolbar = page.getByRole("group", { name: "Report toolbar", exact: true });
  await page.getByRole("complementary", { name: "Add to the page" }).getByRole("button", { name: "Hide the panel", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Add to the page" })).toBeHidden();
  await expectToolbarFits(page);
  await toolbar.getByRole("button", { name: "Show the panel", exact: true }).click();
  await expectToolbarFits(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await toolbar.getByRole("button", { name: "Open the panel", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add to the page", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Browse data", exact: true })).toBeVisible();
  // Resizing an open mobile drawer must not leave its contents in a hidden portal.
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("complementary", { name: "Add to the page" }).getByRole("button", { name: "Browse data", exact: true })).toBeVisible();
  await expectToolbarFits(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer).toBeHidden();
  await toolbar.getByRole("button", { name: "Open the panel", exact: true }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Close the panel", exact: true }).last().click();
  await expectToolbarFits(page);
  expect(writes).toEqual([]);
  const after = await request.get(`/api/explore/reports/${report.id}`);
  expect((await after.json()).report.updatedAt).toBe(report.updatedAt);
});

test("the white report sidebar reaches the footer even at the end of document and panel scrolling", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const report = await existingReport(request);
  test.skip(!report, "requires an existing report; never creates or edits one");
  if (!report) return;
  const before = (await (await request.get(`/api/explore/reports/${report.id}`)).json()).report;
  const writes: string[] = [];
  await page.route("**/api/explore/**", route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      writes.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("sidebar-collapsed", "false");
    localStorage.setItem("sidebar-width-v2", "360");
    localStorage.setItem("seqdesk:explore:page-panel", "shown");
  });
  await page.goto(`/explore/reports/${report.id}?scope=${encodeURIComponent(report.targetKey)}&mode=edit&view=page`);
  const sidebar = page.getByRole("complementary", { name: "Add to the page", exact: true });
  await expect(sidebar.getByRole("button", { name: "Browse data", exact: true })).toBeVisible({ timeout: 30_000 });
  for (const size of [{ width: 1440, height: 900 }, { width: 1200, height: 720 }, { width: 1024, height: 480 }]) {
    await page.setViewportSize(size);
    for (const position of ["top", "middle", "bottom"] as const) {
      await test.step(`${size.width} × ${size.height}, document ${position}`, async () => {
        await page.evaluate(position => window.scrollTo(0, position === "top" ? 0 : position === "middle" ? (document.documentElement.scrollHeight - innerHeight) / 2 : document.documentElement.scrollHeight), position);
        await expect.poll(() => sidebar.evaluate(element => {
          const panel = element.getBoundingClientRect();
          const footer = document.querySelector("footer")!.getBoundingClientRect();
          return Math.abs(panel.top) <= 1 && Math.abs(panel.bottom - footer.top) <= 1
            && element.contains(document.elementFromPoint(panel.left + 8, footer.top - 2));
        }), { message: "no background gap or overlap between sidebar and footer" }).toBe(true);
        const body = sidebar.locator("[class*='overflow-y-auto']");
        await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await expect(sidebar.getByRole("button", { name: "Hide the panel", exact: true })).toBeInViewport();
        await sidebar.getByRole("button", { name: "Hide the panel", exact: true }).click({ trial: true });
        if (position === "bottom") await page.screenshot({ path: testInfo.outputPath(`sidebar-footer-${size.width}.png`), animations: "disabled" });
      });
    }
  }
  expect(writes).toEqual([]);
  const after = (await (await request.get(`/api/explore/reports/${report.id}`)).json()).report;
  expect(after.updatedAt).toBe(before.updatedAt);
  expect(after.blocks).toEqual(before.blocks);
});

test("mobile report panel contains keyboard focus and scrolling and leaves data pickers usable on resize", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const report = await existingReport(request);
  test.skip(!report, "requires an existing editable report; no report writes");
  if (!report) return;
  const before = (await (await request.get(`/api/explore/reports/${report.id}`)).json()).report;
  const writes: string[] = [];
  await page.route("**/api/explore/**", route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      writes.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(() => localStorage.setItem("seqdesk:explore:page-panel", "shown"));
  await page.setViewportSize({ width: 390, height: 650 });
  await page.goto(`/explore/reports/${report.id}?scope=${encodeURIComponent(report.targetKey)}&mode=edit&view=page`);
  const trigger = page.getByRole("button", { name: "Open the panel", exact: true });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Add to the page", exact: true });
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(drawer.getByRole("button", { name: "Close the panel", exact: true })).toBeFocused();
  for (let count = 0; count < 8; count++) {
    await page.keyboard.press(count % 2 ? "Tab" : "Shift+Tab");
    await expect.poll(() => drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  const scroller = drawer.locator("[class*='overflow-y-auto']");
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => scroller.evaluate(element => getComputedStyle(element).overscrollBehaviorY)).toBe("contain");
  const scrollBefore = await page.evaluate(() => scrollY);
  await scroller.hover();
  await page.mouse.wheel(0, 900);
  await page.screenshot({ path: testInfo.outputPath("mobile-panel-scroll.png"), animations: "disabled" });
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");

  await trigger.click();
  await drawer.getByRole("button", { name: "Browse data", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Add to page", exact: true });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  await drawer.getByRole("button", { name: "Browse data", exact: true }).click();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Your files", exact: true }).click();
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 650 });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: "Your files", exact: true })).toHaveAttribute("aria-pressed", "true");
    await picker.getByRole("button", { name: "Choose a file", exact: true }).click({ trial: true });
    await expect.poll(() => picker.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.mouse.click(4, 200); // Backdrop, outside the right-hand panel.
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(writes).toEqual([]);
  const after = (await (await request.get(`/api/explore/reports/${report.id}`)).json()).report;
  expect(after.updatedAt).toBe(before.updatedAt);
  expect(after.blocks).toEqual(before.blocks);
});

test("chart suggestions preview saved data and fit desktop and mobile without editing the report", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const report = await existingReport(request);
  test.skip(!report, "requires an existing report in a writable scope");
  if (!report) return;
  const before = await (await request.get(`/api/explore/reports/${report.id}`)).json();
  const tables = before.report.outputs.tables as Array<{ datasetId: string; name: string; output: boolean; rowCount: number; columns: Array<{ type: string }> }>;
  const table = tables.find(entry => entry.output && entry.rowCount >= 2 && entry.columns.some(column => column.type === "number"));
  test.skip(!table, "requires a saved analysis table with measured rows; does not create test data");
  if (!table) return;
  const writes: string[] = [];
  await page.route("**/api/explore/**", route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      writes.push(route.request().url());
      return route.abort(); // Keep this browser regression read-only, even if the UI regresses.
    }
    return route.continue();
  });
  await page.addInitScript(() => localStorage.setItem("seqdesk:explore:page-panel", "shown"));
  await page.goto(`/explore/reports/${report.id}?scope=${encodeURIComponent(report.targetKey)}&mode=edit&view=page`);
  const panel = page.getByRole("complementary", { name: "Add to the page" });
  await panel.getByRole("button", { name: "Browse data", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Add to page", exact: true });
  await picker.getByRole("button", { name: "Saved analysis results", exact: true }).click();
  await picker.getByRole("article").filter({ has: page.getByRole("heading", { name: table.name, exact: true }) }).getByRole("button", { name: "Create chart", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create chart from a table", exact: true });
  // The saved dataset is fetched before the dialog opens; allow cold dev-route compilation.
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("combobox", { name: "Source table" })).toHaveValue(table.datasetId);
  const suggestions = dialog.getByRole("region", { name: "Suggested chart views" }).getByRole("button");
  await expect(suggestions.first()).toBeVisible();
  expect(await suggestions.count()).toBeLessThanOrEqual(3);
  await expect(dialog.getByRole("combobox", { name: "Chart type" })).toHaveCount(0);
  const preview = dialog.getByRole("region", { name: "Chart preview" });
  await expect(preview.locator(".js-plotly-plot")).toBeVisible();
  for (const suggestion of await suggestions.all()) {
    await suggestion.click();
    await expect(suggestion).toHaveAttribute("aria-pressed", "true");
    await expect(preview.locator(".js-plotly-plot")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add chart to page", exact: true })).toBeEnabled();
  }
  await suggestions.first().click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.top >= 0
        && rect.bottom <= window.innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    for (const name of ["Cancel", "Add chart to page"]) {
      const button = dialog.getByRole("button", { name, exact: true });
      await expect(button).toBeInViewport();
      await button.click({ trial: true });
    }
    if (width !== 320) await page.screenshot({ path: testInfo.outputPath(`chart-suggestions-${width}.png`), animations: "disabled" });
  }
  await dialog.getByRole("textbox", { name: "Chart title" }).fill("Unsaved chart preview");
  await dialog.getByRole("button", { name: "Customize chart" }).click();
  await expect(dialog.getByRole("combobox", { name: "Chart type" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);
  const after = await (await request.get(`/api/explore/reports/${report.id}`)).json();
  expect(after.report.updatedAt).toBe(before.report.updatedAt);
  expect(after.report.blocks).toEqual(before.report.blocks);
});
