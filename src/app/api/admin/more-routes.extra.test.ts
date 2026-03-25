import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getEffectiveConfig: vi.fn(),
  getPipelineDag: vi.fn(),
  getPipelineDefinition: vi.fn(),
  getPackageSamplesheet: vi.fn(),
  testSetting: vi.fn(),
  detectVersions: vi.fn(),
  getExecutionSettings: vi.fn(),
  db: {
    adminInvite: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/config", () => ({
  getEffectiveConfig: mocks.getEffectiveConfig,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/pipelines/definitions", () => ({
  getPipelineDag: mocks.getPipelineDag,
  getPipelineDefinition: mocks.getPipelineDefinition,
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackageSamplesheet: mocks.getPackageSamplesheet,
}));

vi.mock("@/lib/pipelines/prerequisite-check", () => ({
  testSetting: mocks.testSetting,
  detectVersions: mocks.detectVersions,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

import { GET as getConfigStatus } from "./config/status/route";
import { DELETE as deleteInvite } from "./invites/[id]/route";
import { POST as verifyInvite } from "./invites/verify/route";
import { GET as getPipelineDagRoute } from "./settings/pipelines/[pipelineId]/dag/route";
import { GET as getPipelineDefinitionRoute } from "./settings/pipelines/[pipelineId]/definition/route";
import { POST as postTestSetting, GET as getTestSettingVersions } from "./settings/pipelines/test-setting/route";

describe("small admin route quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.getEffectiveConfig.mockResolvedValue({
      config: {
        ena: { password: "secret" },
        runtime: {
          nextAuthSecret: "next-auth",
          anthropicApiKey: "anthropic",
          adminSecret: "admin",
          blobReadWriteToken: "blob",
        },
      },
      sources: { ena: "file", runtime: "env" },
      filePath: "/tmp/seqdesk.config.json",
      loadedAt: "2026-03-25T10:00:00.000Z",
    });
    mocks.db.adminInvite.findUnique.mockResolvedValue({
      id: "invite-1",
      code: "ABC123",
      email: "admin@example.test",
      usedAt: null,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    mocks.db.adminInvite.delete.mockResolvedValue(undefined);
    mocks.getPipelineDag.mockReturnValue({ nodes: [{ id: "start" }], edges: [] });
    mocks.getPipelineDefinition.mockReturnValue({
      pipeline: "fastqc",
      name: "FastQC",
      description: "QC",
      url: "https://example.test/fastqc",
      version: "1.0.0",
      minNextflowVersion: "24.10.0",
      authors: ["SeqDesk"],
      inputs: [{ name: "reads" }],
      outputs: [{ name: "report" }],
      steps: [{ id: "run" }, { id: "report" }],
      parameterGroups: [{ id: "general" }],
    });
    mocks.getPackageSamplesheet.mockReturnValue({
      samplesheet: { columns: ["sample", "fastq_1", "fastq_2"] },
    });
    mocks.testSetting.mockResolvedValue({ ok: true, message: "works" });
    mocks.detectVersions.mockResolvedValue({ nextflow: "24.10.5", java: "21.0.0" });
    mocks.getExecutionSettings.mockResolvedValue({
      condaPath: "/opt/conda",
      condaEnv: "seqdesk",
    });
  });

  it("masks sensitive config values and handles auth/errors", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getConfigStatus();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const success = await getConfigStatus();
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      config: {
        ena: { password: "********" },
        runtime: {
          nextAuthSecret: "********",
          anthropicApiKey: "********",
          adminSecret: "********",
          blobReadWriteToken: "********",
        },
      },
      sources: { ena: "file", runtime: "env" },
      filePath: "/tmp/seqdesk.config.json",
      loadedAt: "2026-03-25T10:00:00.000Z",
    });

    mocks.getEffectiveConfig.mockRejectedValueOnce(new Error("boom"));
    const failed = await getConfigStatus();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to load configuration",
    });
  });

  it("revokes invites and maps delete route failures", async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { role: "USER" } });
    const unauthorized = await deleteInvite(new Request("http://localhost"), {
      params: Promise.resolve({ id: "invite-1" }),
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.db.adminInvite.findUnique.mockResolvedValueOnce(null);
    const missing = await deleteInvite(new Request("http://localhost"), {
      params: Promise.resolve({ id: "invite-1" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Invite not found" });

    mocks.db.adminInvite.findUnique.mockResolvedValueOnce({
      id: "invite-1",
      usedAt: new Date("2026-03-20T00:00:00.000Z"),
    });
    const used = await deleteInvite(new Request("http://localhost"), {
      params: Promise.resolve({ id: "invite-1" }),
    });
    expect(used.status).toBe(400);
    expect(await used.json()).toEqual({ error: "Cannot revoke a used invite" });

    const success = await deleteInvite(new Request("http://localhost"), {
      params: Promise.resolve({ id: "invite-1" }),
    });
    expect(success.status).toBe(200);
    expect(mocks.db.adminInvite.delete).toHaveBeenCalledWith({
      where: { id: "invite-1" },
    });
    expect(await success.json()).toEqual({ success: true });

    mocks.db.adminInvite.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failed = await deleteInvite(new Request("http://localhost"), {
      params: Promise.resolve({ id: "invite-1" }),
    });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Failed to delete invite" });
  });

  it("verifies invite codes across all branches", async () => {
    const missingCode = await verifyInvite(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(missingCode.status).toBe(400);
    expect(await missingCode.json()).toEqual({
      valid: false,
      error: "Invite code is required",
    });

    mocks.db.adminInvite.findUnique.mockResolvedValueOnce(null);
    const invalid = await verifyInvite(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ code: "abc123" }),
      }) as never
    );
    expect(invalid.status).toBe(404);
    expect(mocks.db.adminInvite.findUnique).toHaveBeenCalledWith({
      where: { code: "ABC123" },
    });
    expect(await invalid.json()).toEqual({
      valid: false,
      error: "Invalid invite code",
    });

    mocks.db.adminInvite.findUnique.mockResolvedValueOnce({
      code: "ABC123",
      usedAt: new Date("2026-03-20T00:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      email: null,
    });
    const used = await verifyInvite(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ code: "abc123" }),
      }) as never
    );
    expect(used.status).toBe(400);
    expect(await used.json()).toEqual({
      valid: false,
      error: "This invite has already been used",
    });

    mocks.db.adminInvite.findUnique.mockResolvedValueOnce({
      code: "ABC123",
      usedAt: null,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      email: null,
    });
    const expired = await verifyInvite(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ code: "abc123" }),
      }) as never
    );
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({
      valid: false,
      error: "This invite has expired",
    });

    const success = await verifyInvite(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ code: "abc123" }),
      }) as never
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      valid: true,
      email: "admin@example.test",
    });

    mocks.db.adminInvite.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failed = await verifyInvite(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ code: "abc123" }),
      }) as never
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      valid: false,
      error: "Failed to verify invite",
    });
  });

  it("serves pipeline DAGs and definitions and maps route failures", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedDag = await getPipelineDagRoute(new Request("http://localhost") as never, {
      params: Promise.resolve({ pipelineId: "fastqc" }),
    });
    expect(unauthorizedDag.status).toBe(403);
    expect(await unauthorizedDag.json()).toEqual({ error: "Unauthorized" });

    mocks.getPipelineDag.mockReturnValueOnce(null);
    const missingDag = await getPipelineDagRoute(new Request("http://localhost") as never, {
      params: Promise.resolve({ pipelineId: "missing" }),
    });
    expect(missingDag.status).toBe(404);
    expect(await missingDag.json()).toEqual({
      error: "No workflow definition for pipeline: missing",
    });

    const successDag = await getPipelineDagRoute(new Request("http://localhost") as never, {
      params: Promise.resolve({ pipelineId: "fastqc" }),
    });
    expect(successDag.status).toBe(200);
    expect(await successDag.json()).toEqual({
      nodes: [{ id: "start" }],
      edges: [],
    });

    mocks.getPipelineDag.mockImplementationOnce(() => {
      throw new Error("dag broken");
    });
    const failedDag = await getPipelineDagRoute(new Request("http://localhost") as never, {
      params: Promise.resolve({ pipelineId: "fastqc" }),
    });
    expect(failedDag.status).toBe(500);
    expect(await failedDag.json()).toEqual({
      error: "Failed to fetch pipeline DAG",
    });

    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedDef = await getPipelineDefinitionRoute(
      new Request("http://localhost") as never,
      { params: Promise.resolve({ pipelineId: "fastqc" }) }
    );
    expect(unauthorizedDef.status).toBe(401);
    expect(await unauthorizedDef.json()).toEqual({ error: "Unauthorized" });

    mocks.getPipelineDefinition.mockReturnValueOnce(null);
    const missingDef = await getPipelineDefinitionRoute(
      new Request("http://localhost") as never,
      { params: Promise.resolve({ pipelineId: "missing" }) }
    );
    expect(missingDef.status).toBe(404);
    expect(await missingDef.json()).toEqual({
      error: "No definition found for pipeline: missing",
    });

    const successDef = await getPipelineDefinitionRoute(
      new Request("http://localhost") as never,
      { params: Promise.resolve({ pipelineId: "fastqc" }) }
    );
    expect(successDef.status).toBe(200);
    expect(await successDef.json()).toEqual({
      pipeline: "fastqc",
      name: "FastQC",
      description: "QC",
      url: "https://example.test/fastqc",
      version: "1.0.0",
      minNextflowVersion: "24.10.0",
      authors: ["SeqDesk"],
      inputs: [{ name: "reads" }],
      outputs: [{ name: "report" }],
      samplesheet: { columns: ["sample", "fastq_1", "fastq_2"] },
      stepCount: 2,
      parameterGroupCount: 1,
    });

    mocks.getPipelineDefinition.mockImplementationOnce(() => {
      throw new Error("definition broken");
    });
    const failedDef = await getPipelineDefinitionRoute(
      new Request("http://localhost") as never,
      { params: Promise.resolve({ pipelineId: "fastqc" }) }
    );
    expect(failedDef.status).toBe(500);
    expect(await failedDef.json()).toEqual({
      error: "Failed to fetch pipeline definition",
    });
  });

  it("tests settings and detects versions with auth and error handling", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedPost = await postTestSetting(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ setting: "condaPath", value: "/opt/conda" }),
      }) as never
    );
    expect(unauthorizedPost.status).toBe(403);
    expect(await unauthorizedPost.json()).toEqual({ error: "Unauthorized" });

    const missingSetting = await postTestSetting(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ value: "/opt/conda" }),
      }) as never
    );
    expect(missingSetting.status).toBe(400);
    expect(await missingSetting.json()).toEqual({ error: "Setting name required" });

    const successPost = await postTestSetting(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ setting: "condaPath", value: "/opt/conda" }),
      }) as never
    );
    expect(successPost.status).toBe(200);
    expect(mocks.testSetting).toHaveBeenCalledWith("condaPath", "/opt/conda");
    expect(await successPost.json()).toEqual({ ok: true, message: "works" });

    mocks.testSetting.mockRejectedValueOnce(new Error("bad setting"));
    const failedPost = await postTestSetting(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ setting: "condaPath", value: "/opt/conda" }),
      }) as never
    );
    expect(failedPost.status).toBe(500);
    expect(await failedPost.json()).toEqual({ error: "Failed to test setting" });

    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedGet = await getTestSettingVersions();
    expect(unauthorizedGet.status).toBe(403);
    expect(await unauthorizedGet.json()).toEqual({ error: "Unauthorized" });

    const successGet = await getTestSettingVersions();
    expect(successGet.status).toBe(200);
    expect(mocks.detectVersions).toHaveBeenCalledWith("/opt/conda", "seqdesk");
    expect(await successGet.json()).toEqual({
      versions: { nextflow: "24.10.5", java: "21.0.0" },
    });

    mocks.getExecutionSettings.mockRejectedValueOnce(new Error("exec broken"));
    const failedGet = await getTestSettingVersions();
    expect(failedGet.status).toBe(500);
    expect(await failedGet.json()).toEqual({
      error: "Failed to detect versions",
    });
  });
});
