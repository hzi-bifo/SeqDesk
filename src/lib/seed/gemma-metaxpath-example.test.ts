import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID,
  GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER,
  GEMMA_METAXPATH_EXAMPLE_PROFILE_ID,
  getGemmaMetaxPathExampleStatus,
  seedGemmaMetaxPathExampleDataset,
} from "./gemma-metaxpath-example";

const marker = JSON.stringify({
  _installProfileFixture: {
    profileId: GEMMA_METAXPATH_EXAMPLE_PROFILE_ID,
    fixtureId: GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID,
    kind: "exampleDataset",
    source: "downloadedFastqBundle",
  },
});

function buildPrismaMock({
  order,
  study,
  extraSettings,
}: {
  order: unknown;
  study: unknown;
  extraSettings?: string | null;
}) {
  return {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
    },
    study: {
      findFirst: vi.fn().mockResolvedValue(study),
    },
    siteSettings: {
      findUnique: vi.fn().mockResolvedValue(
        extraSettings === undefined ? null : { extraSettings }
      ),
    },
  };
}

const PROFILE_SEED_DATA = JSON.stringify({
  installProfileSeedData: {
    enabled: true,
    fixtures: [
      {
        id: GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID,
        kind: "exampleDataset",
        orderNumber: GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER,
        source: {
          type: "downloadedFastqBundle",
          url: "https://profile-host.example/gemma.tar.gz",
          sha256: "deadbeef",
        },
      },
    ],
  },
});

function buildAppliedOrder() {
  return {
    id: "order-1",
    status: "SUBMITTED",
    customFields: marker,
    samples: Array.from({ length: 5 }, (_, index) => ({
      id: `sample-${index + 1}`,
      customFields: marker,
      reads: [
        {
          id: `read-${index + 1}`,
          file1: `fixtures/${GEMMA_METAXPATH_EXAMPLE_PROFILE_ID}/${GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID}/reads/GEMMA-${index + 1}.fastq`,
          file2: null,
        },
      ],
    })),
  };
}

describe("getGemmaMetaxPathExampleStatus", () => {
  it("reports missing when the expected order and study are absent", async () => {
    const prisma = buildPrismaMock({ order: null, study: null });

    const status = await getGemmaMetaxPathExampleStatus(prisma as never);

    expect(status).toMatchObject({
      seeded: false,
      fixtureState: "missing",
      fixtureIssues: [],
      orderNumber: GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER,
      orderId: null,
      studyId: null,
      samplesCount: 0,
      readsCount: 0,
    });
  });

  it("reports applied when the seeded fixture shape is intact", async () => {
    const prisma = buildPrismaMock({
      order: buildAppliedOrder(),
      study: { id: "study-1", studyMetadata: marker },
    });

    const status = await getGemmaMetaxPathExampleStatus(prisma as never);

    expect(status.fixtureState).toBe("applied");
    expect(status.fixtureIssues).toEqual([]);
    expect(status.seeded).toBe(true);
    expect(status.samplesCount).toBe(5);
    expect(status.readsCount).toBe(5);
  });

  it("reports changed when expected fixture records are partial or modified", async () => {
    const prisma = buildPrismaMock({
      order: {
        ...buildAppliedOrder(),
        status: "DRAFT",
        customFields: "{}",
        samples: [
          {
            id: "sample-1",
            customFields: "{}",
            reads: [
              {
                id: "read-1",
                file1: "uploads/manual/GEMMA-1.fastq",
                file2: null,
              },
            ],
          },
        ],
      },
      study: { id: "study-1", studyMetadata: "{}" },
    });

    const status = await getGemmaMetaxPathExampleStatus(prisma as never);

    expect(status.fixtureState).toBe("changed");
    expect(status.fixtureIssues).toEqual(
      expect.arrayContaining([
        "Expected order status SUBMITTED, found DRAFT.",
        "Expected 5 samples, found 1.",
        "Expected 5 read sets, found 1.",
        "Order fixture marker is missing or does not match.",
        "Study fixture marker is missing or does not match.",
        "One or more sample fixture markers are missing or changed.",
        "One or more read file links no longer point to the fixture reads folder.",
      ])
    );
  });

  it("reports changed when only one side of the seeded fixture remains", async () => {
    const prisma = buildPrismaMock({
      order: null,
      study: { id: "study-1", studyMetadata: marker },
    });

    const status = await getGemmaMetaxPathExampleStatus(prisma as never);

    expect(status.fixtureState).toBe("changed");
    expect(status.fixtureIssues).toEqual([
      `Seed order ${GEMMA_METAXPATH_EXAMPLE_ORDER_NUMBER} is missing.`,
    ]);
    expect(status.studyId).toBe("study-1");
  });

  it("resolves the dataset source from the applied hosted profile seedData", async () => {
    const prisma = buildPrismaMock({
      order: null,
      study: null,
      extraSettings: PROFILE_SEED_DATA,
    });

    const status = await getGemmaMetaxPathExampleStatus(prisma as never);

    expect(status.sourceUrl).toBe("https://profile-host.example/gemma.tar.gz");
    expect(status.sha256).toBe("deadbeef");
  });

  it("reports an empty source when no hosted profile provides it", async () => {
    const prisma = buildPrismaMock({ order: null, study: null });

    const status = await getGemmaMetaxPathExampleStatus(prisma as never);

    expect(status.sourceUrl).toBe("");
    expect(status.sha256).toBe("");
  });
});

describe("seedGemmaMetaxPathExampleDataset", () => {
  it("refuses to seed when no hosted profile provides the dataset source", async () => {
    const prisma = buildPrismaMock({ order: null, study: null });

    await expect(
      seedGemmaMetaxPathExampleDataset({ prisma: prisma as never })
    ).rejects.toThrow(/not configured/);
  });
});
