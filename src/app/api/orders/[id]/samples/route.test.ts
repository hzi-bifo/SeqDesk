import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    sampleset: {
      upsert: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
    orderFormConfig: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { POST } from "./route";

describe("POST /api/orders/[id]/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.orderFormConfig.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
  });

  it("rejects submitted-order sample edits outside facility-only mode", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      status: "SUBMITTED",
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples", {
        method: "POST",
        body: JSON.stringify({
          samples: [],
        }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cannot modify samples after order submission",
    });
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
    expect(mocks.db.sample.create).not.toHaveBeenCalled();
    expect(mocks.db.sample.delete).not.toHaveBeenCalled();
  });

  it("allows facility-only sample field updates on submitted orders", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      status: "SUBMITTED",
    });
    mocks.db.sample.findMany
      .mockResolvedValueOnce([
        {
          id: "sample-1",
          customFields: JSON.stringify({
            facility_sample_notes: "Old internal note",
            researcher_comment: "Keep me",
          }),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "sample-1",
          sampleId: "S1",
          sampleAlias: null,
          sampleTitle: "Original Title",
          sampleDescription: null,
          scientificName: null,
          taxId: null,
          checklistData: null,
          checklistUnits: null,
          customFields: JSON.stringify({
            facility_sample_notes: "Updated internal note",
            researcher_comment: "Keep me",
          }),
        },
      ]);
    mocks.db.sample.update.mockResolvedValue({
      id: "sample-1",
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples", {
        method: "POST",
        body: JSON.stringify({
          facilityFieldsOnly: true,
          samples: [
            {
              id: "sample-1",
              sampleId: "S1",
              sampleTitle: "Tampered Title",
              customFields: {
                facility_sample_notes: "Updated internal note",
                researcher_comment: "Overwrite me",
              },
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    const updateArgs = mocks.db.sample.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data).toEqual({
      customFields: JSON.stringify({
        facility_sample_notes: "Updated internal note",
        researcher_comment: "Keep me",
      }),
    });
    expect(updateArgs.data).not.toHaveProperty("sampleTitle");
    await expect(response.json()).resolves.toMatchObject({
      samples: [
        {
          id: "sample-1",
          customFields: {
            facility_sample_notes: "Updated internal note",
            researcher_comment: "Keep me",
          },
        },
      ],
    });
  });

  it("blocks facility-only mode from creating or deleting sample rows", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
      userId: "user-1",
      status: "SUBMITTED",
    });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        customFields: null,
      },
    ]);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples", {
        method: "POST",
        body: JSON.stringify({
          facilityFieldsOnly: true,
          samples: [
            {
              id: "sample-1",
              isDeleted: true,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Facility sample edits can only update existing samples",
    });
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
    expect(mocks.db.sample.create).not.toHaveBeenCalled();
    expect(mocks.db.sample.delete).not.toHaveBeenCalled();
  });
});
