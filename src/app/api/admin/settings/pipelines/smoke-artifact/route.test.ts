import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  inspectSmokeArtifactZip: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/smoke-artifact", () => ({
  inspectSmokeArtifactZip: mocks.inspectSmokeArtifactZip,
}));

import { POST } from "./route";

function makeMultipartRequest(file?: File) {
  const formData = new FormData();
  if (file) {
    formData.append("artifact", file);
  }
  return new NextRequest(
    "http://localhost/api/admin/settings/pipelines/smoke-artifact",
    {
      method: "POST",
      body: formData,
    }
  );
}

describe("POST /api/admin/settings/pipelines/smoke-artifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.inspectSmokeArtifactZip.mockReturnValue({
      summary: {
        totalFiles: 2,
        publishedFiles: 1,
        ignoredWorkFiles: 1,
        suggestedOutputs: 1,
      },
      entries: [
        {
          path: "results/run_20260309/final/report.html",
          sizeBytes: 10,
          type: "report",
        },
      ],
      suggestions: [
        {
          id: "final-html-reports",
          label: "Combined HTML reports",
          pattern: "results/**/final/**/*.html",
          destination: "study_report",
          type: "report",
          count: 1,
        },
      ],
    });
  });

  it("requires facility admin access", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(403);
  });

  it("returns 400 when the artifact file is missing", async () => {
    const response = await POST(makeMultipartRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Smoke artifact ZIP file is required.",
    });
  });

  it("inspects an uploaded smoke artifact", async () => {
    const file = new File([Buffer.from("zip bytes")], "smoke.zip", {
      type: "application/zip",
    });

    const response = await POST(makeMultipartRequest(file));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.inspectSmokeArtifactZip).toHaveBeenCalledWith(
      Buffer.from("zip bytes")
    );
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        fileName: "smoke.zip",
        summary: expect.objectContaining({
          publishedFiles: 1,
        }),
      })
    );
  });

  it("returns parse errors as bad requests", async () => {
    mocks.inspectSmokeArtifactZip.mockImplementation(() => {
      throw new Error("Invalid ZIP file");
    });
    const file = new File([Buffer.from("bad")], "bad.zip", {
      type: "application/zip",
    });

    const response = await POST(makeMultipartRequest(file));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Failed to inspect smoke artifact");
    expect(payload.details).toBe("Invalid ZIP file");
  });
});
