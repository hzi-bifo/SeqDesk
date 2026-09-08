import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireRawReadImporter: vi.fn(),
  getServerSession: vi.fn(),
  getWorkbenchImporter: vi.fn(),
  createWorkbenchImportJob: vi.fn(),
  runWorkbenchImportJob: vi.fn(),
  resolveWorkbenchStorageBase: vi.fn(),
  listWorkbenchImportJobs: vi.fn(),
  provider: {
    inputSchema: { parse: vi.fn((value) => value) },
    preflight: vi.fn(),
    preview: vi.fn(),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));
vi.mock("@/lib/modules/input-modules.server", () => ({ requireRawReadImporter: mocks.requireRawReadImporter }));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/workbench/importers/registry", () => ({
  getWorkbenchImporter: mocks.getWorkbenchImporter,
}));

vi.mock("@/lib/workbench/import-jobs", () => ({
  createWorkbenchImportJob: mocks.createWorkbenchImportJob,
  runWorkbenchImportJob: mocks.runWorkbenchImportJob,
}));

vi.mock("@/lib/workbench/storage", () => ({
  resolveWorkbenchStorageBase: mocks.resolveWorkbenchStorageBase,
}));

vi.mock("@/lib/workbench/workspaces", () => ({
  listWorkbenchImportJobs: mocks.listWorkbenchImportJobs,
}));

