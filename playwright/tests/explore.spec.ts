import { expect, test, type APIRequestContext } from "@playwright/test";

// Explore: datasets built from a study, the table view with curation edits,
// and the module gate. Uses the seeded researcher (owner of the seeded studies).
test.use({ storageState: "playwright/.auth/researcher.json" });

async function firstStudyScope(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/explore/scopes");
  expect(response.ok()).toBeTruthy();
  const { scopes } = (await response.json()) as { scopes: Array<{ targetKey: string; type: string }> };
  const study = scopes.find((scope) => scope.type === "study");
  expect(study, "the researcher owns at least one study").toBeTruthy();
  return study!.targetKey;
}

test("builds the samples dataset of a study and opens it in the table view", async ({ page, request }) => {
  const scope = await firstStudyScope(request);

  const build = await request.post("/api/explore/datasets/build", { data: { targetKey: scope, kind: "samples" } });
  expect([200, 201]).toContain(build.status());
  const { dataset, version } = (await build.json()) as { dataset: { id: string; name: string }; version: { rowCount: number } };
  expect(version.rowCount).toBeGreaterThan(0);

  await page.goto(`/explore?scope=${encodeURIComponent(scope)}`);
  await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.getByRole("link", { name: dataset.name })).toBeVisible();

  await page.goto(`/explore/datasets/${dataset.id}`);
  await expect(page.getByRole("heading", { name: dataset.name })).toBeVisible();
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: /Sample record/ })).toBeVisible();

  // Hide a column through the Columns menu and confirm it disappears.
  await page.getByRole("button", { name: "Columns" }).click();
  const facilityStatus = page.getByRole("menuitemcheckbox", { name: /Facility status/ });
  await facilityStatus.click();
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("columnheader", { name: /Facility status/ })).toHaveCount(0);

  // The choice survives a reload (persisted per dataset in the browser).
  await page.reload();
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.getByRole("grid").getByRole("columnheader", { name: /Facility status/ })).toHaveCount(0);
});

test("records curation edits without changing the stored version", async ({ page, request }) => {
  const scope = await firstStudyScope(request);
  const build = await request.post("/api/explore/datasets/build", { data: { targetKey: scope, kind: "samples" } });
  const { dataset } = (await build.json()) as { dataset: { id: string; currentVersion: { contentHash: string } } };

  const rows = await request.get(`/api/explore/datasets/${dataset.id}/rows?limit=1`);
  const { rows: page1 } = (await rows.json()) as { rows: Array<{ rowKey: string }> };
  expect(page1.length).toBe(1);

  const edit = await request.post(`/api/explore/datasets/${dataset.id}/edits`, {
    data: { kind: "row-flag", target: { rowKey: page1[0].rowKey }, value: "check", reason: "playwright" },
  });
  expect(edit.status()).toBe(201);

  await page.goto(`/explore/datasets/${dataset.id}`);
  await page.getByRole("tab", { name: /Edits/ }).click();
  await expect(page.getByRole("cell", { name: "row-flag" })).toBeVisible();

  const detail = await request.get(`/api/explore/datasets/${dataset.id}`);
  const { dataset: after } = (await detail.json()) as { dataset: { currentVersion: { contentHash: string }; editCount: number } };
  expect(after.currentVersion.contentHash).toBe(dataset.currentVersion.contentHash);
  expect(after.editCount).toBeGreaterThan(0);
});

test("rejects scopes the researcher does not own", async ({ request }) => {
  const forbidden = await request.get("/api/explore/datasets?targetKey=study:does-not-exist");
  expect(forbidden.status()).toBe(404);
  const malformed = await request.get("/api/explore/datasets?targetKey=nonsense");
  expect(malformed.status()).toBe(404);
});
