import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  assignOrderSequencingReads: vi.fn(),
  db: {
    read: {
      findFirst: vi.fn(),
      update: vi.fn(),
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

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/sequencing/workspace", () => ({
  assignOrderSequencingReads: mocks.assignOrderSequencingReads,
}));

import { PUT, PATCH } from "./route";

function makeRequest(method: string, body: unknown) {
  return new Request("http://localhost:3000/api/orders/order-1/sequencing/reads", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeContext = { params: Promise.resolve({ id: "order-1" }) };

describe("PUT /api/orders/[id]/sequencing/reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await PUT(
      makeRequest("PUT", { assignments: [] }),
      routeContext,
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await PUT(
      makeRequest("PUT", { assignments: [] }),
      routeContext,
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 when assignments is not an array", async () => {
    const response = await PUT(
      makeRequest("PUT", { assignments: "invalid" }),
      routeContext,
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/invalid/i);
  });

  it("assigns reads successfully", async () => {
    const assignments = [
      { sampleId: "s1", read1: "/path/r1.fq", read2: "/path/r2.fq" },
    ];
    mocks.assignOrderSequencingReads.mockResolvedValue([
      { sampleId: "s1", success: true },
    ]);

    const response = await PUT(
      makeRequest("PUT", { assignments }),
      routeContext,
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.results).toHaveLength(1);
    expect(mocks.assignOrderSequencingReads).toHaveBeenCalledWith("order-1", assignments);
  });

  it("returns 404 when order is not found", async () => {
    mocks.assignOrderSequencingReads.mockRejectedValue(new Error("Order not found"));

    const response = await PUT(
      makeRequest("PUT", { assignments: [{ sampleId: "s1", read1: null, read2: null }] }),
      routeContext,
    );

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/orders/[id]/sequencing/reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.isDemoSession.mockReturnValue(false);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest("PATCH", { sampleId: "s1", clearFields: ["checksum1"] }),
      routeContext,
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when clearFields is missing", async () => {
    const response = await PATCH(
      makeRequest("PATCH", { sampleId: "s1" }),
      routeContext,
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid field names", async () => {
    const response = await PATCH(
      makeRequest("PATCH", { sampleId: "s1", clearFields: ["badField"] }),
      routeContext,
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/invalid/i);
  });

  it("returns 404 when read record is not found", async () => {
    mocks.db.read.findFirst.mockResolvedValue(null);

    const response = await PATCH(
      makeRequest("PATCH", { sampleId: "s1", clearFields: ["checksum1"] }),
      routeContext,
    );

    expect(response.status).toBe(404);
  });

  it("clears specified fields successfully", async () => {
    mocks.db.read.findFirst.mockResolvedValue({ id: "read-1" });
    mocks.db.read.update.mockResolvedValue({ id: "read-1" });

    const response = await PATCH(
      makeRequest("PATCH", { sampleId: "s1", clearFields: ["checksum1", "readCount1"] }),
      routeContext,
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(mocks.db.read.update).toHaveBeenCalledWith({
      where: { id: "read-1" },
      data: { checksum1: null, readCount1: null },
    });
  });
});
