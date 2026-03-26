import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireFacilityAdminSequencingSession: vi.fn(),
  getSequencingFilesConfig: vi.fn(),
  browseSequencingStorageFiles: vi.fn(),
  db: {
    order: {
      findUnique: vi.fn(),
    },
    read: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/sequencing/server", () => ({
  requireFacilityAdminSequencingSession:
    mocks.requireFacilityAdminSequencingSession,
  SequencingApiError: class SequencingApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/files/sequencing-config", () => ({
  getSequencingFilesConfig: mocks.getSequencingFilesConfig,
}));

vi.mock("@/lib/sequencing/browse", () => ({
  browseSequencingStorageFiles: mocks.browseSequencingStorageFiles,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET } from "./route";
// Re-import the real SequencingApiError for throwing in tests
const { SequencingApiError } = await import("@/lib/sequencing/server");

describe("GET /api/orders/[id]/sequencing/browse", () => {
  const params = Promise.resolve({ id: "order-1" });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFacilityAdminSequencingSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.db.order.findUnique.mockResolvedValue({ id: "order-1" });
    mocks.getSequencingFilesConfig.mockResolvedValue({
      dataBasePath: "/data",
      config: { scanDepth: 3, ignorePatterns: [] },
    });
    mocks.browseSequencingStorageFiles.mockResolvedValue([]);
    mocks.db.read.findMany.mockResolvedValue([]);
  });

  it("returns 401 when session check throws", async () => {
    mocks.requireFacilityAdminSequencingSession.mockRejectedValue(
      new SequencingApiError(401, "Unauthorized")
    );

    const request = new NextRequest(
      "http://localhost:3000/api/orders/order-1/sequencing/browse"
    );
    const response = await GET(request, { params });
    expect(response.status).toBe(401);
  });

  it("returns files list for valid request", async () => {
    mocks.browseSequencingStorageFiles.mockResolvedValue([
      {
        relativePath: "sample1_R1.fastq.gz",
        name: "sample1_R1.fastq.gz",
        size: 1024,
        modifiedAt: new Date("2024-01-01"),
      },
    ]);

    const request = new NextRequest(
      "http://localhost:3000/api/orders/order-1/sequencing/browse"
    );
    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.files).toHaveLength(1);
    expect(data.files[0].name).toBe("sample1_R1.fastq.gz");
  });

  it("returns 404 when order not found", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);

    const request = new NextRequest(
      "http://localhost:3000/api/orders/nonexistent/sequencing/browse"
    );
    const response = await GET(request, { params });

    expect(response.status).toBe(404);
  });
});
