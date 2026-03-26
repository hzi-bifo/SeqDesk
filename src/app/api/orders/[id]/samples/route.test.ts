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

import { GET, POST } from "./route";

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

  it("returns 401 on POST when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples", {
        method: "POST",
        body: JSON.stringify({ samples: [] }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 on POST when order not found", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/missing/samples", {
        method: "POST",
        body: JSON.stringify({ samples: [] }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 when samples is not an array", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      userId: "user-1",
      status: "DRAFT",
    });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples", {
        method: "POST",
        body: JSON.stringify({ samples: "not-an-array" }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Samples must be an array",
    });
  });

  it("creates new samples in a DRAFT order", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      userId: "user-1",
      status: "DRAFT",
    });
    mocks.db.sample.create.mockResolvedValue({
      id: "new-sample-1",
      sampleId: "S1",
      sampleAlias: null,
      sampleTitle: null,
      sampleDescription: null,
      scientificName: null,
      taxId: null,
      checklistData: null,
      checklistUnits: null,
      customFields: null,
    });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "new-sample-1",
        sampleId: "S1",
        sampleAlias: null,
        sampleTitle: null,
        sampleDescription: null,
        scientificName: null,
        taxId: null,
        checklistData: null,
        checklistUnits: null,
        customFields: null,
      },
    ]);
    mocks.db.order.update.mockResolvedValue({});

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples", {
        method: "POST",
        body: JSON.stringify({
          samples: [
            { isNew: true, sampleId: "S1" },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.db.sample.create).toHaveBeenCalledTimes(1);
    const data = await response.json();
    expect(data.samples).toHaveLength(1);
    expect(data.samples[0].sampleId).toBe("S1");
  });

  it("deletes samples in a DRAFT order", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      userId: "user-1",
      status: "DRAFT",
    });
    mocks.db.sample.delete.mockResolvedValue({});
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.order.update.mockResolvedValue({});

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples", {
        method: "POST",
        body: JSON.stringify({
          samples: [{ id: "sample-1", isDeleted: true }],
        }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.db.sample.delete).toHaveBeenCalledWith({
      where: { id: "sample-1" },
    });
  });

  it("returns 500 on POST db failure", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockRejectedValue(new Error("DB error"));

    const response = await POST(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples", {
        method: "POST",
        body: JSON.stringify({ samples: [] }),
      }),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to save samples",
    });
  });
});

describe("GET /api/orders/[id]/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.orderFormConfig.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
  });

  it("returns 401 when no session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples"),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when order not found", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/missing/samples"),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 for non-owner non-admin", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-2", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      userId: "user-1",
      sampleset: null,
    });

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples"),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(403);
  });

  it("returns samples with parsed JSON fields", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      userId: "user-1",
      sampleset: {
        checklists: JSON.stringify([{ name: "ENA default" }]),
        selectedFields: null,
      },
    });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "s1",
        sampleId: "SAMPLE-1",
        sampleAlias: null,
        sampleTitle: "Title",
        sampleDescription: null,
        scientificName: null,
        taxId: null,
        checklistData: JSON.stringify({ field1: "value1" }),
        checklistUnits: JSON.stringify({ field1: "kg" }),
        customFields: JSON.stringify({ custom1: "val" }),
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orders/order-1/samples"),
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.samples).toHaveLength(1);
    expect(data.samples[0].checklistData).toEqual({ field1: "value1" });
    expect(data.samples[0].checklistUnits).toEqual({ field1: "kg" });
    expect(data.samples[0].customFields).toEqual({ custom1: "val" });
    expect(data.checklist).toEqual({ name: "ENA default" });
  });
});
