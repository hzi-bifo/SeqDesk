import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.SETTINGS_UI_READ_ONLY !== "1", "Opt-in read-only check against an existing configured installation; no seeding or settings saves.");

async function preventWrites(page: Page) {
  const writes: string[] = [];
  await page.route("**/api/**", route => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.push(request.method() + " " + new URL(request.url()).pathname);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  return writes;
}

async function expectNoPageOverflow(page: Page) {
  // A dev-server refresh can replace the execution context while an uncached
  // settings route compiles. Reacquire the document instead of retaining it.
  await expect(async () => {
    expect(await page.locator("html").evaluate(element => element.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (page.viewportSize()!.width < 768) {
      expect(await page.locator("main").evaluate(element => Math.round(element.getBoundingClientRect().left))).toBe(0);
    } else {
      const sidebarRight = await page.locator("aside").first().evaluate(element => Math.round(element.getBoundingClientRect().right));
      expect(await page.locator("main").evaluate(element => Math.round(element.getBoundingClientRect().left))).toBe(sidebarRight);
    }
  }).toPass({ timeout: 10_000 });
}

test("settings overview and search remain usable on desktop and narrow screens", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const writes = await preventWrites(page);
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Application settings", exact: true })).toBeVisible({ timeout: 60_000 });
  const setup = page.getByRole("region", { name: "Setup status" });
  await expect(setup.getByText(/of .* modules enabled|Optional modules are paused/)).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByText(/of .* items complete/)).toBeVisible({ timeout: 30_000 });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 720 }, { width: 768, height: 700 }, { width: 390, height: 760 }]) {
    await page.setViewportSize(viewport);
    const search = page.getByRole("textbox", { name: "Find a setting" });
    await search.fill("sandbox");
    await expect(page.getByRole("link", { name: /Report analysis settings Analysis environments/ })).toBeVisible();
    await expectNoPageOverflow(page);
    await search.fill("no-such-settings");
    await expect(page.getByText("No matching settings", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear settings search" }).click();
    await expect(page.getByRole("heading", { name: "Metadata & forms", exact: true })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("settings-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("settings-desktop.png"), fullPage: true });
  expect(writes).toEqual([]);
});

test("module catalog groups data sources and filters without changing any module", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const before = await (await request.get("/api/modules")).json();
  const writes = await preventWrites(page);
  await page.goto("/admin/modules?category=data-sources");
  await expect(page.getByRole("heading", { name: "Modules", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Facility sequencing", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /CAMI/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /SRA/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 760 });
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("modules-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("modules-desktop.png"), fullPage: true });
  const after = await (await request.get("/api/modules")).json();
  expect(after).toEqual(before);
  expect(writes).toEqual([]);
});

for (const destination of [
    { url: "/admin/onboarding", heading: "Setup checklist" },
    { url: "/admin/data-storage", heading: "Data storage" },
    { url: "/admin/pipeline-runtime", heading: "Where pipelines run" },
    { url: "/admin/settings/analysis", heading: "Report analysis settings" },
    { url: "/admin/settings/system", heading: "System & maintenance" },
    { url: "/admin/settings/general", heading: "Installation details" },
  ]) {
  test(destination.heading + " opens without starting checks or downloads", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const writes = await preventWrites(page);
    await page.goto(destination.url, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: destination.heading, exact: true, level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("navigation", { name: "Application settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings overview", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings overview", exact: true })).toHaveAttribute("href", "/admin/settings");
    if (destination.url === "/admin/settings/general") {
      await expect(page.getByLabel("Installation name", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Save installation details" })).toBeDisabled();
      await page.setViewportSize({ width: 390, height: 760 });
      await expectNoPageOverflow(page);
    }
    await page.screenshot({ path: testInfo.outputPath("settings-page.png"), fullPage: true });
    expect(writes).toEqual([]);
  });
}
