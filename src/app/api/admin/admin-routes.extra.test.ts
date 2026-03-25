import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getResolvedDataBasePath: vi.fn(),
  getExecutionSettings: vi.fn(),
  quickPrerequisiteCheck: vi.fn(),
  checkAllPrerequisites: vi.fn(),
  checkForUpdates: vi.fn(),
  getCurrentVersion: vi.fn(),
  getInstalledVersion: vi.fn(),
  installUpdate: vi.fn(),
  acquireUpdateLock: vi.fn(),
  isUpdateInProgress: vi.fn(),
  releaseUpdateLock: vi.fn(),
  writeUpdateStatus: vi.fn(),
  readUpdateStatus: vi.fn(),
  clearUpdateStatus: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/files/data-base-path", () => ({
  getResolvedDataBasePath: mocks.getResolvedDataBasePath,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@/lib/pipelines/prerequisite-check", () => ({
  quickPrerequisiteCheck: mocks.quickPrerequisiteCheck,
  checkAllPrerequisites: mocks.checkAllPrerequisites,
}));

vi.mock("@/lib/updater", () => ({
  checkForUpdates: mocks.checkForUpdates,
  getCurrentVersion: mocks.getCurrentVersion,
  getInstalledVersion: mocks.getInstalledVersion,
}));

vi.mock("@/lib/updater/installer", () => ({
  installUpdate: mocks.installUpdate,
}));

vi.mock("@/lib/updater/status", () => ({
  acquireUpdateLock: mocks.acquireUpdateLock,
  isUpdateInProgress: mocks.isUpdateInProgress,
  releaseUpdateLock: mocks.releaseUpdateLock,
  writeUpdateStatus: mocks.writeUpdateStatus,
  readUpdateStatus: mocks.readUpdateStatus,
  clearUpdateStatus: mocks.clearUpdateStatus,
}));

import { GET as getPrerequisites } from "./settings/pipelines/check-prerequisites/route";
import { GET as getUpdates } from "./updates/route";
import { GET as getUpdateProgress } from "./updates/progress/route";
import { POST as installUpdates } from "./updates/install/route";
import { GET as getInfrastructureReadiness } from "./infrastructure/readiness/route";

