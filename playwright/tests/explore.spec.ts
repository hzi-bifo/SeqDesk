import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createAndSubmitOrder, createStudyFromOrderSamples } from "./helpers";

// Explore: datasets built from a study, the table view with curation edits,
// and the module gate. Uses the seeded researcher (owner of the seeded studies).
test.use({ storageState: "playwright/.auth/researcher.json" });

interface BuildResult {
  dataset: { id: string; name: string; currentVersion: { contentHash: string } };
  version: { rowCount: number };
}

/**
 * The first study of the researcher whose samples dataset has rows, built
 * through the API. Seeded studies without samples are skipped.
 */
async function findStudyWithSamples(request: APIRequestContext): Promise<{ scope: string; result: BuildResult } | null> {
  const response = await request.get("/api/explore/scopes");
  expect(response.ok()).toBeTruthy();
  const { scopes } = (await response.json()) as { scopes: Array<{ targetKey: string; type: string }> };
  for (const scope of scopes.filter((entry) => entry.type === "study")) {
    const build = await request.post("/api/explore/datasets/build", { data: { targetKey: scope.targetKey, kind: "samples" } });
    if (build.status() === 404) continue;
    expect([200, 201]).toContain(build.status());
    const result = (await build.json()) as BuildResult;
    if (result.version.rowCount > 0) return { scope: scope.targetKey, result };
  }
  return null;
}

/**
 * Build the samples dataset of a study the researcher owns. When no seeded
 * study has samples yet, create an order with one sample and a study from it
 * through the UI, exactly like the study specs do.
 */
async function buildSamplesDataset(page: Page, request: APIRequestContext): Promise<{ scope: string; result: BuildResult }> {
  const existing = await findStudyWithSamples(request);
  if (existing) return existing;
  const suffix = Date.now().toString(36);
  await createAndSubmitOrder(page, `Explore order ${suffix}`, [{ volume: "10", concentration: "5" }]);
  await createStudyFromOrderSamples(page, `Explore study ${suffix}`);
  const created = await findStudyWithSamples(request);
  expect(created, "a study with samples exists after creating one").toBeTruthy();
  return created!;
}

test("builds the samples dataset of a study and opens it in the table view", async ({ page, request }) => {
  const { scope, result } = await buildSamplesDataset(page, request);
  const { dataset } = result;

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
  const { result } = await buildSamplesDataset(page, request);
  const { dataset } = result;

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

// Runs a kit through the app when a registered environment exists. The CI
// workflow builds the Python environment and registers it before this spec;
// on a developer machine without one the test is skipped, not failed.
test("runs an analysis kit end to end and records its outputs", async ({ page, request }) => {
  test.setTimeout(240_000);
  const kitId = process.env.EXPLORE_E2E_KIT || "table-summary";
  const environments = await request.get("/api/explore/environments");
  const { environments: list } = (await environments.json()) as { environments: Array<{ name: string; status: string }> };
  test.skip(!list.some((entry) => entry.name === "seqdesk-explore-python" && entry.status === "ready"), "no ready analysis environment");

  const { scope, result } = await buildSamplesDataset(page, request);
  const created = await request.post("/api/explore/analyses", {
    data: { targetKey: scope, kitId, inputs: [{ alias: "table", datasetId: result.dataset.id }] },
  });
  expect(created.status()).toBe(201);
  const { analysis } = (await created.json()) as { analysis: { id: string } };

  const started = await request.post(`/api/explore/analyses/${analysis.id}/runs`, { data: { executionMode: "local" } });
  expect(started.status(), await started.text()).toBe(201);
  const { run } = (await started.json()) as { run: { id: string; runNumber: string } };

  interface RunPayload {
    run: { status: string; artifacts: Array<{ kind: string; format: string; derivedDatasetId: string | null }>; errorTail: string | null };
  }
  let status = "pending";
  let payload: RunPayload | null = null;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/explore/runs/${run.id}`);
    payload = (await response.json()) as RunPayload;
    status = payload.run.status;
    if (["completed", "failed", "cancelled"].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  expect(status, payload?.run.errorTail ?? "").toBe("completed");
  const artifacts = payload!.run.artifacts;
  expect(artifacts.some((artifact) => artifact.kind === "figure" && artifact.format === "plotly-json")).toBe(true);
  const table = artifacts.find((artifact) => artifact.kind === "table");
  expect(table?.derivedDatasetId, "the summary table becomes a derived dataset").toBeTruthy();

  await page.goto(`/explore/runs/${run.id}`);
  await expect(page.getByRole("heading", { name: run.runNumber })).toBeVisible();
  await expect(page.getByText("completed")).toBeVisible();
  await page.getByRole("tab", { name: /Code/ }).click();
  await expect(page.getByRole("region", { name: "Executed code" })).toBeVisible();
});
