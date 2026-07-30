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
  pipelineConfigUpsert: vi.fn(),
  getManagedPipelineStatus: vi.fn(),
  updateManagedPipeline: vi.fn(),
  writePipelineInstallProvenanceToPackageDir: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    pipelineConfig: {
      upsert: mocks.pipelineConfigUpsert,
    },
  },
}));

vi.mock("@/lib/pipelines/pipeline-management-service", () => ({
  getManagedPipelineStatus: mocks.getManagedPipelineStatus,
  updateManagedPipeline: mocks.updateManagedPipeline,
}));

vi.mock("@/lib/pipelines/pipeline-install-provenance", () => ({
  writePipelineInstallProvenanceToPackageDir:
    mocks.writePipelineInstallProvenanceToPackageDir,
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
  PipelineDescriptorValidationError: class extends Error {},
  installGitHubPipelineSnapshot: mocks.installGitHubPipelineSnapshot,
}));

import { POST } from "./route";
import {
  PIPELINE_INSTALL_E2E_FAULT_ENV,
  PIPELINE_INSTALL_E2E_FAULT_FILE,
  PIPELINE_INSTALL_E2E_FAULT_PHASE,
  PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID,
} from "@/lib/pipelines/package-install";

function buildValidPackagePayload(id: string, version = "1.0.0") {
  return {
    files: {
      "manifest.json": JSON.stringify({
        manifestVersion: 1,
        package: {
          id,
          name: `${id} pipeline`,
          version,
          description: "Test pipeline package",
        },
        files: {
          definition: "definition.json",
          registry: "registry.json",
          samplesheet: "samplesheet.yaml",
        },
        inputs: [],
        execution: {
          type: "nextflow",
          pipeline: `nf-core/${id}`,
          version,
          profiles: ["conda"],
          defaultParams: {},
        },
        outputs: [],
      }),
      "definition.json": JSON.stringify({
        pipeline: id,
        name: `${id} pipeline`,
        description: "Test pipeline package",
        version,
        steps: [],
        inputs: [],
        outputs: [],
      }),
      "registry.json": JSON.stringify({
        id,
        name: `${id} pipeline`,
        description: "Test pipeline package",
        category: "analysis",
        version,
        requires: {},
        outputs: [],
        visibility: {
          showToUser: true,
          userCanStart: true,
        },
        input: {
          supportedScopes: ["study"],
          perSample: {
            reads: false,
            pairedEnd: false,
          },
        },
        samplesheet: {
          format: "csv",
          generator: "internal",
        },
        configSchema: {
          type: "object",
          properties: {},
        },
        defaultConfig: {},
        icon: "beaker",
      }),
      "samplesheet.yaml":
        "samplesheet:\n  format: csv\n  filename: samples.csv\n  rows:\n    scope: sample\n  columns:\n    - name: sample\n      source: sample.sampleId\n",
      "payload-version.txt": `${version}\n`,
    },
  };
}

