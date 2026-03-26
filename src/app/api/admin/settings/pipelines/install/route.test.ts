import fs from "fs/promises";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  clearPackageCache: vi.fn(),
  clearRegistryCache: vi.fn(),
  installGitHubPipelineSnapshot: vi.fn(),
  fetch: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  clearPackageCache: mocks.clearPackageCache,
}));

vi.mock("@/lib/pipelines/registry", () => ({
  clearRegistryCache: mocks.clearRegistryCache,
}));

vi.mock("child_process", () => ({
  execFile: mocks.execFile,
}));

vi.mock("@/lib/pipelines/metaxpath-import", () => ({
  isValidGitRef: vi.fn(() => true),
  classifyCloneFailure: vi.fn(() => ({
    status: 500,
    error: "clone failed",
  })),
  installGitHubPipelineSnapshot: mocks.installGitHubPipelineSnapshot,
}));

import { POST } from "./route";

describe("POST /api/admin/settings/pipelines/install", () => {
  const originalFetch = global.fetch;
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-install-route-"));
    process.chdir(tempDir);
    global.fetch = mocks.fetch as typeof global.fetch;
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(null, "", "");
      }
    );
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    global.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("installs a registry package payload into pipelines/<id>", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        files: {
          "manifest.json": JSON.stringify({
            package: { id: "mag" },
          }),
          "definition.json": "{}",
          "registry.json": "{}",
          "samplesheet.yaml": "samplesheet:\n",
        },
      }),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "mag",
          version: "3.0.0",
          source: {
            kind: "registry",
            sourceId: "registry:https://seqdesk.com/api/registry",
            label: "SeqDesk Registry",
            downloadUrl: "https://seqdesk.com/api/registry/pipelines/mag/3.0.0/download",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(
      fs.readFile(path.join(tempDir, "pipelines/mag/manifest.json"), "utf8")
    ).resolves.toContain('"id":"mag"');
  });

  it("sends bearer auth for private registry installs", async () => {
    mocks.fetch.mockImplementation(
      async (_url: string, init?: RequestInit) =>
        ({
          ok: true,
          json: async () => ({
            files: {
              "manifest.json": JSON.stringify({
                package: { id: "private-pipe" },
              }),
              "definition.json": "{}",
              "registry.json": "{}",
              "samplesheet.yaml": "samplesheet:\n",
            },
          }),
          headers: init?.headers,
        }) as never
    );

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "private-pipe",
          source: {
            kind: "privateRegistry",
            sourceId: "registry:https://seqdesk.com/api/registry",
            label: "SeqDesk Registry",
            packageUrlDefault: "https://seqdesk.com/api/private/private-pipe",
          },
          credentials: {
            accessKey: "secret-token",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://seqdesk.com/api/private/private-pipe",
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    const [, init] = mocks.fetch.mock.calls[0];
    expect((init.headers as Headers).get("authorization")).toBe("Bearer secret-token");
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipelineId: "mag" }),
      })
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { role: "RESEARCHER" },
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipelineId: "mag" }),
      })
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 when pipelineId is missing", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Pipeline ID required");
  });

  it("returns 400 when private registry install lacks credentials", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "custom",
          source: {
            kind: "privateRegistry",
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("access key");
  });

  it("returns 400 when registry install has no download URL", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "custom",
          source: {
            kind: "registry",
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("download URL");
  });

  it("returns 500 when fetch for registry payload fails", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "custom",
          source: {
            kind: "registry",
            downloadUrl: "https://example.com/download",
          },
        }),
      })
    );

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toContain("Failed to install pipeline");
  });

  it("returns 500 when fetch returns invalid JSON", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "custom",
          source: {
            kind: "registry",
            downloadUrl: "https://example.com/download",
          },
        }),
      })
    );

    expect(response.status).toBe(500);
  });

  it("rewrites legacy metaxpath github source details before installing", async () => {
    mocks.installGitHubPipelineSnapshot.mockResolvedValue({
      action: "install",
      manifest: {
        package: {
          version: "0.1.0",
        },
      },
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "metaxpath",
          source: {
            kind: "github",
            sourceId: "github:hzi-bifo/MetaxPath",
            label: "GitHub",
            repository: "hzi-bifo/MetaxPath",
            refDefault: "Nextflow",
            descriptorPath: ".seqdesk/pipelines/metaxpath",
            includeWorkflow: true,
          },
          credentials: {
            token: "gh-token",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.installGitHubPipelineSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "metaxpath",
        repo: "hzi-bifo/MetaxPath-Nextflow",
        ref: "main",
        descriptorPath: ".seqdesk/pipelines/metaxpath",
        includeWorkflow: true,
      })
    );
  });
});
