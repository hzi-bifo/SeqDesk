import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Exercises the ENA submission UI + its required-data validation WITHOUT performing
// a real submission to ENA. The flow lives on the study detail page under the
// "publishing" tab: navigating to `/studies/{id}?tab=publishing&publisher=ena`
// renders the "Register at ENA" view (src/app/(dashboard)/studies/[id]/page.tsx).
//
// The submit action is gated in two layers, both of which we assert here:
//   1. UI: the "Register at ENA" view shows a "Submission Requirements" checklist
//      derived from the study data (Title / Description / Samples / Taxonomy ID).
//      A sample missing a taxId surfaces the Taxonomy ID check as not-passed.
//   2. API: POST /api/admin/submissions (src/app/api/admin/submissions/route.ts)
//      always returns HTTP 400 for an un-submittable study — either because Webin
//      credentials are not configured, or because a required field (e.g. taxId,
//      title, description) is missing. No real ENA network submission can succeed
//      here, so we never reach the live drop-box endpoint.
//
// This spec is admin-only: only FACILITY_ADMIN can reach the register controls and
// the /api/admin/submissions route. We seed studies directly via Prisma (same
// pattern as study-notes.spec.ts) so we fully control title/description/taxId and
// can clean up deterministically, and mark them generatedByE2E.
test.use({ storageState: "playwright/.auth/admin.json" });

test.setTimeout(60000);

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const configPath = path.resolve(process.cwd(), "seqdesk.config.json");
  const rawConfig = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(rawConfig) as {
    runtime?: { databaseUrl?: string };
  };

  const databaseUrl = config.runtime?.databaseUrl?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured for the ENA submission Playwright spec");
  }

  return databaseUrl;
}

const prisma = new PrismaClient({
  datasources: { db: { url: resolveDatabaseUrl() } },
});

type SeededStudy = {
  studyId: string;
  orderId: string;
};

async function getAdminUserId(): Promise<string> {
  const admin = await prisma.user.findUnique({
    where: { email: "admin@example.com" },
    select: { id: true },
  });

  if (!admin) {
    throw new Error("Seeded admin user (admin@example.com) not found");
  }

  return admin.id;
}

// Creates a study owned by the seeded admin with a single sample. The sample's
// taxId/scientificName are optional so callers can produce a study that either
// passes or fails the ENA "Taxonomy ID" requirement.
async function createSeededAdminStudyWithSample(options: {
  title: string;
  description: string | null;
  taxId: string | null;
  scientificName: string | null;
}): Promise<SeededStudy> {
  const adminId = await getAdminUserId();
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);

  const order = await prisma.order.create({
    data: {
      orderNumber: `PW-ENA-${timestamp}-${suffix}`,
      name: `ENA submission source ${timestamp}`,
      generatedByE2E: true,
      status: "DRAFT",
      numberOfSamples: 1,
      userId: adminId,
    },
    select: { id: true },
  });

  const study = await prisma.study.create({
    data: {
      title: options.title,
      description: options.description,
      alias: `pw-ena-${timestamp}-${suffix}`,
      checklistType: "human-associated",
      generatedByE2E: true,
      userId: adminId,
    },
    select: { id: true },
  });

  await prisma.sample.create({
    data: {
      orderId: order.id,
      studyId: study.id,
      sampleId: `PW-ENA-SAMPLE-${timestamp}-${suffix}`,
      sampleTitle: `ENA sample ${timestamp}`,
      taxId: options.taxId,
      scientificName: options.scientificName,
    },
    select: { id: true },
  });

  return { studyId: study.id, orderId: order.id };
}

async function deleteSeededStudy(seeded: SeededStudy) {
  // Samples cascade-delete with the order; remove the study first to drop the
  // sample->study link, then the order (which cascades the sample).
  await prisma.study.delete({ where: { id: seeded.studyId } }).catch(() => undefined);
  await prisma.order.delete({ where: { id: seeded.orderId } }).catch(() => undefined);
}

