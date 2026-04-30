import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.setTimeout(60000);

test.use({ storageState: "playwright/.auth/researcher.json" });

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const configPath = path.resolve(process.cwd(), "seqdesk.config.json");
  const rawConfig = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(rawConfig) as {
    runtime?: {
      databaseUrl?: string;
    };
  };

  const databaseUrl = config.runtime?.databaseUrl?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured for Playwright study notes tests");
  }

  return databaseUrl;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: resolveDatabaseUrl(),
    },
  },
});

async function createSeededResearcherStudy(title: string) {
  const researcher = await prisma.user.findUnique({
    where: { email: "user@example.com" },
    select: { id: true },
  });

  if (!researcher) {
    throw new Error("Seeded researcher user not found");
  }

  const timestamp = Date.now();

  return prisma.study.create({
    data: {
      title,
      alias: `pw-study-notes-${timestamp}`,
      checklistType: "human-associated",
      generatedByE2E: true,
      userId: researcher.id,
    },
    select: {
      id: true,
      title: true,
    },
  });
}

async function createSeededStudyWithOrderSample(title: string) {
  const researcher = await prisma.user.findUnique({
    where: { email: "user@example.com" },
    select: { id: true },
  });

  if (!researcher) {
    throw new Error("Seeded researcher user not found");
  }

  const timestamp = Date.now();
  const order = await prisma.order.create({
    data: {
      orderNumber: `PW-STUDY-MENTION-${timestamp}`,
      name: `Study mention order ${timestamp}`,
      generatedByE2E: true,
      status: "DRAFT",
      numberOfSamples: 1,
      userId: researcher.id,
    },
    select: {
      id: true,
      orderNumber: true,
    },
  });

  const study = await prisma.study.create({
    data: {
      title,
      alias: `pw-study-mention-${timestamp}`,
      checklistType: "human-associated",
      generatedByE2E: true,
      userId: researcher.id,
    },
    select: {
      id: true,
      title: true,
    },
  });

  const sample = await prisma.sample.create({
    data: {
      orderId: order.id,
      studyId: study.id,
      sampleId: `PW-STUDY-SAMPLE-${timestamp}`,
      sampleTitle: `Study sample ${timestamp}`,
    },
    select: {
      id: true,
      sampleId: true,
    },
  });

  return { order, sample, study };
}

async function deleteSeededStudy(studyId: string) {
  await prisma.study.delete({ where: { id: studyId } }).catch(() => undefined);
}

async function deleteSeededOrder(orderId: string) {
  await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
}

async function openStudyNotesSidebar(
  page: Page,
  studyId: string,
  subpath = "",
): Promise<{ panel: Locator; editor: Locator }> {
  await page.goto(`/studies/${studyId}${subpath}`);
  await expect(page).toHaveURL(new RegExp(`/studies/${studyId}(?:/.*)?(?:\\?.*)?$`));

  const panel = page.locator("[data-study-notes-panel]");
  await expect(panel).toBeVisible();

  const editor = panel.locator(".rsw-ce[contenteditable='true']").first();
  await expect(editor).toBeVisible();

  return { panel, editor };
}

test("researcher can autosave study notes from the right sidebar", async ({ page }) => {
  const study = await createSeededResearcherStudy(`Study Notes Draft ${Date.now()}`);
  const noteText = `Study submission note ${Date.now()}`;

  try {
    const { panel, editor } = await openStudyNotesSidebar(page, study.id);

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/studies/${study.id}`) &&
        response.request().method() === "PUT",
      { timeout: 10000 },
    );

    await editor.fill(noteText);

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    await expect(panel.getByLabel("Saved status: Saved")).toBeVisible();

    await expect.poll(async () => {
      const result = await page.evaluate(async (currentStudyId) => {
        const response = await fetch(`/api/studies/${currentStudyId}`);
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as { notes?: string | null };
        return payload.notes ?? null;
      }, study.id);

      return result;
    }).toBe(noteText);

    await page.reload();

    const reloadedPanel = page.locator("[data-study-notes-panel]");
    await expect(reloadedPanel).toBeVisible();
    await expect(reloadedPanel.locator(".rsw-ce").first()).toContainText(noteText);
  } finally {
    await deleteSeededStudy(study.id);
  }
});

test("researcher sees the study notes sidebar on overview and sub-pages", async ({ page }) => {
  const study = await createSeededResearcherStudy(`Study Notes Routes ${Date.now()}`);

  try {
    await openStudyNotesSidebar(page, study.id);

    await page.getByRole("button", { name: "Hide study notepad" }).click();
    await expect(page.getByRole("button", { name: "Show study notepad" })).toBeVisible();

    await page.goto(`/studies/${study.id}/edit`);
    await expect(page.getByRole("button", { name: "Show study notepad" })).toBeVisible();

    await page.getByRole("button", { name: "Show study notepad" }).click();
    await expect(page.locator("[data-study-notes-panel]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide study notepad" })).toBeVisible();

    await page.goto(`/studies/${study.id}/metadata`);
    await expect(page.locator("[data-study-notes-panel]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide study notepad" })).toBeVisible();
  } finally {
    await deleteSeededStudy(study.id);
  }
});

test("researcher can mention related order and sample in study notes", async ({ page }) => {
  const { order, sample, study } = await createSeededStudyWithOrderSample(
    `Study Notes Mentions ${Date.now()}`,
  );

  try {
    const { panel, editor } = await openStudyNotesSidebar(page, study.id);

    await editor.click();
    await page.keyboard.type(`@${order.orderNumber.slice(0, 12)}`);

    const orderMentionOption = page.getByRole("button", { name: new RegExp(`@${order.orderNumber}`) });
    await expect(orderMentionOption).toBeVisible({ timeout: 10000 });
    await orderMentionOption.click();

    await page.keyboard.type(` @${sample.sampleId.slice(0, 12)}`);

    const sampleMentionOption = page.getByRole("button", { name: new RegExp(`@${sample.sampleId}`) });
    await expect(sampleMentionOption).toBeVisible({ timeout: 10000 });

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/studies/${study.id}`) &&
        response.request().method() === "PUT",
      { timeout: 10000 },
    );

    await sampleMentionOption.click();

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    await expect(panel.getByLabel("Saved status: Saved")).toBeVisible();
    await expect(editor.locator("a[data-note-mention='order']")).toContainText(`@${order.orderNumber}`);
    await expect(editor.locator("a[data-note-mention='sample']")).toContainText(`@${sample.sampleId}`);

    await expect.poll(async () => {
      return prisma.study
        .findUnique({ where: { id: study.id }, select: { notes: true } })
        .then((result) => result?.notes ?? null);
    }).toContain(`seqdesk-mention://sample/${sample.id}`);

    await page.reload();
    const reloadedEditor = page.locator("[data-study-notes-panel] .rsw-ce").first();
    await expect(reloadedEditor.locator("a[data-note-mention='order']")).toContainText(`@${order.orderNumber}`);
    await expect(reloadedEditor.locator("a[data-note-mention='sample']")).toContainText(`@${sample.sampleId}`);
  } finally {
    await deleteSeededStudy(study.id);
    await deleteSeededOrder(order.id);
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
