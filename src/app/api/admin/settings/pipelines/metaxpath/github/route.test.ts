import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    pipelineConfig: {
      upsert: vi.fn(),
    },
  },
  execFileAsync: vi.fn(),
  fsPromises: {
    mkdtemp: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    chmod: vi.fn(),
    access: vi.fn(),
    rm: vi.fn(),
    readdir: vi.fn(),
    copyFile: vi.fn(),
    cp: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
  },
  classifyCloneFailure: vi.fn(),
  validateMetaxPathDescriptorDir: vi.fn(),
  clearPackageCache: vi.fn(),
  clearRegistryCache: vi.fn(),
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

vi.mock("@/lib/pipelines/package-loader", () => ({
  clearPackageCache: mocks.clearPackageCache,
}));

vi.mock("@/lib/pipelines/registry", () => ({
  clearRegistryCache: mocks.clearRegistryCache,
}));

vi.mock("@/lib/pipelines/metaxpath-import", () => ({
  classifyCloneFailure: mocks.classifyCloneFailure,
  DEFAULT_METAXPATH_REF: "main",
  isValidGitRef: (ref: string) => {
    const trimmed = ref.trim();
    if (!trimmed || trimmed.startsWith("-") || trimmed.includes("..")) return false;
    return /^[A-Za-z0-9._/-]+$/.test(trimmed);
  },
  METAXPATH_DESCRIPTOR_RELATIVE_PATH: ".seqdesk",
  METAXPATH_PIPELINE_ID: "metaxpath",
  METAXPATH_REPO_HTTPS: "https://github.com/org/metaxpath.git",
  METAXPATH_REPOSITORY: "org/metaxpath",
  REQUIRED_DESCRIPTOR_FILES: ["manifest.json", "definition.json", "registry.json", "samplesheet.yaml"],
  shouldCopyWorkflowEntry: (name: string) => !name.startsWith("."),
  validateMetaxPathDescriptorDir: mocks.validateMetaxPathDescriptorDir,
}));

vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => {
    // promisify wraps execFile, so we intercept at the callback level
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      const result = mocks.execFileAsync(args[0], args[1], args[2]);
      result.then(
        (val: unknown) => cb(null, val),
        (err: unknown) => cb(err),
      );
    }
  },
}));

vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("util")>();
  return {
    ...actual,
    promisify: () => mocks.execFileAsync,
  };
});

vi.mock("fs/promises", () => ({
  default: mocks.fsPromises,
  ...mocks.fsPromises,
}));

import { POST } from "./route";

describe("POST /api/admin/settings/pipelines/metaxpath/github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    // Default: fs.access rejects (path does not exist)
    mocks.fsPromises.access.mockRejectedValue(new Error("ENOENT"));
    mocks.fsPromises.mkdtemp.mockResolvedValue("/tmp/seqdesk-metaxpath-abc");
    mocks.fsPromises.mkdir.mockResolvedValue(undefined);
    mocks.fsPromises.writeFile.mockResolvedValue(undefined);
    mocks.fsPromises.chmod.mockResolvedValue(undefined);
    mocks.fsPromises.rm.mockResolvedValue(undefined);
    mocks.fsPromises.readdir.mockResolvedValue([]);
    mocks.fsPromises.copyFile.mockResolvedValue(undefined);
    mocks.fsPromises.rename.mockResolvedValue(undefined);
    mocks.fsPromises.stat.mockResolvedValue({ isDirectory: () => true });
  });

  it("returns 403 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_test123", ref: "main" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("returns 403 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_test123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("returns 400 when token is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("token is required");
  });

  it("returns 400 when ref is invalid", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_test123", ref: "--evil" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Invalid Git reference");
  });

  it("returns 400 for invalid JSON body", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Invalid JSON");
  });

  it("returns classified error when git clone fails", async () => {
    mocks.execFileAsync.mockRejectedValueOnce(
      Object.assign(new Error("clone failed"), { stderr: "Authentication failed" }),
    );
    mocks.classifyCloneFailure.mockReturnValue({
      status: 401,
      error: "GitHub authentication failed. Verify the token and repository access.",
    });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_bad_token", ref: "main" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toContain("authentication failed");
  });

  it("returns 422 when descriptor validation fails", async () => {
    // Clone succeeds
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
    // Descriptor validation fails
    mocks.validateMetaxPathDescriptorDir.mockResolvedValue({
      valid: false,
      errors: ["manifest.json missing"],
    });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_test123", ref: "main" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error).toContain("validation failed");
    expect(json.details).toContain("manifest.json missing");
  });

  it("returns 500 when an unexpected error occurs during install", async () => {
    // Clone succeeds
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
    // Descriptor valid
    mocks.validateMetaxPathDescriptorDir.mockResolvedValue({ valid: true, errors: [] });
    // git rev-parse HEAD
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: "abc123\n", stderr: "" });
    // readdir throws error
    mocks.fsPromises.readdir.mockRejectedValue(new Error("EPERM: permission denied"));

    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_test123", ref: "main" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toContain("Failed to import MetaxPath");
  });

  it("uses default ref when ref is not provided", async () => {
    // Clone succeeds
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
    mocks.validateMetaxPathDescriptorDir.mockResolvedValue({ valid: true, errors: [] });
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: "def789\n", stderr: "" });
    mocks.fsPromises.readdir.mockResolvedValue([]);
    mocks.db.pipelineConfig.upsert.mockResolvedValue({});

    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_test123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ref).toBe("main");
  });

  it("extracts exec error details from stdout when stderr is absent", async () => {
    mocks.execFileAsync.mockRejectedValueOnce(
      Object.assign(new Error("clone failed"), { stdout: "Repository not found" }),
    );
    mocks.classifyCloneFailure.mockReturnValue({
      status: 404,
      error: "Repository not found",
    });

    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_test123", ref: "main" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.details).toBe("Repository not found");
  });

  it("succeeds on happy path", async () => {
    // Clone succeeds
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
    // Descriptor valid
    mocks.validateMetaxPathDescriptorDir.mockResolvedValue({ valid: true, errors: [] });
    // git rev-parse HEAD
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: "abc123def456\n", stderr: "" });
    // readdir for workflow copy
    mocks.fsPromises.readdir.mockResolvedValue([
      { name: "main.nf", isFile: () => true, isDirectory: () => false },
    ]);
    // db upsert
    mocks.db.pipelineConfig.upsert.mockResolvedValue({});

    const request = new NextRequest("http://localhost:3000/api/admin/settings/pipelines/metaxpath/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ghp_test123", ref: "v1.0.0" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.pipelineId).toBe("metaxpath");
    expect(json.ref).toBe("v1.0.0");
    expect(json.commit).toBe("abc123def456");
  });
});
