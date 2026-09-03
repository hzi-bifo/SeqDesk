import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  authorizeWorkbenchRequest: vi.fn(),
  storeWorkbenchUpload: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/workbench/server", () => ({
  authorizeWorkbenchRequest: mocks.authorizeWorkbenchRequest,
}));
vi.mock("@/lib/workbench/uploads", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/workbench/uploads")>();
  return { ...original, storeWorkbenchUpload: mocks.storeWorkbenchUpload };
});

import { POST } from "./route";

describe("POST /api/workbench/uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-a", role: "RESEARCHER" },
    });
    mocks.authorizeWorkbenchRequest.mockReturnValue({
      allowed: true,
      userId: "user-a",
    });
    mocks.storeWorkbenchUpload.mockResolvedValue({
      id: "dataset-a",
      name: "reads.fastq",
    });
  });

  it("returns the profile authorization response unchanged", async () => {
    mocks.authorizeWorkbenchRequest.mockReturnValue({
      allowed: false,
      response: NextResponse.json({ error: "Unavailable" }, { status: 404 }),
    });
    const response = await POST(
      new NextRequest("http://localhost/api/workbench/uploads", {
        method: "POST",
        body: "ACGT",
      })
    );
    expect(response.status).toBe(404);
    expect(mocks.storeWorkbenchUpload).not.toHaveBeenCalled();
  });

  it("passes the raw body and server-owned user id to streaming storage", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/workbench/uploads", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-seqdesk-filename": "reads.fastq.gz",
        },
        body: "ACGT",
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.storeWorkbenchUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-a",
        filename: "reads.fastq.gz",
        contentType: "application/octet-stream",
      })
    );
  });
});
