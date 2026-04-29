import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getPackage: vi.fn(),
  lintPipelineDescriptor: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackage: mocks.getPackage,
}));

vi.mock("@/lib/pipelines/descriptor-linter", () => ({
  lintPipelineDescriptor: mocks.lintPipelineDescriptor,
}));

import { GET } from "./route";

describe("GET /api/admin/settings/pipelines/[pipelineId]/lint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.getPackage.mockReturnValue({
      id: "metaxpath",
      basePath: "/repo/pipelines/metaxpath",
    });
    mocks.lintPipelineDescriptor.mockResolvedValue({
      packageId: "metaxpath",
      packageDir: "/repo/pipelines/metaxpath",
      valid: true,
      errors: 0,
      warnings: 0,
      issues: [],
    });
  });

  it("requires facility admin access", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/metaxpath/lint"),
      { params: Promise.resolve({ pipelineId: "metaxpath" }) }
    );

    expect(response.status).toBe(403);
  });

  it("returns 404 when package is not installed", async () => {
    mocks.getPackage.mockReturnValue(undefined);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/metaxpath/lint"),
      { params: Promise.resolve({ pipelineId: "metaxpath" }) }
    );

    expect(response.status).toBe(404);
  });

  it("lints the installed package directory", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/metaxpath/lint"),
      { params: Promise.resolve({ pipelineId: "metaxpath" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.lintPipelineDescriptor).toHaveBeenCalledWith(
      "/repo/pipelines/metaxpath",
      "metaxpath"
    );
    expect(payload.result.valid).toBe(true);
  });
});
