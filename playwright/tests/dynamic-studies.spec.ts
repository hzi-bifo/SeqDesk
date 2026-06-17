import { expect, test, type Page } from "@playwright/test";

// The Dynamic Studies feature (the `dynamic-studies` module) is a FACILITY_ADMIN
// surface: it lets admins define multiple studies, each with its OWN
// questionnaire, instead of a single global study form. These specs drive it as
// an admin and restore the module's enabled state afterwards so they leave no
// global side effects for other specs.
test.use({ storageState: "playwright/.auth/admin.json" });

test.setTimeout(90000);

const MODULE_ID = "dynamic-studies";

type ModulesConfig = {
  modules: Record<string, boolean>;
  globalDisabled: boolean;
};

type StudyFormConfigResponse = {
  fields: Array<{ name?: string } & Record<string, unknown>>;
  groups: Array<{ name: string }>;
};

async function readModuleEnabled(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/admin/modules");
  expect(response.ok()).toBeTruthy();
  const config = (await response.json()) as ModulesConfig;
  return Boolean(config.modules?.[MODULE_ID]);
}

async function setModuleEnabled(page: Page, enabled: boolean): Promise<void> {
  const response = await page.request.put("/api/admin/modules", {
    headers: { "Content-Type": "application/json" },
    data: { moduleId: MODULE_ID, enabled },
  });
  expect(response.ok()).toBeTruthy();

  // Confirm the toggle stuck before continuing.
  await expect.poll(async () => readModuleEnabled(page), { timeout: 15000 }).toBe(
    enabled
  );
}

