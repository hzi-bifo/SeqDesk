import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getWorkbenchImporter: vi.fn(),
  provider: {
    inputSchema: { parse: vi.fn((value) => value) },
    preflight: vi.fn(),
    preview: vi.fn(),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workbench/importers/registry", () => ({
  getWorkbenchImporter: mocks.getWorkbenchImporter,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/workbench/importers/mock/preview", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/workbench/importers/[providerId]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getWorkbenchImporter.mockReturnValue(mocks.provider);
    mocks.provider.inputSchema.parse.mockImplementation((value) => value);
    mocks.provider.preflight.mockResolvedValue({ ok: true });
    mocks.provider.preview.mockResolvedValue({
      providerId: "mock",
      summary: { selectedCount: 1 },
      genomes: [{ accession: "GCF_1" }],
    });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(request({ taxon: "E. coli" }), {
      params: Promise.resolve({ providerId: "mock" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects unknown providers", async () => {
    mocks.getWorkbenchImporter.mockReturnValue(null);

    const response = await POST(request({ taxon: "E. coli" }), {
      params: Promise.resolve({ providerId: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Workbench importer not found" });
  });

  it("surfaces provider preflight failures", async () => {
    mocks.provider.preflight.mockResolvedValue({
      ok: false,
      message: "NCBI Datasets CLI is not installed",
      details: "Install datasets",
    });

    const response = await POST(request({ taxon: "E. coli" }), {
      params: Promise.resolve({ providerId: "mock" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "NCBI Datasets CLI is not installed",
      details: "Install datasets",
    });
  });

  it("validates input and returns provider preview metadata", async () => {
    const response = await POST(request({ taxon: "E. coli" }), {
      params: Promise.resolve({ providerId: "mock" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.provider.preview).toHaveBeenCalledWith({ taxon: "E. coli" });
    expect(await response.json()).toEqual({
      preview: {
        providerId: "mock",
        summary: { selectedCount: 1 },
        genomes: [{ accession: "GCF_1" }],
      },
    });
  });
});
