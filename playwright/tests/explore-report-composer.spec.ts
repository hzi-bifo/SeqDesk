import { expect, test } from "@playwright/test";

/** Opt-in local test: only its newly created scratch report is changed, then deleted. */
test("reorders, inserts and undoes report blocks through the normal save path", async ({ page, request, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const referenceId = process.env.EXPLORE_LAYOUT_REPORT_ID;
  test.skip(process.env.EXPLORE_LAYOUT_WRITE_TEST !== "1" || !referenceId || !baseURL || !["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname), "opt in on a local instance with an existing report scope");
  const referenceResponse = await request.get(`/api/explore/reports/${encodeURIComponent(referenceId!)}`);
  expect(referenceResponse.ok()).toBe(true);
  const reference = (await referenceResponse.json()).report;
  const title = `Temporary editor layout QA ${crypto.randomUUID()}`;
  const create = await request.post("/api/explore/reports", { data: { targetKey: reference.targetKey, title } });
  expect(create.status()).toBe(201);
  const id = (await create.json()).report.id as string;
  const endpoint = `/api/explore/reports/${id}`;
  const read = async () => {
    const response = await request.get(endpoint);
    expect(response.ok()).toBe(true);
    return (await response.json()).report;
  };
  const ids = async () => (await read()).blocks.map((block: { id: string }) => block.id);
  const forbiddenWrites: string[] = [];
  try {
    const before = await read();
    const initial = [
      { id: "qa-intro", type: "text", markdown: "## Introduction\nA layout check, using an isolated test report.", span: 2 },
      { id: "qa-results", type: "text", markdown: "## Results\nThis card should keep its content when moved.", span: 1 },
      { id: "qa-notes", type: "text", markdown: "## Notes\nA second half-width card.", span: 1 },
    ];
    const save = await request.put(endpoint, { data: { title, blocks: initial, filters: [], expectedUpdatedAt: before.updatedAt } });
    expect(save.ok()).toBe(true);
    await page.route("**/api/**", route => {
      const req = route.request();
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method()) && !(req.method() === "PUT" && new URL(req.url()).pathname === endpoint)) {
        forbiddenWrites.push(req.url());
        return route.abort();
      }
      return route.continue();
    });
    await page.addInitScript(() => localStorage.setItem("seqdesk:explore:page-panel", "shown"));
    await page.goto(`/explore/reports/${id}?scope=${encodeURIComponent(reference.targetKey)}&mode=edit&view=page`);
    const block = (blockId: string) => page.locator(`[data-report-block-id="${blockId}"]`);
    const handle = (blockId: string) => block(blockId).getByRole("button", { name: "Drag to move block" });
    await expect(handle("qa-notes")).toBeVisible({ timeout: 30_000 });

    await handle("qa-notes").dragTo(block("qa-intro"), { targetPosition: { x: 20, y: 15 } });
    await expect.poll(ids).toEqual(["qa-notes", "qa-intro", "qa-results"]);
    expect((await read()).blocks.find((entry: { id: string }) => entry.id === "qa-notes")).toMatchObject(initial[2]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(ids).toEqual(initial.map(entry => entry.id));

    await page.getByRole("button", { name: "Add content before block 2", exact: true }).click();
    await page.getByRole("button", { name: "Text Write a heading or explanation", exact: true }).click();
    await expect.poll(async () => (await ids()).length).toBe(4);
    const noteId = (await ids())[1];
    await expect(block(noteId).locator('[contenteditable="true"]')).toBeFocused();
    await block(noteId).locator('[contenteditable="true"]').fill("An explanation added exactly where it belongs.");
    await expect.poll(async () => (await read()).blocks[1].markdown).toContain("An explanation added exactly where it belongs.");
    await handle(noteId).dragTo(page.locator("[data-report-drop-end]"));
    await expect.poll(ids).toEqual(["qa-intro", "qa-results", "qa-notes", noteId]);
    expect((await read()).blocks[3].markdown).toContain("An explanation added exactly where it belongs.");

    // Chart setup is a preview, not an insertion, until confirmed.
    const savedAt = (await read()).updatedAt;
    await page.getByRole("button", { name: "Add content before block 2", exact: true }).click();
    await page.getByRole("button", { name: "Chart from a table Choose data and preview a chart", exact: true }).click();
    const chart = page.getByRole("dialog", { name: "Create chart from a table", exact: true });
    await chart.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await read()).updatedAt).toBe(savedAt);
    const numeric = (await read()).outputs.tables.find((entry: { columns: Array<{ type: string }>; rowCount: number }) => entry.rowCount > 0 && entry.columns.some(column => column.type === "number"));
    if (numeric) {
      await page.getByRole("button", { name: "Add content before block 2", exact: true }).click();
      await page.getByRole("button", { name: "Chart from a table Choose data and preview a chart", exact: true }).click();
      await chart.getByRole("combobox", { name: "Source table" }).selectOption(numeric.datasetId);
      await expect(chart.getByRole("region", { name: "Chart preview" })).toBeVisible();
      await chart.getByRole("button", { name: "Add chart to page", exact: true }).click();
      await expect.poll(async () => (await read()).blocks[1].type).toBe("chart");
      expect((await read()).blocks[1].datasetId).toBe(numeric.datasetId);
    }

    const metadata = (await read()).outputs.tables.find((entry: { kind: string }) => entry.kind === "samples");
    if (metadata) {
      await page.getByRole("button", { name: "Add content before block 1", exact: true }).click();
      await page.getByRole("button", { name: "Saved data & figures Metadata, pipeline outputs and your files", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Add to page", exact: true });
      await picker.getByRole("article").filter({ has: page.getByRole("heading", { name: "Samples", exact: true }) }).getByRole("button", { name: "Add table to page", exact: true }).click();
      await expect.poll(async () => (await read()).blocks[0].datasetId).toBe(metadata.datasetId);
    }
    await page.screenshot({ path: testInfo.outputPath("report-composer-desktop.png"), animations: "disabled" });

    // Touch users have the same insertion menu, and handle arrow keys also work.
    await page.setViewportSize({ width: 390, height: 844 });
    const currentIds = await ids();
    const position = currentIds.indexOf("qa-notes");
    await handle("qa-notes").focus();
    await handle("qa-notes").press("ArrowUp");
    const moved = [...currentIds];
    [moved[position - 1], moved[position]] = [moved[position], moved[position - 1]];
    await expect.poll(ids).toEqual(moved);
    await page.getByRole("button", { name: "Add content at the end", exact: true }).click();
    await expect(page.getByRole("button", { name: "Text Write a heading or explanation", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("report-composer-mobile.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Drag to move block" })).toHaveCount(0);
    // Reload proves the layout is saved, rather than only arranged in local state.
    await page.reload();
    await expect(page.getByText("An explanation added exactly where it belongs.", { exact: true })).toBeVisible();
    // First edit after reloading must strip server-resolved table data, not save it as block settings.
    const savedCount = (await ids()).length;
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Add content at the end", exact: true }).click();
    await page.getByRole("button", { name: "Text Write a heading or explanation", exact: true }).click();
    await expect.poll(async () => (await ids()).length).toBe(savedCount + 1);
    expect(forbiddenWrites).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath("composer-before-cleanup.png"), animations: "disabled" });
    await testInfo.attach("page-before-cleanup", { body: await page.locator("body").innerText(), contentType: "text/plain" });
    throw error;
  } finally {
    await page.goto("about:blank");
    const scratch = await read();
    expect(scratch.title).toBe(title);
    expect(scratch.outputs.analyses).toHaveLength(0);
    expect((await request.delete(endpoint)).ok()).toBe(true);
  }
});