async function readStudyFormConfig(
  page: Page,
  studyId: string
): Promise<StudyFormConfigResponse> {
  const response = await page.request.get(
    `/api/admin/study-form-config?studyId=${encodeURIComponent(studyId)}`
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as StudyFormConfigResponse;
}

function configFieldNames(config: StudyFormConfigResponse): string[] {
  return config.fields
    .map((field) => (field && typeof field === "object" ? field.name : undefined))
    .filter((name): name is string => typeof name === "string");
}

async function createBlankStudy(
  page: Page,
  title: string
): Promise<{ id: string }> {
  const response = await page.request.post("/api/admin/study-definitions", {
    headers: { "Content-Type": "application/json" },
    data: { title, seedMode: "blank" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

// Snapshot of the module's enabled state, captured before each test so we can
// restore it afterwards (the module is OFF by default).
let originalModuleEnabled: boolean | null = null;

test.beforeEach(async ({ page }) => {
  originalModuleEnabled = await readModuleEnabled(page);
  await setModuleEnabled(page, true);
});

test.afterEach(async ({ page }) => {
  if (originalModuleEnabled === null) return;
  try {
    await setModuleEnabled(page, originalModuleEnabled);
  } finally {
    originalModuleEnabled = null;
  }
});

test("admin can create a blank study with its own questionnaire", async ({
  page,
}) => {
  const suffix = Date.now();
  const title = `Playwright Dynamic Study ${suffix}`;

  // Create the study via the API and assert the response.
  const createResponse = await page.request.post("/api/admin/study-definitions", {
    headers: { "Content-Type": "application/json" },
    data: { title, seedMode: "blank" },
  });
  expect(createResponse.status()).toBe(201);
  const study = (await createResponse.json()) as { id: string; title: string };
  expect(study.id).toBeTruthy();
  expect(study.title).toBe(title);

  // A blank study is seeded with a default questionnaire that always includes
  // the sample-association interface field.
  const config = await readStudyFormConfig(page, study.id);
  expect(Array.isArray(config.fields)).toBe(true);
  expect(config.fields.length).toBeGreaterThan(0);
  expect(configFieldNames(config)).toContain("_sample_association");

  // Drive the UI: the "Define Studies" surface should list the new study and
  // link to its own questionnaire builder.
  await page.goto("/admin/study-definitions");
  await expect(
    page.getByRole("heading", { name: "Define Studies" })
  ).toBeVisible();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

  // Each study renders as a bordered row holding its title and an
  // "Edit questionnaire" link; scope to the row that contains this study.
  const studyRow = page
    .locator("div.rounded-lg.border")
    .filter({ has: page.getByText(title, { exact: true }) })
    .filter({ has: page.getByRole("link", { name: /Edit questionnaire/i }) })
    .first();
  await studyRow.getByRole("link", { name: /Edit questionnaire/i }).click();

  // The builder loads this study's own questionnaire (note the studyId query).
  await page.waitForURL(
    new RegExp(`/admin/study-form-builder\\?studyId=${study.id}\\b`)
  );
  await expect(
    page.getByRole("heading", { name: "Study Configuration" })
  ).toBeVisible();
});

test("admin can clone an existing study's questionnaire", async ({ page }) => {
  const suffix = Date.now();
  const sourceTitle = `Playwright Clone Source ${suffix}`;
  const clonedTitle = `Playwright Clone Target ${suffix}`;

  // Source study with a default (blank) questionnaire.
  const sourceResponse = await page.request.post(
    "/api/admin/study-definitions",
    {
      headers: { "Content-Type": "application/json" },
      data: { title: sourceTitle, seedMode: "blank" },
    }
  );
  expect(sourceResponse.status()).toBe(201);
  const source = (await sourceResponse.json()) as { id: string };
  expect(source.id).toBeTruthy();

  const sourceConfig = await readStudyFormConfig(page, source.id);
  expect(configFieldNames(sourceConfig)).toContain("_sample_association");

  // Clone it into a new study.
  const cloneResponse = await page.request.post("/api/admin/study-definitions", {
    headers: { "Content-Type": "application/json" },
    data: {
      title: clonedTitle,
      seedMode: "clone",
      cloneFromStudyId: source.id,
    },
  });
  expect(cloneResponse.status()).toBe(201);
  const cloned = (await cloneResponse.json()) as { id: string };
  expect(cloned.id).toBeTruthy();
  expect(cloned.id).not.toBe(source.id);

  // The clone carries over the source's fields (a fresh form, same field names).
  const clonedConfig = await readStudyFormConfig(page, cloned.id);
  expect(configFieldNames(clonedConfig)).toContain("_sample_association");
  expect(clonedConfig.fields.length).toBe(sourceConfig.fields.length);
});

test("a study's questionnaire is isolated from other studies and the global form", async ({
  page,
}) => {
  const suffix = Date.now();
  const studyA = await createBlankStudy(page, `PW Isolation A ${suffix}`);
  const studyB = await createBlankStudy(page, `PW Isolation B ${suffix}`);
  const customField = `pw_isolation_field_${suffix}`;

  // Add a custom field to study A's questionnaire only.
  const aConfig = await readStudyFormConfig(page, studyA.id);
  const putResponse = await page.request.put(
    `/api/admin/study-form-config?studyId=${encodeURIComponent(studyA.id)}`,
    {
      headers: { "Content-Type": "application/json" },
      data: {
        fields: [
          ...aConfig.fields,
          {
            id: `f_${suffix}`,
            type: "text",
            label: "Isolation Field",
            name: customField,
            required: false,
            visible: true,
            order: 99,
          },
        ],
        groups: aConfig.groups,
      },
    }
  );
  expect(putResponse.ok()).toBeTruthy();

  // A has the new field...
  expect(
    configFieldNames(await readStudyFormConfig(page, studyA.id))
  ).toContain(customField);
  // ...study B does NOT (per-study isolation)...
  expect(
    configFieldNames(await readStudyFormConfig(page, studyB.id))
  ).not.toContain(customField);
  // ...and the global study form is untouched (no studyId).
  const globalResponse = await page.request.get("/api/admin/study-form-config");
  expect(globalResponse.ok()).toBeTruthy();
  const globalConfig = (await globalResponse.json()) as StudyFormConfigResponse;
  expect(configFieldNames(globalConfig)).not.toContain(customField);
});