describe("admin route coverage quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.getResolvedDataBasePath.mockResolvedValue({
      dataBasePath: "/data/base",
    });
    mocks.getExecutionSettings.mockResolvedValue({
      condaPath: "/opt/conda",
      pipelineRunDir: "/runs",
      weblogUrl: "https://weblog.example",
    });
    mocks.quickPrerequisiteCheck.mockResolvedValue({
      ready: true,
      summary: "All good",
    });
    mocks.checkAllPrerequisites.mockResolvedValue({
      ready: true,
      checks: [],
    });
    mocks.checkForUpdates.mockResolvedValue({
      updateAvailable: true,
      latest: {
        version: "1.2.0",
        releaseNotes: "Coverage improvements",
      },
      currentDatabaseProvider: "postgresql",
      databaseCompatible: true,
      databaseCompatibilityError: null,
      error: null,
    });
    mocks.getCurrentVersion.mockReturnValue("1.1.80");
    mocks.getInstalledVersion.mockResolvedValue("1.1.80");
    mocks.installUpdate.mockResolvedValue(undefined);
    mocks.acquireUpdateLock.mockResolvedValue(true);
    mocks.isUpdateInProgress.mockResolvedValue(false);
    mocks.releaseUpdateLock.mockResolvedValue(undefined);
    mocks.writeUpdateStatus.mockResolvedValue(undefined);
    mocks.readUpdateStatus.mockResolvedValue(null);
    mocks.clearUpdateStatus.mockResolvedValue(undefined);
  });

  it("checks prerequisites in quick and full modes and rejects unauthorized callers", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getPrerequisites(
      new Request("http://localhost/api/admin/settings/pipelines/check-prerequisites")
    );
    expect(unauthorized.status).toBe(403);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const quick = await getPrerequisites(
      new Request(
        "http://localhost/api/admin/settings/pipelines/check-prerequisites?quick=true"
      )
    );
    expect(quick.status).toBe(200);
    expect(mocks.quickPrerequisiteCheck).toHaveBeenCalledWith(
      {
        condaPath: "/opt/conda",
        pipelineRunDir: "/runs",
        weblogUrl: "https://weblog.example",
      },
      "/data/base"
    );
    expect(await quick.json()).toEqual({
      ready: true,
      summary: "All good",
    });

    const full = await getPrerequisites(
      new Request("http://localhost/api/admin/settings/pipelines/check-prerequisites")
    );
    expect(full.status).toBe(200);
    expect(mocks.checkAllPrerequisites).toHaveBeenCalledWith(
      {
        condaPath: "/opt/conda",
        pipelineRunDir: "/runs",
        weblogUrl: "https://weblog.example",
      },
      "/data/base"
    );
    expect(await full.json()).toEqual({
      ready: true,
      checks: [],
    });
  });

  it("maps prerequisite check failures", async () => {
    mocks.getExecutionSettings.mockRejectedValueOnce(new Error("broken"));

    const response = await getPrerequisites(
      new Request("http://localhost/api/admin/settings/pipelines/check-prerequisites")
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to check prerequisites",
    });
  });

  it("checks for updates and surfaces force mode and restart state", async () => {
    const success = await getUpdates(
      new Request("http://localhost/api/admin/updates?force=true")
    );
    expect(success.status).toBe(200);
    expect(mocks.checkForUpdates).toHaveBeenCalledWith(true);
    expect(await success.json()).toEqual({
      currentVersion: "1.1.80",
      runningVersion: "1.1.80",
      installedVersion: "1.1.80",
      restartRequired: false,
      updateAvailable: true,
      latest: {
        version: "1.2.0",
        releaseNotes: "Coverage improvements",
      },
      currentDatabaseProvider: "postgresql",
      databaseCompatible: true,
      databaseCompatibilityError: null,
      error: null,
    });

    mocks.getInstalledVersion.mockResolvedValueOnce("1.2.0");
    const restartPending = await getUpdates(
      new Request("http://localhost/api/admin/updates")
    );
    expect(restartPending.status).toBe(200);
    expect(await restartPending.json()).toMatchObject({
      restartRequired: true,
      installedVersion: "1.2.0",
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { role: "USER" } });
    const unauthorized = await getUpdates(
      new Request("http://localhost/api/admin/updates")
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });
  });

  it("maps update check failures", async () => {
    mocks.checkForUpdates.mockRejectedValueOnce(new Error("network down"));

    const response = await getUpdates(
      new Request("http://localhost/api/admin/updates")
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to check for updates",
    });
  });

  it("returns, completes, and clears update progress", async () => {
    mocks.readUpdateStatus.mockResolvedValueOnce({
      status: "downloading",
      progress: 45,
      message: "Downloading",
      targetVersion: "1.2.0",
    });
    mocks.getCurrentVersion.mockReturnValueOnce("1.1.80");
    mocks.getInstalledVersion.mockResolvedValueOnce("1.1.80");

    const current = await getUpdateProgress();
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({
      status: {
        status: "downloading",
        progress: 45,
        message: "Downloading",
        targetVersion: "1.2.0",
      },
      runningVersion: "1.1.80",
      installedVersion: "1.1.80",
    });

    mocks.readUpdateStatus.mockResolvedValueOnce({
      status: "installing",
      progress: 80,
      message: "Installing",
      targetVersion: "1.2.0",
    });
    mocks.getCurrentVersion.mockReturnValueOnce("1.2.0");
    mocks.getInstalledVersion.mockResolvedValueOnce("1.2.0");

    const completed = await getUpdateProgress();
    expect(completed.status).toBe(200);
    expect(mocks.writeUpdateStatus).toHaveBeenCalledWith(
      {
        status: "complete",
        progress: 100,
        message: "Update complete.",
        targetVersion: "1.2.0",
      },
      { targetVersion: "1.2.0" }
    );
    expect(await completed.json()).toEqual({
      status: {
        status: "complete",
        progress: 100,
        message: "Update complete.",
        targetVersion: "1.2.0",
      },
      runningVersion: "1.2.0",
      installedVersion: "1.2.0",
    });

    mocks.readUpdateStatus.mockResolvedValueOnce({
      status: "complete",
      progress: 100,
      message: "Update complete.",
      targetVersion: "1.2.0",
    });
    mocks.getCurrentVersion.mockReturnValueOnce("1.2.0");
    mocks.getInstalledVersion.mockResolvedValueOnce("1.2.0");

    const cleared = await getUpdateProgress();
    expect(cleared.status).toBe(200);
    expect(mocks.clearUpdateStatus).toHaveBeenCalledTimes(1);
    expect(await cleared.json()).toEqual({
      status: null,
      runningVersion: "1.2.0",
      installedVersion: "1.2.0",
    });
  });

  it("rejects unauthorized progress requests", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const response = await getUpdateProgress();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("handles update installation preconditions and successful startup", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await installUpdates();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.isUpdateInProgress.mockResolvedValueOnce(true);
    const alreadyRunning = await installUpdates();
    expect(alreadyRunning.status).toBe(409);
    expect(await alreadyRunning.json()).toEqual({
      error: "Update already in progress",
    });

    mocks.acquireUpdateLock.mockResolvedValueOnce(false);
    const lockFailure = await installUpdates();
    expect(lockFailure.status).toBe(409);
    expect(await lockFailure.json()).toEqual({
      error: "Update already in progress",
    });

    mocks.checkForUpdates.mockResolvedValueOnce({
      updateAvailable: false,
      latest: null,
    });
    const noUpdate = await installUpdates();
    expect(noUpdate.status).toBe(200);
    expect(mocks.releaseUpdateLock).toHaveBeenCalledTimes(1);
    expect(await noUpdate.json()).toEqual({
      success: false,
      message: "No update available",
    });

    mocks.checkForUpdates.mockResolvedValueOnce({
      updateAvailable: true,
      latest: { version: "1.2.0" },
      databaseCompatible: false,
      databaseCompatibilityError: "Requires PostgreSQL",
    });
    const incompatible = await installUpdates();
    expect(incompatible.status).toBe(409);
    expect(await incompatible.json()).toEqual({
      error: "Requires PostgreSQL",
    });

    mocks.checkForUpdates.mockResolvedValueOnce({
      updateAvailable: true,
      latest: { version: "1.2.0" },
      databaseCompatible: true,
    });
    const success = await installUpdates();
    expect(success.status).toBe(200);
    expect(mocks.writeUpdateStatus).toHaveBeenCalledWith(
      { status: "checking", progress: 0, message: "Preparing update..." },
      { targetVersion: "1.2.0" }
    );
    expect(mocks.installUpdate).toHaveBeenCalledTimes(1);
    expect(await success.json()).toEqual({
      success: true,
      message:
        "Installing update to version 1.2.0. SeqDesk will attempt automatic restart.",
      version: "1.2.0",
    });
  });

  it("maps update installation failures", async () => {
    mocks.acquireUpdateLock.mockRejectedValueOnce(new Error("lock error"));

    const response = await installUpdates();

    expect(response.status).toBe(500);
    expect(mocks.releaseUpdateLock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      error: "Failed to start update",
    });
  });

  it("evaluates infrastructure readiness and rejects unauthorized users", async () => {
    const ready = await getInfrastructureReadiness();
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      ready: true,
      requiredMissing: [],
      recommendedMissing: [],
      missingItems: [],
      firstMissingHref: "/admin/data-compute",
    });

    mocks.getResolvedDataBasePath.mockResolvedValueOnce({ dataBasePath: "   " });
    mocks.getExecutionSettings.mockResolvedValueOnce({
      pipelineRunDir: "/",
      condaPath: "",
      weblogUrl: "",
    });
    const missing = await getInfrastructureReadiness();
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({
      ready: false,
      requiredMissing: ["Data storage path", "Pipeline run directory"],
      recommendedMissing: ["Conda path", "Weblog URL"],
      missingItems: [
        {
          key: "dataPath",
          label: "Data storage path",
          href: "/admin/data-storage#required-data-storage",
          severity: "required",
        },
        {
          key: "runDir",
          label: "Pipeline run directory",
          href: "/admin/pipeline-runtime#required-runtime",
          severity: "required",
        },
        {
          key: "condaPath",
          label: "Conda path",
          href: "/admin/pipeline-runtime#required-runtime",
          severity: "recommended",
        },
        {
          key: "weblogUrl",
          label: "Weblog URL",
          href: "/admin/pipeline-runtime#advanced-runtime",
          severity: "recommended",
        },
      ],
      firstMissingHref: "/admin/data-storage#required-data-storage",
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { role: "USER" } });
    const unauthorized = await getInfrastructureReadiness();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });
  });

  it("maps infrastructure readiness failures", async () => {
    mocks.getExecutionSettings.mockRejectedValueOnce(new Error("broken"));

    const response = await getInfrastructureReadiness();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to evaluate infrastructure readiness",
    });
  });
});