test("admin sees the ENA register requirements checklist for a complete study", async ({
  page,
}) => {
  const seeded = await createSeededAdminStudyWithSample({
    title: `Playwright ENA Complete ${Date.now()}`,
    description: "A complete study used to exercise the ENA register requirements view.",
    taxId: "562",
    scientificName: "Escherichia coli",
  });

  try {
    await page.goto(`/studies/${seeded.studyId}?tab=publishing&publisher=ena`);

    // The "Register at ENA" view header is rendered for the ENA publishing target.
    await expect(
      page.getByRole("heading", { name: "Register at ENA", level: 1 }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByText("Register your study and samples with the European Nucleotide Archive."),
    ).toBeVisible();

    // The requirements checklist surfaces the data ENA requires before registration.
    // These rows come directly from the study fields (no network call needed).
    const requirements = page.getByRole("heading", { name: "Submission Requirements" });
    await expect(requirements).toBeVisible();

    const requirementsCard = page.locator("div.rounded-xl", { has: requirements });
    await expect(requirementsCard.getByText("Title", { exact: true })).toBeVisible();
    await expect(requirementsCard.getByText("Description", { exact: true })).toBeVisible();
    await expect(requirementsCard.getByText("Samples", { exact: true })).toBeVisible();
    await expect(requirementsCard.getByText("Taxonomy ID", { exact: true })).toBeVisible();

    // For a complete study, the Taxonomy ID requirement reflects the seeded organism
    // (rendered as "<scientificName> (<taxId>)") rather than "Missing".
    await expect(requirementsCard.getByText(/Escherichia coli \(562\)/)).toBeVisible();
  } finally {
    await deleteSeededStudy(seeded);
  }
});

test("admin sees the Taxonomy ID requirement fail when a sample is missing a taxId", async ({
  page,
}) => {
  const seeded = await createSeededAdminStudyWithSample({
    title: `Playwright ENA Missing Tax ${Date.now()}`,
    description: "A study whose only sample has no taxId, so ENA registration is blocked.",
    taxId: null,
    scientificName: null,
  });

  try {
    await page.goto(`/studies/${seeded.studyId}?tab=publishing&publisher=ena`);

    const requirements = page.getByRole("heading", { name: "Submission Requirements" });
    await expect(requirements).toBeVisible({ timeout: 20000 });

    const requirementsCard = page.locator("div.rounded-xl", { has: requirements });
    const taxonomyRow = requirementsCard.locator("div", {
      has: page.getByText("Taxonomy ID", { exact: true }),
    });

    // With no taxId on the sample, the requirement value renders as "Missing"
    // (the check has no value, so the UI falls back to "Missing" for failed checks).
    await expect(taxonomyRow.getByText("Missing", { exact: true })).toBeVisible();
  } finally {
    await deleteSeededStudy(seeded);
  }
});

test("submitting a study to ENA is blocked (400) and never reaches a real submission", async ({
  page,
}) => {
  // A study whose only sample is missing a taxId can never be registered. The
  // /api/admin/submissions route validates required data and gates on configured
  // Webin credentials BEFORE making any ENA network call, so this POST must fail
  // with HTTP 400 and a descriptive error in every environment:
  //   - no Webin credentials configured -> "ENA credentials not configured..."
  //   - credentials configured but taxId missing -> "... missing taxonomy ID ..."
  // Either way, no real ENA submission is attempted.
  const seeded = await createSeededAdminStudyWithSample({
    title: `Playwright ENA Block ${Date.now()}`,
    description: "A study used to assert the submit action is gated server-side.",
    taxId: null,
    scientificName: null,
  });

  try {
    const response = await page.request.post("/api/admin/submissions", {
      headers: {
        "Content-Type": "application/json",
        "x-seqdesk-e2e": "playwright",
      },
      data: {
        entityType: "study",
        entityId: seeded.studyId,
        // Force the ENA test target so production accession state is never touched.
        isTest: true,
      },
    });

    // The submit is always rejected client-visibly with a 400 (not a 5xx and not a
    // success). This proves the action is gated without requiring (or using) real
    // Webin credentials.
    expect(response.status()).toBe(400);

    const body = (await response.json()) as { error?: string };
    expect(typeof body.error).toBe("string");

    // The error is one of the documented required-data / credential gates. We accept
    // either because the active gate depends on whether this install happens to have
    // Webin credentials configured; neither path performs a real ENA submission.
    expect(body.error).toMatch(
      /ENA credentials not configured|missing taxonomy ID|Study title is required|Study description is required|at least one sample/i,
    );

    // Defensive: confirm the study was not flagged as submitted/accessioned by this
    // call (i.e. no successful registration side effects landed).
    const study = await prisma.study.findUnique({
      where: { id: seeded.studyId },
      select: { submitted: true, studyAccessionId: true },
    });
    expect(study?.submitted).toBe(false);
    expect(study?.studyAccessionId).toBeFalsy();
  } finally {
    await deleteSeededStudy(seeded);
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
