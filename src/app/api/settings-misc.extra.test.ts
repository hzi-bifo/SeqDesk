import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getExecutionSettings: vi.fn(),
  saveExecutionSettings: vi.fn(),
  getPipelineDag: vi.fn(),
  getPipelineDefinition: vi.fn(),
  validatePipelineMetadata: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  DEFAULT_EXECUTION_SETTINGS: {
    useSlurm: false,
    slurmQueue: "",
    slurmCores: 4,
    slurmMemory: "8G",
    slurmTimeLimit: 60,
    slurmOptions: "",
    condaPath: "/opt/conda",
    condaEnv: "base",
    nextflowProfile: "standard",
    pipelineRunDir: "/tmp/seqdesk-runs",
    weblogUrl: "",
    weblogSecret: "",
  },
  getExecutionSettings: mocks.getExecutionSettings,
  saveExecutionSettings: mocks.saveExecutionSettings,
}));

vi.mock("@/lib/pipelines/definitions", () => ({
  getPipelineDag: mocks.getPipelineDag,
  getPipelineDefinition: mocks.getPipelineDefinition,
}));

vi.mock("@/lib/pipelines/metadata-validation", () => ({
  validatePipelineMetadata: mocks.validatePipelineMetadata,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { POST as testSequencingPath } from "./admin/settings/sequencing-files/test/route";
import { GET as getFieldTemplates } from "./admin/field-templates/route";
import { GET as getExecutionSettingsRoute, POST as postExecutionSettingsRoute } from "./admin/settings/pipelines/execution/route";
import { GET as getPipelineDefinitionPublic } from "./pipelines/definitions/[id]/route";
import { GET as getAdminUsers } from "./admin/users/route";
import { GET as getEnaSettings, PUT as putEnaSettings } from "./admin/settings/ena/route";
import { POST as validateMetadata } from "./pipelines/validate-metadata/route";

let cwd = "";
let tempDir = "";

describe("settings and misc route quick wins", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    cwd = process.cwd();
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "seqdesk-settings-routes-"));
    process.chdir(tempDir);

    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.getExecutionSettings.mockResolvedValue({
      useSlurm: false,
      slurmQueue: "cpu",
      slurmCores: 8,
      slurmMemory: "16G",
      slurmTimeLimit: 120,
      slurmOptions: "--qos normal",
      condaPath: "/opt/conda",
      condaEnv: "seqdesk",
      nextflowProfile: "docker",
      pipelineRunDir: "/runs",
      weblogUrl: "https://weblog.example",
      weblogSecret: "secret",
    });
    mocks.saveExecutionSettings.mockResolvedValue(undefined);
    mocks.getPipelineDefinition.mockReturnValue({
      pipeline: "fastqc",
      name: "FastQC",
      description: "Quality control",
      version: "1.0.0",
      url: "https://example.test/fastqc",
    });
    mocks.getPipelineDag.mockReturnValue({
      nodes: [{ id: "start" }],
      edges: [{ id: "edge-1" }],
    });
    mocks.validatePipelineMetadata.mockResolvedValue({
      valid: true,
      errors: [],
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-12345",
      enaPassword: "super-secret",
      enaTestMode: false,
    });
    mocks.db.siteSettings.upsert.mockResolvedValue(undefined);
    mocks.db.user.findMany.mockResolvedValue([
      {
        id: "user-1",
        role: "RESEARCHER",
        department: { id: "dep-1" },
        _count: { orders: 2, studies: 1 },
      },
    ]);
  });

  afterEach(async () => {
    process.chdir(cwd);
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  it("tests sequencing file paths with real directories and validation branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await testSequencingPath(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ basePath: "/tmp" }),
      }) as never
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const missingPath = await testSequencingPath(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(await missingPath.json()).toEqual({
      valid: false,
      error: "No path provided",
    });

    const missingDir = await testSequencingPath(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ basePath: path.join(tempDir, "missing") }),
      }) as never
    );
    expect(await missingDir.json()).toEqual({
      valid: false,
      error: "Directory does not exist or is not accessible",
    });

    const filePath = path.join(tempDir, "plain-file.txt");
    await fsPromises.writeFile(filePath, "hello", "utf8");
    const notDir = await testSequencingPath(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ basePath: filePath }),
      }) as never
    );
    expect(await notDir.json()).toEqual({
      valid: false,
      error: "Path exists but is not a directory",
    });

    const readsDir = path.join(tempDir, "reads");
    await fsPromises.mkdir(readsDir);
    await fsPromises.writeFile(path.join(readsDir, "sample_R1.fastq.gz"), "a");
    await fsPromises.writeFile(path.join(readsDir, "sample_R2.fq.gz"), "b");
    await fsPromises.writeFile(path.join(readsDir, "notes.txt"), "c");

    const valid = await testSequencingPath(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ basePath: readsDir }),
      }) as never
    );
    expect(await valid.json()).toEqual({
      valid: true,
      resolvedPath: readsDir,
      totalFiles: 3,
      matchingFiles: 2,
      message: "Found 2 sequencing files (3 total files in root)",
    });

    const emptyDir = path.join(tempDir, "empty");
    await fsPromises.mkdir(emptyDir);
    const emptyResult = await testSequencingPath(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ basePath: emptyDir }),
      }) as never
    );
    expect(await emptyResult.json()).toEqual({
      valid: true,
      resolvedPath: emptyDir,
      totalFiles: 0,
      matchingFiles: 0,
      message: "Directory is empty",
    });
  });

  it("loads field templates from disk, sorts them, and skips invalid files", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getFieldTemplates();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const noDir = await getFieldTemplates();
    expect(noDir.status).toBe(200);
    expect(await noDir.json()).toEqual({
      templates: [],
      message: "No field templates directory found",
    });

    const templatesDir = path.join(tempDir, "data", "field-templates");
    await fsPromises.mkdir(templatesDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(templatesDir, "zeta.json"),
      JSON.stringify({ name: "Zeta", version: "1", description: "Z", fields: [] }),
      "utf8"
    );
    await fsPromises.writeFile(
      path.join(templatesDir, "alpha.json"),
      JSON.stringify({
        name: "Alpha",
        version: "1",
        description: "A",
        category: "core",
        fields: [],
      }),
      "utf8"
    );
    await fsPromises.writeFile(path.join(templatesDir, "broken.json"), "{bad", "utf8");

    const success = await getFieldTemplates();
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      templates: [
        { name: "Zeta", version: "1", description: "Z", fields: [] },
        { name: "Alpha", version: "1", description: "A", category: "core", fields: [] },
      ],
    });

    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementationOnce(() => {
      throw new Error("fs broken");
    });
    const failed = await getFieldTemplates();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to load field templates",
    });
    existsSpy.mockRestore();
  });

  it("gets and saves execution settings with normalization and auth handling", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedGet = await getExecutionSettingsRoute();
    expect(unauthorizedGet.status).toBe(403);
    expect(await unauthorizedGet.json()).toEqual({ error: "Unauthorized" });

    const successGet = await getExecutionSettingsRoute();
    expect(successGet.status).toBe(200);
    expect(await successGet.json()).toEqual({
      settings: {
        useSlurm: false,
        slurmQueue: "cpu",
        slurmCores: 8,
        slurmMemory: "16G",
        slurmTimeLimit: 120,
        slurmOptions: "--qos normal",
        condaPath: "/opt/conda",
        condaEnv: "seqdesk",
        nextflowProfile: "docker",
        pipelineRunDir: "/runs",
        weblogUrl: "https://weblog.example",
        weblogSecret: "secret",
      },
    });

    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedPost = await postExecutionSettingsRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(unauthorizedPost.status).toBe(403);
    expect(await unauthorizedPost.json()).toEqual({ error: "Unauthorized" });

    const successPost = await postExecutionSettingsRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          useSlurm: true,
          slurmQueue: "  gpu ",
          slurmCores: 16,
          slurmMemory: " 64G ",
          slurmTimeLimit: 180,
          slurmOptions: " --qos high ",
          condaPath: " /custom/conda ",
          condaEnv: " prod ",
          nextflowProfile: " slurm ",
          pipelineRunDir: "/",
          weblogUrl: " https://weblog.custom ",
          weblogSecret: " token ",
        }),
      }) as never
    );
    expect(successPost.status).toBe(200);
    expect(mocks.saveExecutionSettings).toHaveBeenCalledWith({
      useSlurm: true,
      slurmQueue: "gpu",
      slurmCores: 16,
      slurmMemory: "64G",
      slurmTimeLimit: 180,
      slurmOptions: "--qos high",
      runtimeMode: "conda",
      condaPath: "/custom/conda",
      condaEnv: "prod",
      nextflowProfile: "slurm",
      pipelineRunDir: "/tmp/seqdesk-runs",
      weblogUrl: "https://weblog.custom",
      weblogSecret: "token",
    });

    mocks.saveExecutionSettings.mockRejectedValueOnce(new Error("save failed"));
    const failed = await postExecutionSettingsRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to update execution settings",
    });
  });

  it("serves public pipeline definitions and validates metadata payloads", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedDef = await getPipelineDefinitionPublic(
      new Request("http://localhost") as never,
      { params: Promise.resolve({ id: "fastqc" }) }
    );
    expect(unauthorizedDef.status).toBe(401);
    expect(await unauthorizedDef.json()).toEqual({ error: "Unauthorized" });

    mocks.getPipelineDefinition.mockReturnValueOnce(null);
    const missingDef = await getPipelineDefinitionPublic(
      new Request("http://localhost") as never,
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(missingDef.status).toBe(404);
    expect(await missingDef.json()).toEqual({ error: "Pipeline definition not found" });

    const successDef = await getPipelineDefinitionPublic(
      new Request("http://localhost") as never,
      { params: Promise.resolve({ id: "fastqc" }) }
    );
    expect(successDef.status).toBe(200);
    expect(await successDef.json()).toEqual({
      definition: {
        id: "fastqc",
        name: "FastQC",
        description: "Quality control",
        version: "1.0.0",
        url: "https://example.test/fastqc",
      },
      nodes: [{ id: "start" }],
      edges: [{ id: "edge-1" }],
    });

    mocks.getPipelineDag.mockImplementationOnce(() => {
      throw new Error("dag broken");
    });
    const failedDef = await getPipelineDefinitionPublic(
      new Request("http://localhost") as never,
      { params: Promise.resolve({ id: "fastqc" }) }
    );
    expect(failedDef.status).toBe(500);
    expect(await failedDef.json()).toEqual({
      error: "Failed to load pipeline definition",
    });

    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedValidate = await validateMetadata(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(unauthorizedValidate.status).toBe(401);
    expect(await unauthorizedValidate.json()).toEqual({ error: "Unauthorized" });

    const invalidEntity = await validateMetadata(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ pipelineId: "fastqc" }),
      }) as never
    );
    expect(invalidEntity.status).toBe(400);
    expect(await invalidEntity.json()).toEqual({
      error: "pipelineId and exactly one of studyId or orderId are required",
    });

    const invalidSampleIds = await validateMetadata(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          orderId: "order-1",
          pipelineId: "fastqc",
          sampleIds: ["sample-1", 2],
        }),
      }) as never
    );
    expect(invalidSampleIds.status).toBe(400);
    expect(await invalidSampleIds.json()).toEqual({
      error: "sampleIds must be an array of strings",
    });

    const successValidate = await validateMetadata(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          orderId: "order-1",
          pipelineId: "fastqc",
          sampleIds: ["sample-1", "sample-2"],
        }),
      }) as never
    );
    expect(successValidate.status).toBe(200);
    expect(mocks.validatePipelineMetadata).toHaveBeenCalledWith(
      { type: "order", orderId: "order-1", sampleIds: ["sample-1", "sample-2"] },
      "fastqc"
    );
    expect(await successValidate.json()).toEqual({
      valid: true,
      errors: [],
    });

    mocks.validatePipelineMetadata.mockRejectedValueOnce(new Error("validation crashed"));
    const failedValidate = await validateMetadata(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          studyId: "study-1",
          pipelineId: "fastqc",
        }),
      }) as never
    );
    expect(failedValidate.status).toBe(500);
    expect(await failedValidate.json()).toEqual({
      error: "Failed to validate metadata",
    });
  });

  it("lists admin users and reads/writes ENA settings", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedUsers = await getAdminUsers(
      new Request("http://localhost/api/admin/users") as never
    );
    expect(unauthorizedUsers.status).toBe(401);
    expect(await unauthorizedUsers.json()).toEqual({ error: "Unauthorized" });

    const defaultUsers = await getAdminUsers(
      new Request("http://localhost/api/admin/users") as never
    );
    expect(defaultUsers.status).toBe(200);
    expect(mocks.db.user.findMany).toHaveBeenCalledWith({
      where: { role: "RESEARCHER" },
      orderBy: { createdAt: "desc" },
      include: {
        department: true,
        _count: {
          select: {
            orders: true,
            studies: true,
          },
        },
      },
    });
    expect(await defaultUsers.json()).toEqual([
      {
        id: "user-1",
        role: "RESEARCHER",
        department: { id: "dep-1" },
        _count: { orders: 2, studies: 1 },
      },
    ]);

    await getAdminUsers(
      new Request("http://localhost/api/admin/users?role=FACILITY_ADMIN") as never
    );
    expect(mocks.db.user.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { role: "FACILITY_ADMIN" },
      })
    );

    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedEnaGet = await getEnaSettings();
    expect(unauthorizedEnaGet.status).toBe(401);
    expect(await unauthorizedEnaGet.json()).toEqual({ error: "Unauthorized" });

    const successEnaGet = await getEnaSettings();
    expect(successEnaGet.status).toBe(200);
    expect(await successEnaGet.json()).toEqual({
      enaUsername: "Webin-12345",
      hasPassword: true,
      enaTestMode: false,
      configured: true,
    });

    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedEnaPut = await putEnaSettings(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({}),
      })
    );
    expect(unauthorizedEnaPut.status).toBe(401);
    expect(await unauthorizedEnaPut.json()).toEqual({ error: "Unauthorized" });

    const invalidEnaPut = await putEnaSettings(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          enaUsername: "bad-user",
        }),
      })
    );
    expect(invalidEnaPut.status).toBe(400);
    expect(await invalidEnaPut.json()).toEqual({
      error: "ENA username must be in format 'Webin-XXXXX' (e.g., Webin-12345)",
    });

    const successEnaPut = await putEnaSettings(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          enaUsername: " Webin-54321 ",
          enaPassword: " secret ",
          enaTestMode: true,
        }),
      })
    );
    expect(successEnaPut.status).toBe(200);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      update: {
        enaUsername: "Webin-54321",
        enaPassword: "secret",
        enaTestMode: true,
      },
      create: {
        id: "singleton",
        enaUsername: "Webin-54321",
        enaPassword: "secret",
        enaTestMode: true,
      },
    });
    expect(await successEnaPut.json()).toEqual({ success: true });

    mocks.db.siteSettings.upsert.mockRejectedValueOnce(new Error("db down"));
    const failedEnaPut = await putEnaSettings(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({}),
      })
    );
    expect(failedEnaPut.status).toBe(500);
    expect(await failedEnaPut.json()).toEqual({
      error: "Failed to update ENA settings",
    });
  });
});
