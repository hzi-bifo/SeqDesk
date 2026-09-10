import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ actionTimeout: 10_000 });

/** Uses existing data only. No notifications are read/archived and no workers are changed. */
async function openPage(page: Page) {
  const reportId = process.env.EXPLORE_LAYOUT_REPORT_ID;
  const before = reportId
    ? await (await page.request.get(`/api/explore/reports/${encodeURIComponent(reportId)}`)).json()
    : null;
  if (reportId) expect(before?.report?.id).toBe(reportId);
  const writes: string[] = [];
  await page.route("**/api/**", route => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
      && /\/api\/(explore|notifications|admin)(\/|\?)/.test(request.url())) {
      writes.push(`${request.method()} ${request.url()}`);
      return route.abort(); // Protect the existing report, notifications and running workers.
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("sidebar-collapsed", "false");
    localStorage.setItem("sidebar-width-v2", "360");
    localStorage.setItem("seqdesk:explore:page-panel", "shown");
  });
  await page.goto(reportId
    ? `/explore/reports/${encodeURIComponent(reportId)}?scope=${encodeURIComponent(before.report.targetKey)}&mode=edit&view=page`
    : "/orders");
  await expect(page.getByRole("contentinfo")).toBeVisible({ timeout: 30_000 });
  if (reportId) {
    // The footer mounts before the report: do not accidentally test over a loading skeleton.
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible({ timeout: 30_000 });
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(page.getByRole("complementary", { name: "Add to the page", exact: true })).toBeVisible();
    }
  }
  return async () => {
    expect(writes).toEqual([]);
    if (reportId) {
      const after = await (await page.request.get(`/api/explore/reports/${encodeURIComponent(reportId)}`)).json();
      expect(after.report.updatedAt).toBe(before.report.updatedAt);
      expect(after.report.blocks).toEqual(before.report.blocks);
    }
  };
}

async function expectPanelFits(panel: Locator) {
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const body = element.querySelector('[role="region"]')!;
    const insideWindow = rect.left >= 7 && rect.right <= innerWidth - 7
      && rect.top >= 7 && rect.bottom <= innerHeight - 7;
    const noHorizontalOverflow = element.scrollWidth <= element.clientWidth + 1
      && body.scrollWidth <= body.clientWidth + 1;
    // Visibility alone passes even if a sidebar covers the panel. Hit-test across it.
    const inFront = [0.2, 0.5, 0.8].every(x => [0.2, 0.5, 0.8].every(y =>
      element.contains(document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y))));
    return insideWindow && noHorizontalOverflow && inFront && !element.closest("footer");
  }), { message: "footer overlay must fit the viewport, wrap its content and sit above sidebars" }).toBe(true);
  const close = panel.getByRole("button", { name: /^Close / });
  await expect(close).toBeInViewport();
  await close.click({ trial: true });
}

const sizes = [
  { width: 1440, height: 900 }, { width: 1280, height: 720 },
  { width: 1024, height: 600 }, { width: 900, height: 600 },
  { width: 768, height: 600 }, { width: 640, height: 480 },
  { width: 390, height: 650 }, { width: 320, height: 480 },
  { width: 667, height: 300 }, { width: 320, height: 240 },
];

test("footer notifications fit above report sidebars and remain usable in narrow or short windows", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const notifications = await page.request.get("/api/notifications?limit=20&archived=false");
  expect(notifications.ok()).toBe(true);
  test.skip((await notifications.json()).enabled === false, "in-app notifications are disabled");
  const verifyUnchanged = await openPage(page);
  const trigger = page.getByRole("contentinfo").getByRole("button", { name: /^Notifications/ });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
  await trigger.click();
  for (const size of sizes) {
    await test.step(`${size.width} × ${size.height}`, async () => {
      await page.setViewportSize(size);
      await expectPanelFits(panel);
      const body = panel.getByRole("region", { name: "Notifications content" });
      // Expand actual saved notification text; this must not mark it read.
      const collapsed = body.locator('button[aria-expanded="false"]').first();
      if (await collapsed.count()) await collapsed.click();
      await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expectPanelFits(panel); // Header/Close stay in place when the list scrolls.
      if (size.width === 1440 || size.width === 390) await page.screenshot({ path: testInfo.outputPath(`notifications-${size.width}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click(); // Also catches an off-screen footer trigger after resizing.
    });
  }
  await page.getByRole("contentinfo").click({ position: { x: 2, y: 2 } });
  await expect(panel).toBeHidden();
  await verifyUnchanged();
});

test("footer Details wraps worker controls, scrolls logs and switches cleanly to Notifications", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const [workerResponse, activityResponse] = await Promise.all([
    page.request.get("/api/admin/workers"), page.request.get("/api/admin/activity"),
  ]);
  expect(workerResponse.ok()).toBe(true);
  expect(activityResponse.ok()).toBe(true);
  const status = await workerResponse.json() as {
    workers?: Array<{ latest?: { status: string } | null }>;
    workersError?: string | null;
    pipelineLoadError?: string | null;
  };
  const activity = await activityResponse.json() as { jobs?: Array<{ state: string }> };
  const hasDetails = status.workersError || status.pipelineLoadError
    || status.workers?.some(worker => ["RUNNING", "STOPPING", "PAUSED", "ERROR", "ZOMBIE"].includes(worker.latest?.status ?? ""))
    || activity.jobs?.some(job => job.state === "running" || job.state === "error");
  test.skip(!hasDetails, "requires existing worker or activity status; this test never starts a job");
  const verifyUnchanged = await openPage(page);
  const trigger = page.getByRole("contentinfo").getByRole("button", { name: "details", exact: true });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  const panel = page.getByRole("dialog", { name: "Admin status", exact: true });
  await trigger.click();
  for (const size of sizes) {
    await test.step(`${size.width} × ${size.height}`, async () => {
      await page.setViewportSize(size);
      await expectPanelFits(panel);
      const body = panel.getByRole("region", { name: "Admin status content" });
      const showLog = body.getByRole("button", { name: /^Show log for/ }).first();
      if (size.width === 390 && await showLog.count()) {
        await showLog.click(); // GET log tail only, never starts or stops a worker.
        await expect(body.locator("pre").first()).toBeVisible();
      }
      await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expectPanelFits(panel);
      if (size.width === 1440 || size.width === 390) await page.screenshot({ path: testInfo.outputPath(`details-${size.width}.png`), animations: "disabled" });
      await panel.getByRole("button", { name: "Close admin status", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
    });
  }
  const notificationsTrigger = page.getByRole("contentinfo").getByRole("button", { name: /^Notifications/ });
  if (await notificationsTrigger.count()) {
    await notificationsTrigger.click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Notifications", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await trigger.click();
    await expect(panel).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await verifyUnchanged();
});