import { GET, POST } from "./route";
import { importPreviewFingerprint } from "@/lib/workbench/import-preview-fingerprint";
import { ImportSelectionConflict } from "@/lib/workbench/import-conflict";
const namedInput = { taxon: "E. coli", collection: { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Public controls" } };

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/workbench/imports", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("/api/workbench/imports", () => {
  it("blocks disabled input modules before provider calls or job creation", async () => {
    mocks.requireRawReadImporter.mockRejectedValueOnce(new Error("Disabled"));
    const response = await POST(postRequest({ providerId: "mock", input: {} }));
    expect(response.status).toBe(403);
    expect(mocks.provider.preflight).not.toHaveBeenCalled();
    expect(mocks.createWorkbenchImportJob).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SEQDESK_DEPLOYMENT_PROFILE = "research-workbench";
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1", role: "RESEARCHER" } });
    mocks.getWorkbenchImporter.mockReturnValue(mocks.provider);
    mocks.provider.inputSchema.parse.mockImplementation((value) => value);
    mocks.provider.preflight.mockResolvedValue({ ok: true });
    mocks.provider.preview.mockResolvedValue({
      providerId: "mock",
      summary: { selectedCount: 1 },
      genomes: [{ accession: "GCF_1" }],
    });
    mocks.resolveWorkbenchStorageBase.mockResolvedValue({
      baseDir: "/data/workbench",
      cacheRoot: "/data/workbench/cache",
      jobsRoot: "/data/workbench/jobs",
    });
    mocks.createWorkbenchImportJob.mockResolvedValue({
      job: { id: "job-1", status: "queued" },
    });
    mocks.runWorkbenchImportJob.mockResolvedValue(undefined);
    mocks.listWorkbenchImportJobs.mockResolvedValue([{ id: "job-1" }]);
  });

  it("rejects unauthenticated list and start requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const list = await GET(new NextRequest("http://localhost/api/workbench/imports"));
    const start = await POST(postRequest({ providerId: "mock", input: { taxon: "E. coli" } }));

    expect(list.status).toBe(401);
    expect(start.status).toBe(401);
  });

  it("lists jobs for the current user's private workbench workspace", async () => {
    const response = await GET(new NextRequest("http://localhost/api/workbench/imports"));

    expect(response.status).toBe(200);
    expect(mocks.listWorkbenchImportJobs).toHaveBeenCalledWith("user-1");
    expect(await response.json()).toEqual({ jobs: [{ id: "job-1" }] });
  });

  it("rejects unknown providers", async () => {
    mocks.getWorkbenchImporter.mockReturnValue(null);

    const response = await POST(
      postRequest({ providerId: "missing", input: { taxon: "E. coli" } })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Workbench importer not found" });
  });

  it("surfaces missing provider prerequisites before creating jobs", async () => {
    mocks.provider.preflight.mockResolvedValue({
      ok: false,
      message: "NCBI Datasets CLI is not installed",
      details: "Install datasets",
    });

    const response = await POST(
      postRequest({ providerId: "mock", input: { taxon: "E. coli" } })
    );

    expect(response.status).toBe(400);
    expect(mocks.createWorkbenchImportJob).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: "NCBI Datasets CLI is not installed",
      details: "Install datasets",
    });
  });

  it("surfaces unconfigured Workbench storage as a setup error", async () => {
    mocks.resolveWorkbenchStorageBase.mockRejectedValue(
      new Error("Data base path is not configured.")
    );

    const response = await POST(
      postRequest({ providerId: "mock", input: { taxon: "E. coli" } })
    );

    expect(response.status).toBe(400);
    expect(mocks.createWorkbenchImportJob).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: "Data base path is not configured.",
    });
  });

  it("creates and starts a tracked import job from a bounded preview", async () => {
    const response = await POST(
      postRequest({ providerId: "mock", input: namedInput,
        previewFingerprint: importPreviewFingerprint("mock", namedInput, {
          providerId: "mock", summary: { selectedCount: 1 }, genomes: [{ accession: "GCF_1" }],
        }),
      })
    );

    expect(response.status).toBe(202);
    expect(mocks.provider.preview).toHaveBeenCalledWith(namedInput);
    expect(mocks.createWorkbenchImportJob).toHaveBeenCalledWith({
      userId: "user-1",
      providerId: "mock",
      input: namedInput,
      preview: {
        providerId: "mock",
        summary: { selectedCount: 1 },
        genomes: [{ accession: "GCF_1" }],
      },
    });
    expect(mocks.runWorkbenchImportJob).toHaveBeenCalledWith("job-1");
    expect(await response.json()).toEqual({
      success: true,
      collectionOrderId: expect.stringMatching(/^imported-data-/),
      started: true,
      job: { id: "job-1", status: "queued" },
    });
  });

  it.each([undefined, "outdated"])("requires a matching reviewed manifest (%s)", async (previewFingerprint) => {
    const response = await POST(postRequest({ providerId: "mock", input: namedInput, previewFingerprint }));
    expect(response.status).toBe(409);
    expect(mocks.createWorkbenchImportJob).not.toHaveBeenCalled();
  });
  it.each([undefined, { key: namedInput.collection.key, name: " " }, { key: "another-user", name: "Controls" }])("requires a valid named collection before previewing or queuing (%j)", async collection => {
    const response = await POST(postRequest({ providerId: "mock", input: { taxon: "E. coli", collection } }));
    expect(response.status).toBe(400);
    expect(mocks.provider.preview).not.toHaveBeenCalled();
    expect(mocks.createWorkbenchImportJob).not.toHaveBeenCalled();
  });
  it("binds the reviewed preview to its named destination", async () => {
    const response = await POST(postRequest({ providerId: "mock", input: { ...namedInput, collection: { ...namedInput.collection, name: "Changed" } },
      previewFingerprint: importPreviewFingerprint("mock", namedInput, { providerId: "mock", summary: { selectedCount: 1 }, genomes: [{ accession: "GCF_1" }] }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.createWorkbenchImportJob).not.toHaveBeenCalled();
  });
  it("reports an already-imported or queued selection as a conflict", async () => {
    mocks.createWorkbenchImportJob.mockRejectedValueOnce(new ImportSelectionConflict("Already queued"));
    const response = await POST(postRequest({ providerId: "mock", input: namedInput,
      previewFingerprint: importPreviewFingerprint("mock", namedInput, { providerId: "mock", summary: { selectedCount: 1 }, genomes: [{ accession: "GCF_1" }] }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.runWorkbenchImportJob).not.toHaveBeenCalled();
  });
});