describe("POST /api/admin/settings/pipelines/install", () => {
  const originalFetch = global.fetch;
  const originalCwd = process.cwd();
  const originalPipelinesDir = process.env.SEQDESK_PIPELINES_DIR;
  const originalStoreFaults = process.env[PIPELINE_INSTALL_E2E_FAULT_ENV];
  let tempDir = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-install-route-"));
    process.chdir(tempDir);
    delete process.env.SEQDESK_PIPELINES_DIR;
    delete process.env[PIPELINE_INSTALL_E2E_FAULT_ENV];
    global.fetch = mocks.fetch as typeof global.fetch;
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.pipelineConfigUpsert.mockResolvedValue({
      pipelineId: "test-pipeline",
      enabled: false,
    });
    mocks.getManagedPipelineStatus.mockImplementation(
      async (pipelineId: string) => ({
        id: pipelineId,
        pipelineId,
        packageState: "installed",
        setupState: "needs-runtime",
        activationState: "disabled",
        enabled: false,
        readiness: {
          status: "missing",
          summary: "Runtime setup required",
          canEnable: false,
          items: [],
        },
        nextActions: [],
      })
    );
    mocks.updateManagedPipeline.mockResolvedValue({
      success: true,
      pipelineId: "test-pipeline",
      enabled: true,
    });
    mocks.writePipelineInstallProvenanceToPackageDir.mockResolvedValue({
      schemaVersion: 1,
      pipelineId: "test-pipeline",
      version: "1.0.0",
      sourceId: "test",
      sourceKind: "registry",
      installedAt: "2026-07-30T00:00:00.000Z",
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
    if (originalPipelinesDir === undefined) {
      delete process.env.SEQDESK_PIPELINES_DIR;
    } else {
      process.env.SEQDESK_PIPELINES_DIR = originalPipelinesDir;
    }
    if (originalStoreFaults === undefined) {
      delete process.env[PIPELINE_INSTALL_E2E_FAULT_ENV];
    } else {
      process.env[PIPELINE_INSTALL_E2E_FAULT_ENV] = originalStoreFaults;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("installs a registry package payload into pipelines/<id>", async () => {
    const magPayload = buildValidPackagePayload("mag");
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => magPayload,
      text: async () => JSON.stringify(magPayload),
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
            sourceId: "registry:https://seqdesk.org/api/registry",
            label: "SeqDesk Registry",
            downloadUrl: "https://seqdesk.org/api/registry/pipelines/mag/3.0.0/download",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.pipelineConfigUpsert).toHaveBeenCalledWith({
      where: { pipelineId: "mag" },
      create: {
        pipelineId: "mag",
        enabled: false,
      },
      update: {
        enabled: false,
      },
    });
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        action: "install",
        enabled: false,
      })
    );
    await expect(
      fs.readFile(path.join(tempDir, "pipelines/mag/manifest.json"), "utf8")
    ).resolves.toContain('"id":"mag"');
  });

  it("rolls back a new package when its initial disabled state cannot be stored", async () => {
    const payload = buildValidPackagePayload("rollback-pipeline");
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    });
    mocks.pipelineConfigUpsert.mockRejectedValueOnce(new Error("database unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "rollback-pipeline",
          source: {
            kind: "registry",
            downloadUrl: "https://example.com/rollback-pipeline.json",
          },
        }),
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        details: expect.stringContaining("initial disabled state"),
      })
    );
    await expect(
      fs.stat(path.join(tempDir, "pipelines", "rollback-pipeline"))
    ).rejects.toMatchObject({ code: "ENOENT" });

    errorLog.mockRestore();
  });

  it("requires an explicit update before replacing an installed package", async () => {
    await fs.mkdir(path.join(tempDir, "pipelines", "mag"), {
      recursive: true,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "mag",
          replace: false,
          source: {
            kind: "registry",
            downloadUrl: "https://example.org/mag-package.json",
          },
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.details).toContain("Retry this action as an update");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("returns an offline idempotent no-op for an already bundled package", async () => {
    const pipelineDir = path.join(tempDir, "pipelines", "bundled-pipeline");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, "manifest.json"),
      JSON.stringify({
        package: {
          id: "bundled-pipeline",
          version: "1.0.0",
        },
      })
    );
    mocks.fetch.mockRejectedValue(new Error("registry offline"));

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "bundled-pipeline",
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        action: "noop",
        pipelineId: "bundled-pipeline",
        version: "1.0.0",
      })
    );
    expect(mocks.pipelineConfigUpsert).not.toHaveBeenCalled();
  });

  it("treats identical non-semver package versions as an idempotent no-op", async () => {
    const pipelineDir = path.join(tempDir, "pipelines", "named-release");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, "manifest.json"),
      JSON.stringify({
        package: {
          id: "named-release",
          version: "release-2026-07",
        },
      })
    );

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "named-release",
          version: "release-2026-07",
          source: {
            kind: "registry",
            sourceId: "test-registry",
            downloadUrl: "https://example.org/named-release.json",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        action: "noop",
        version: "release-2026-07",
      })
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reinstalls the selected package when replace is true at the same version", async () => {
    const pipelineDir = path.join(tempDir, "pipelines", "replace-same");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, "manifest.json"),
      JSON.stringify({
        package: {
          id: "replace-same",
          version: "1.0.0",
        },
      })
    );
    await fs.writeFile(path.join(pipelineDir, "old-marker.txt"), "old package");
    const payload = buildValidPackagePayload("replace-same", "1.0.0");
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "replace-same",
          version: "1.0.0",
          replace: true,
          source: {
            kind: "registry",
            sourceId: "test-registry",
            downloadUrl: "https://example.org/replace-same.json",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        action: "update",
        version: "1.0.0",
      })
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await expect(
      fs.stat(path.join(pipelineDir, "old-marker.txt"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.readFile(path.join(pipelineDir, "payload-version.txt"), "utf8")
    ).resolves.toBe("1.0.0\n");
  });

  it("does not let a delayed v2 update overwrite a concurrently installed v3", async () => {
    const pipelineId = "concurrent-update";
    const pipelineDir = path.join(tempDir, "pipelines", pipelineId);
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, "manifest.json"),
      JSON.stringify({
        package: {
          id: pipelineId,
          version: "1.0.0",
        },
      })
    );

    let signalV2FetchStarted: (() => void) | undefined;
    const v2FetchStarted = new Promise<void>((resolve) => {
      signalV2FetchStarted = resolve;
    });
    let releaseV2Fetch: (() => void) | undefined;
    const v2FetchGate = new Promise<void>((resolve) => {
      releaseV2Fetch = resolve;
    });
    mocks.fetch.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v2.json")) {
        signalV2FetchStarted?.();
        await v2FetchGate;
        const payload = buildValidPackagePayload(pipelineId, "2.0.0");
        return {
          ok: true,
          text: async () => JSON.stringify(payload),
        };
      }
      const payload = buildValidPackagePayload(pipelineId, "3.0.0");
      return {
        ok: true,
        text: async () => JSON.stringify(payload),
      };
    });

    const v2ResponsePromise = POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId,
          version: "2.0.0",
          source: {
            kind: "registry",
            sourceId: "test-registry",
            downloadUrl: "https://example.org/v2.json",
          },
        }),
      })
    );
    await v2FetchStarted;

    const v3Response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId,
          version: "3.0.0",
          source: {
            kind: "registry",
            sourceId: "test-registry",
            downloadUrl: "https://example.org/v3.json",
          },
        }),
      })
    );
    expect(v3Response.status).toBe(200);

    releaseV2Fetch?.();
    const v2Response = await v2ResponsePromise;
    expect(v2Response.status).toBe(409);
    await expect(v2Response.json()).resolves.toEqual(
      expect.objectContaining({
        details: expect.stringContaining(
          "Installed version 3.0.0 is not older than selected version 2.0.0"
        ),
      })
    );

    const installedManifest = JSON.parse(
      await fs.readFile(path.join(pipelineDir, "manifest.json"), "utf8")
    ) as { package: { version: string } };
    expect(installedManifest.package.version).toBe("3.0.0");
    await expect(
      fs.readFile(path.join(pipelineDir, "payload-version.txt"), "utf8")
    ).resolves.toBe("3.0.0\n");
  });

  it("updates automatically when the selected Store version is newer", async () => {
    const pipelineDir = path.join(tempDir, "pipelines", "auto-update");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, "manifest.json"),
      JSON.stringify({
        package: {
          id: "auto-update",
          version: "1.0.0",
        },
      })
    );
    const payload = buildValidPackagePayload("auto-update");
    const nextManifest = JSON.parse(
      payload.files["manifest.json"]
    ) as {
      package: { version: string };
      execution: { version: string };
    };
    nextManifest.package.version = "2.0.0";
    nextManifest.execution.version = "2.0.0";
    payload.files["manifest.json"] = JSON.stringify(nextManifest);
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "auto-update",
          version: "2.0.0",
          source: {
            kind: "registry",
            sourceId: "test-registry",
            downloadUrl: "https://example.org/auto-update.json",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        action: "update",
        version: "2.0.0",
      })
    );
  });

  it("preserves the activation state when updating an installed package", async () => {
    const pipelineDir = path.join(tempDir, "pipelines", "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "marker.txt"), "old package");
    const payload = buildValidPackagePayload("mag");
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "mag",
          replace: true,
          source: {
            kind: "registry",
            downloadUrl: "https://example.org/mag-package.json",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        action: "update",
      })
    );
    expect(mocks.pipelineConfigUpsert).not.toHaveBeenCalled();
    await expect(
      fs.stat(path.join(pipelineDir, "marker.txt"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("sends bearer auth for private registry installs", async () => {
    const privatePayload = buildValidPackagePayload("private-pipe");
    mocks.fetch.mockImplementation(
      async (_url: string, init?: RequestInit) =>
        ({
          ok: true,
          json: async () => privatePayload,
          text: async () => JSON.stringify(privatePayload),
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
            sourceId: "registry:https://seqdesk.org/api/registry",
            label: "SeqDesk Registry",
            packageUrlDefault: "https://seqdesk.org/api/private/private-pipe",
          },
          credentials: {
            accessKey: "secret-token",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://seqdesk.org/api/private/private-pipe",
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    const [, init] = mocks.fetch.mock.calls[0];
    expect((init.headers as Headers).get("authorization")).toBe("Bearer secret-token");
  });

  it("rejects a private package whose payload does not match the provided sha256", async () => {
    const payload = {
      files: {
        "manifest.json": JSON.stringify({ package: { id: "private-pipe" } }),
      },
    };
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "private-pipe",
          source: {
            kind: "privateRegistry",
            packageUrlDefault: "https://seqdesk.org/api/private/private-pipe",
          },
          credentials: {
            accessKey: "secret-token",
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
          },
        }),
      })
    );

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.details).toContain("checksum verification failed");
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

  it("returns 400 for invalid JSON instead of an internal server error", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON request body",
    });
  });

  it("rejects unsafe pipeline IDs before downloading a package", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "../outside",
          source: {
            kind: "registry",
            downloadUrl: "https://example.com/download",
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("installs registry packages into SEQDESK_PIPELINES_DIR", async () => {
    const pipelinesDir = path.join(tempDir, "shared-pipelines");
    process.env.SEQDESK_PIPELINES_DIR = pipelinesDir;
    const payload = buildValidPackagePayload("custom");
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
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

    expect(response.status).toBe(200);
    await expect(
      fs.stat(path.join(pipelinesDir, "custom", "manifest.json"))
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(tempDir, "pipelines", "custom", "manifest.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns 422 and preserves an installed package when the staged payload is invalid", async () => {
    const pipelineDir = path.join(tempDir, "pipelines", "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "marker.txt"), "existing");
    const invalidPayload = {
      files: {
        "manifest.json": JSON.stringify({
          package: { id: "mag" },
        }),
      },
    };
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(invalidPayload),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "mag",
          replace: true,
          source: {
            kind: "registry",
            downloadUrl: "https://example.com/download",
          },
        }),
      })
    );

    expect(response.status).toBe(422);
    expect(mocks.clearPackageCache).toHaveBeenCalledTimes(1);
    expect(mocks.clearRegistryCache).toHaveBeenCalledTimes(1);
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("existing");
  });

  it("keeps the old package when staged provenance cannot be written", async () => {
    const pipelineDir = path.join(tempDir, "pipelines", "mag");
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "marker.txt"), "existing");
    const payload = buildValidPackagePayload("mag");
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    });
    mocks.writePipelineInstallProvenanceToPackageDir.mockRejectedValueOnce(
      new Error("provenance disk error")
    );

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "mag",
          replace: true,
          version: "2.0.0",
          source: {
            kind: "registry",
            sourceId: "test-registry",
            downloadUrl: "https://example.com/download",
          },
        }),
      })
    );

    expect(response.status).toBe(500);
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("existing");
    expect(
      (await fs.readdir(path.dirname(pipelineDir))).filter(
        (entry) =>
          entry.startsWith("mag.__tmp-") ||
          entry.startsWith("mag.__backup-")
      )
    ).toEqual([]);
  });

  it("invalidates package caches after restoring an update that failed during activation", async () => {
    const pipelineDir = path.join(
      tempDir,
      "pipelines",
      PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID
    );
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(path.join(pipelineDir, "marker.txt"), "existing");
    const payload = buildValidPackagePayload(
      PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID
    ) as { files: Record<string, string> };
    payload.files[PIPELINE_INSTALL_E2E_FAULT_FILE] = JSON.stringify({
      pipelineId: PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID,
      phase: PIPELINE_INSTALL_E2E_FAULT_PHASE,
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    });
    process.env[PIPELINE_INSTALL_E2E_FAULT_ENV] = "1";

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID,
          replace: true,
          source: {
            kind: "registry",
            downloadUrl: "https://example.com/faulting-update.json",
          },
        }),
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        details: expect.stringContaining(PIPELINE_INSTALL_E2E_FAULT_PHASE),
      })
    );
    expect(mocks.clearPackageCache).toHaveBeenCalledTimes(1);
    expect(mocks.clearRegistryCache).toHaveBeenCalledTimes(1);
    await expect(
      fs.readFile(path.join(pipelineDir, "marker.txt"), "utf8")
    ).resolves.toBe("existing");
    expect(
      (await fs.readdir(path.dirname(pipelineDir))).filter(
        (entry) =>
          entry.startsWith(
            `${PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID}.__tmp-`
          ) ||
          entry.startsWith(
            `${PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID}.__backup-`
          )
      )
    ).toEqual([]);
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

  it("returns 400 when a GitHub install lacks a repository", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "custom",
          source: {
            kind: "github",
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.details).toContain("require a repository");
  });

  it("clones public GitHub repositories without requiring a token", async () => {
    mocks.installGitHubPipelineSnapshot.mockResolvedValue({
      action: "install",
      manifest: {
        package: {
          version: "1.0.0",
        },
      },
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "public-pipeline",
          source: {
            kind: "github",
            repository: "example/public-pipeline",
            refDefault: "main",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.execFile).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining([
        "clone",
        "https://github.com/example/public-pipeline.git",
      ]),
      expect.objectContaining({
        env: expect.not.objectContaining({
          GIT_ASKPASS: expect.anything(),
          GITHUB_TOKEN: expect.anything(),
        }),
        timeout: 120_000,
      }),
      expect.any(Function)
    );
  });

  it("returns 502 when the registry package download fails", async () => {
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

    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.error).toContain("Failed to install pipeline");
  });

  it("returns 422 when the registry returns invalid package JSON", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
      text: async () => "{ not valid json",
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

    expect(response.status).toBe(422);
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

  it("keeps a successful GitHub install successful when temp cleanup fails", async () => {
    mocks.installGitHubPipelineSnapshot.mockResolvedValue({
      action: "install",
      manifest: {
        package: {
          version: "1.0.0",
        },
      },
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remove = vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("busy"));

    const response = await POST(
      new NextRequest("http://localhost/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "public-pipeline",
          source: {
            kind: "github",
            repository: "example/public-pipeline",
            refDefault: "main",
          },
          credentials: {
            token: "gh-token",
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.clearPackageCache).toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();

    remove.mockRestore();
    warning.mockRestore();
  });

  it("rewrites legacy metaxpath refs for the maintained github source", async () => {
    mocks.installGitHubPipelineSnapshot.mockResolvedValue({
      action: "install",
      manifest: {
        package: {
          version: "0.1.5",
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
            sourceId: "github:hzi-bifo/MetaxPath-Nextflow",
            label: "GitHub",
            repository: "hzi-bifo/MetaxPath-Nextflow",
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
      })
    );
  });

  it("preserves legacy-named refs for custom metaxpath repositories", async () => {
    mocks.installGitHubPipelineSnapshot.mockResolvedValue({
      action: "install",
      manifest: {
        package: {
          version: "0.1.5",
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
            sourceId: "github:example/MetaxPathFork",
            label: "GitHub",
            repository: "example/MetaxPathFork",
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
        repo: "example/MetaxPathFork",
        ref: "Nextflow",
      })
    );
  });
});
