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
    throw new Error("DATABASE_URL is not configured for Playwright order notes tests");
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

async function createSeededResearcherOrder(orderName: string) {
  const researcher = await prisma.user.findUnique({
    where: { email: "user@example.com" },
    select: { id: true },
  });

  if (!researcher) {
    throw new Error("Seeded researcher user not found");
  }

  const timestamp = Date.now();

  return prisma.order.create({
    data: {
      orderNumber: `PW-NOTES-${timestamp}`,
      name: orderName,
      generatedByE2E: true,
      status: "DRAFT",
      numberOfSamples: 0,
      userId: researcher.id,
    },
    select: {
      id: true,
      name: true,
    },
  });
}

async function deleteSeededOrder(orderId: string) {
  await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
}

async function openOrderNotesSidebar(
  page: Page,
  orderId: string,
): Promise<{ panel: Locator; editor: Locator }> {
  await page.goto(`/orders/${orderId}`);
  await expect(page).toHaveURL(new RegExp(`/orders/${orderId}(?:/.*)?$`));

  const panel = page.locator("[data-order-notes-panel]");
  await expect(panel).toBeVisible();

  const editor = panel.locator(".rsw-ce[contenteditable='true']").first();
  await expect(editor).toBeVisible();

  return { panel, editor };
}

test("researcher can autosave order notes from the right sidebar", async ({ page }) => {
  const order = await createSeededResearcherOrder(`Notes Draft ${Date.now()}`);
  const noteText = `Courier label pending ${Date.now()}`;

  try {
    const { panel, editor } = await openOrderNotesSidebar(page, order.id);

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/orders/${order.id}/notes`) &&
        response.request().method() === "PUT",
      { timeout: 10000 },
    );

    await editor.fill(noteText);

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    await expect(panel.locator('span[title="Saved"]')).toBeVisible();

    await expect.poll(async () => {
      const result = await page.evaluate(async (currentOrderId) => {
        const response = await fetch(`/api/orders/${currentOrderId}/notes`);
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as { notes?: string | null };
        return payload.notes ?? null;
      }, order.id);

      return result;
    }).toBe(noteText);

    await page.reload();

    const reloadedPanel = page.locator("[data-order-notes-panel]");
    await expect(reloadedPanel).toBeVisible();
    await expect(reloadedPanel.locator(".rsw-ce").first()).toContainText(noteText);
  } finally {
    await deleteSeededOrder(order.id);
  }
});

test("researcher can collapse and reopen the right notes sidebar", async ({ page }) => {
  const order = await createSeededResearcherOrder(`Notes Toggle ${Date.now()}`);

  try {
    await openOrderNotesSidebar(page, order.id);

    await page.getByRole("button", { name: "Hide order notes" }).click();
    await expect(page.getByRole("button", { name: "Show order notes" })).toBeVisible();
    await expect(page.locator("[data-order-notes-panel]")).toHaveCount(0);

    await page.reload();

    const showButton = page.getByRole("button", { name: "Show order notes" });
    await expect(showButton).toBeVisible();
    await showButton.click();

    await expect(page.locator("[data-order-notes-panel]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide order notes" })).toBeVisible();
  } finally {
    await deleteSeededOrder(order.id);
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
