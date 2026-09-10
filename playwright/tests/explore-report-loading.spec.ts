import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

type ExistingReport = { id: string; targetKey: string; updatedAt: string; blocks: unknown[]; outputs: { tables: Array<{ datasetId: string; name: string; output: boolean; rowCount: number }> } };

async function reportFixture(request: APIRequestContext): Promise<ExistingReport | null> {
  const id = process.env.EXPLORE_LAYOUT_REPORT_ID;
  test.skip(!id, "read-only check requires EXPLORE_LAYOUT_REPORT_ID for an existing editable report");
  if (!id) return null;
  const response = await request.get(`/api/explore/reports/${encodeURIComponent(id)}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).report;
}

/** Delay actual local GETs; never fabricate data, run analyses or save a report. */
async function delayedRequests(page: Page) {
  const holds: Array<{ matches: (url: URL) => boolean; wait: Promise<void>; release: () => void }> = [];
  const writes: string[] = [];
  await page.route("**/api/explore/**", async route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      writes.push(route.request().url());
      await route.abort();
      return;
    }
    const url = new URL(route.request().url());
    await Promise.all(holds.filter(hold => hold.matches(url)).map(hold => hold.wait));
    await route.continue();
  });
  return {
    writes,
    hold(matches: (url: URL) => boolean) {
      let release!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      holds.push({ matches, wait, release });
      return release;
    },
    releaseAll() { holds.forEach(hold => hold.release()); },
  };
}

async function unchanged(request: APIRequestContext, report: ExistingReport, writes: string[]) {
  expect(writes).toEqual([]);
  const { report: after } = await (await request.get(`/api/explore/reports/${report.id}`)).json();
  expect(after.updatedAt).toBe(report.updatedAt);
  expect(after.blocks).toEqual(report.blocks);
}

async function fitsHorizontally(locator: Locator) {
  await expect.poll(() => locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
  })).toBe(true);
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem("sidebar-collapsed", "false");
    localStorage.setItem("sidebar-width-v2", "360");
    localStorage.setItem("seqdesk:explore:page-panel", "shown");
  });
});

test("report placeholders fit desktop and mobile and respect reduced motion", async ({ page, request }, info) => {
  const report = await reportFixture(request);
  if (!report) return;
  const network = await delayedRequests(page);
  const release = network.hold(url => url.pathname === `/api/explore/reports/${report.id}`);
  try {
    await page.goto(`/explore/reports/${report.id}?scope=${encodeURIComponent(report.targetKey)}&mode=edit&view=page`);
    const skeleton = page.getByRole("status", { name: "Loading report…", exact: true });
    await expect(skeleton).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
    await expect(skeleton.locator("button, a, input, select")).toHaveCount(0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await fitsHorizontally(skeleton);
      if (width === 1440) await expect(skeleton.locator("[data-report-loading-sidebar]")).toBeVisible();
      else await expect(skeleton.locator("[data-report-loading-sidebar]")).toBeHidden();
      if (width !== 320) await page.screenshot({ path: info.outputPath(`report-loading-${width}.png`), animations: "disabled" });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => skeleton.locator('[data-slot="skeleton"]').evaluateAll(elements => elements.every(element => getComputedStyle(element).animationName === "none"))).toBe(true);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => skeleton.locator('[data-slot="skeleton"]').first().evaluate(element => getComputedStyle(element).animationName)).not.toBe("none");
    await page.setViewportSize({ width: 1440, height: 900 });
    release();
    await expect(skeleton).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(1);
    await unchanged(request, report, network.writes);
  } finally { network.releaseAll(); }
});

test("list waits for tables and analysis steps independently without false empty messages", async ({ page, request }, info) => {
  const report = await reportFixture(request);
  if (!report) return;
  const network = await delayedRequests(page);
  const tablesReady = network.hold(url => url.pathname === "/api/explore/datasets");
  const analysesReady = network.hold(url => url.pathname === "/api/explore/analyses");
  try {
    await page.goto(`/explore/reports/${report.id}?scope=${encodeURIComponent(report.targetKey)}&mode=edit&view=list`);
    const tables = page.getByRole("status", { name: "Loading tables…", exact: true });
    const analyses = page.getByRole("status", { name: "Loading analysis steps…", exact: true });
    await expect(tables).toBeVisible({ timeout: 30_000 });
    await expect(analyses).toBeVisible();
    await expect(page.getByText(/No analysis steps yet/)).toHaveCount(0);
    await expect(page.getByText(/No tables yet/)).toHaveCount(0);
    await fitsHorizontally(tables);
    await page.screenshot({ path: info.outputPath("list-loading.png"), animations: "disabled" });
    tablesReady();
    await expect(tables).toBeHidden({ timeout: 30_000 });
    await expect(analyses).toBeVisible();
    analysesReady();
    await expect(analyses).toBeHidden({ timeout: 30_000 });
    await unchanged(request, report, network.writes);
  } finally { network.releaseAll(); }
});

test("analysis canvas reserves its viewport while the graph loads", async ({ page, request }, info) => {
  const report = await reportFixture(request);
  if (!report) return;
  const network = await delayedRequests(page);
  const release = network.hold(url => url.pathname === "/api/explore/canvas");
  try {
    await page.goto(`/explore/reports/${report.id}?scope=${encodeURIComponent(report.targetKey)}&mode=edit&view=canvas`);
    const skeleton = page.getByRole("status", { name: "Loading analysis canvas…", exact: true });
    await expect(skeleton).toBeVisible({ timeout: 30_000 });
    await fitsHorizontally(skeleton);
    const loadingBounds = await skeleton.boundingBox();
    await page.screenshot({ path: info.outputPath("canvas-loading.png"), animations: "disabled" });
    release();
    await expect(skeleton).toBeHidden({ timeout: 30_000 });
    const canvas = page.locator(".react-flow");
    await expect(canvas).toBeVisible();
    const loadedBounds = await canvas.boundingBox();
    expect(Math.abs(loadingBounds!.height - loadedBounds!.height)).toBeLessThanOrEqual(4);
    await unchanged(request, report, network.writes);
  } finally { network.releaseAll(); }
});

test("data picker and saved table preview show shapes until real output data arrives", async ({ page, request }, info) => {
  const report = await reportFixture(request);
  if (!report) return;
  const table = report.outputs.tables.find(entry => entry.output && entry.rowCount > 0);
  test.skip(!table, "requires an existing saved analysis table; never creates one");
  if (!table) return;
  const network = await delayedRequests(page);
  const sourcesReady = network.hold(url => url.pathname === "/api/explore/datasets/sources");
  const previewReady = network.hold(url => url.pathname === `/api/explore/datasets/${table.datasetId}/table` && url.searchParams.get("limit") === "10");
  try {
    await page.goto(`/explore/reports/${report.id}?scope=${encodeURIComponent(report.targetKey)}&mode=edit&view=page`);
    await page.getByRole("complementary", { name: "Add to the page" }).getByRole("button", { name: "Browse data", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Add to page", exact: true });
    await picker.getByRole("button", { name: "Pipeline outputs", exact: true }).click();
    const sources = picker.getByRole("status", { name: "Loading pipeline outputs…", exact: true });
    await expect(sources).toBeVisible();
    await fitsHorizontally(sources);
    await page.screenshot({ path: info.outputPath("picker-loading.png"), animations: "disabled" });
    sourcesReady();
    await expect(sources).toBeHidden({ timeout: 30_000 });
    await picker.getByRole("button", { name: "Saved analysis results", exact: true }).click();
    await picker.getByRole("article").filter({ has: page.getByRole("heading", { name: table.name, exact: true }) }).getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: table.name, exact: true });
    const rows = preview.getByRole("status", { name: "Loading preview…", exact: true });
    await expect(rows).toBeVisible();
    await fitsHorizontally(rows);
    await page.screenshot({ path: info.outputPath("preview-loading.png"), animations: "disabled" });
    previewReady();
    await expect(rows).toBeHidden({ timeout: 30_000 });
    await expect(preview.getByRole("table")).toBeVisible();
    await unchanged(request, report, network.writes);
  } finally { network.releaseAll(); }
});
