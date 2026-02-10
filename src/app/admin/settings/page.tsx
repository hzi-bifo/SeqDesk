"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  HardDrive,
  Loader2,
  RefreshCw,
  Send,
  Server,
} from "lucide-react";

interface ToolVersions {
  nextflow?: string;
  nfcore?: string;
  conda?: string;
  java?: string;
  condaEnv?: string;
}

interface ConfigStatusResponse {
  config: Record<string, unknown>;
  sources: Record<string, string>;
  filePath?: string;
  loadedAt?: string;
}

interface UpdateInfo {
  currentVersion: string;
  runningVersion?: string;
  installedVersion?: string;
  restartRequired?: boolean;
  updateAvailable: boolean;
  latest?: {
    version: string;
    releaseNotes?: string;
    downloadUrl?: string;
  };
  error?: string;
}

type UpdatePhase =
  | "idle"
  | "checking"
  | "downloading"
  | "extracting"
  | "restarting"
  | "error"
  | "complete";

interface UpdateProgress {
  status: UpdatePhase;
  progress: number;
  message: string;
  error?: string;
  updatedAt?: string;
  targetVersion?: string;
}

function formatDate(value?: string | Date | null): string {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

export default function SettingsPage() {
  const [detectedVersions, setDetectedVersions] = useState<ToolVersions>({});
  const [detectingVersions, setDetectingVersions] = useState(false);

  const [configStatus, setConfigStatus] = useState<ConfigStatusResponse | null>(
    null
  );
  const [loadingConfig, setLoadingConfig] = useState(false);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateProgress | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const [refreshingAll, setRefreshingAll] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const updatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartTargetRef = useRef<string | null>(null);

  const updateInProgress =
    !!updateStatus && !["idle", "complete", "error"].includes(updateStatus.status);
  const installedMatchesLatest = !!(
    updateInfo?.installedVersion &&
    updateInfo?.latest?.version &&
    updateInfo.installedVersion === updateInfo.latest.version
  );
  const restartPending = !!updateInfo?.restartRequired && installedMatchesLatest;
  const runningVersion =
    updateInfo?.runningVersion || updateInfo?.currentVersion || "unknown";
  const latestVersion =
    updateInfo?.latest?.version || updateInfo?.currentVersion || "unknown";

  const toolsMissingCount = useMemo(() => {
    const requiredTools: Array<keyof ToolVersions> = [
      "nextflow",
      "java",
      "nfcore",
      "conda",
    ];
    return requiredTools.filter((tool) => !detectedVersions[tool]).length;
  }, [detectedVersions]);

  const stopUpdatePolling = useCallback(() => {
    if (!updatePollRef.current) return;
    clearInterval(updatePollRef.current);
    updatePollRef.current = null;
  }, []);

  const stopRestartPolling = useCallback(() => {
    if (restartPollRef.current) {
      clearInterval(restartPollRef.current);
      restartPollRef.current = null;
    }
    restartTargetRef.current = null;
  }, []);

  const fetchConfigStatus = useCallback(async (showToast = false) => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/admin/config/status");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to load configuration status");
      }

      const data = (await res.json()) as ConfigStatusResponse;
      setConfigStatus(data);
    } catch (error) {
      console.error("Failed to load config status:", error);
      if (showToast) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load configuration status"
        );
      }
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const fetchUpdateStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/updates/progress");
      if (!res.ok) return;
      const data = (await res.json()) as { status?: UpdateProgress | null };
      setUpdateStatus(data.status ?? null);
    } catch (error) {
      console.error("Failed to load update status:", error);
    }
  }, []);

  const checkForUpdates = useCallback(
    async (force = false, showToast = false) => {
      setCheckingUpdate(true);
      try {
        const res = await fetch(`/api/admin/updates${force ? "?force=true" : ""}`);
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "Failed to check for updates");
        }
        const data = (await res.json()) as UpdateInfo;
        setUpdateInfo(data);
      } catch (error) {
        console.error("Failed to check for updates:", error);
        const message =
          error instanceof Error ? error.message : "Failed to check for updates";
        setUpdateInfo((prev) =>
          prev
            ? { ...prev, error: message }
            : {
                currentVersion: "unknown",
                updateAvailable: false,
                error: message,
              }
        );
        if (showToast) {
          toast.error(message);
        }
      } finally {
        setCheckingUpdate(false);
      }
    },
    []
  );

  const detectInstalledVersions = useCallback(async (showToast = false) => {
    setDetectingVersions(true);
    try {
      const res = await fetch("/api/admin/settings/pipelines/test-setting");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to detect tool versions");
      }
      const data = (await res.json()) as { versions?: ToolVersions };
      setDetectedVersions(data.versions || {});
    } catch (error) {
      console.error("Failed to detect tool versions:", error);
      if (showToast) {
        toast.error(
          error instanceof Error ? error.message : "Failed to detect tool versions"
        );
      }
    } finally {
      setDetectingVersions(false);
    }
  }, []);

  const startUpdatePolling = useCallback(() => {
    if (updatePollRef.current) return;
    updatePollRef.current = setInterval(() => {
      void fetchUpdateStatus();
    }, 2000);
  }, [fetchUpdateStatus]);

  const startRestartPolling = useCallback(
    (targetVersion: string) => {
      if (
        restartPollRef.current &&
        restartTargetRef.current &&
        restartTargetRef.current === targetVersion
      ) {
        return;
      }

      stopRestartPolling();
      restartTargetRef.current = targetVersion;

      restartPollRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/admin/updates?force=true");
          if (!res.ok) return;
          const data = (await res.json()) as UpdateInfo;
          setUpdateInfo(data);
          const running = data.runningVersion || data.currentVersion;
          if (running === targetVersion) {
            stopRestartPolling();
            window.location.reload();
          }
        } catch {
          // Server might be restarting; keep polling.
        }
      }, 3000);
    },
    [stopRestartPolling]
  );

  const refreshAll = useCallback(async () => {
    setRefreshingAll(true);
    await Promise.all([
      detectInstalledVersions(true),
      fetchConfigStatus(true),
      checkForUpdates(true, true),
      fetchUpdateStatus(),
    ]);
    setLastRefreshedAt(new Date());
    setRefreshingAll(false);
  }, [
    checkForUpdates,
    detectInstalledVersions,
    fetchConfigStatus,
    fetchUpdateStatus,
  ]);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        detectInstalledVersions(),
        fetchConfigStatus(),
        checkForUpdates(),
        fetchUpdateStatus(),
      ]);
      setLastRefreshedAt(new Date());
    })();
  }, [
    checkForUpdates,
    detectInstalledVersions,
    fetchConfigStatus,
    fetchUpdateStatus,
  ]);

  useEffect(() => {
    if (updateInProgress) {
      startUpdatePolling();
      return;
    }
    stopUpdatePolling();
  }, [startUpdatePolling, stopUpdatePolling, updateInProgress]);

  useEffect(() => {
    if (
      updateStatus?.targetVersion &&
      (updateStatus.status === "restarting" || updateStatus.status === "complete")
    ) {
      startRestartPolling(updateStatus.targetVersion);
      return;
    }
    stopRestartPolling();
  }, [
    startRestartPolling,
    stopRestartPolling,
    updateStatus?.status,
    updateStatus?.targetVersion,
  ]);

  useEffect(() => {
    return () => {
      stopUpdatePolling();
      stopRestartPolling();
    };
  }, [stopRestartPolling, stopUpdatePolling]);

  const performUpdate = async () => {
    if (!updateInfo?.updateAvailable || !updateInfo.latest) return;

    const confirmed = window.confirm(
      `Update to v${updateInfo.latest.version}?\n\n` +
        `This will:\n` +
        `1. Download the new version\n` +
        `2. Backup your database\n` +
        `3. Install the update\n` +
        `4. Restart the server\n\n` +
        `The app will be unavailable for a few seconds during restart.`
    );
    if (!confirmed) return;

    setUpdateStatus({
      status: "checking",
      progress: 0,
      message: "Starting update...",
      targetVersion: updateInfo.latest.version,
    });

    try {
      const res = await fetch("/api/admin/updates/install", {
        method: "POST",
      });

      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!res.ok) {
        if (res.status === 409) {
          throw new Error(payload?.error || "Update already in progress");
        }
        throw new Error(payload?.error || "Failed to start update");
      }

      toast.success(
        "Update started. SeqDesk will attempt restart; if it does not return, restart it manually."
      );
      await Promise.all([fetchUpdateStatus(), checkForUpdates(true)]);
    } catch (error) {
      console.error("Update failed:", error);
      const message = error instanceof Error ? error.message : "Update failed";
      toast.error(message);
      setUpdateStatus({
        status: "error",
        progress: 0,
        message: "Update failed",
        error: message,
        targetVersion: updateInfo.latest.version,
      });
    }
  };

  return (
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Platform updates, runtime diagnostics, and configuration sources
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border mb-6">
        <div className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {refreshingAll ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Refreshing settings diagnostics...
              </span>
            ) : (
              <>
                {updateInProgress ? "Update in progress" : "No active update"} •
                Running v{runningVersion} •{" "}
                {updateInfo?.updateAvailable
                  ? `v${latestVersion} available`
                  : "Up to date"}{" "}
                • {toolsMissingCount} tool
                {toolsMissingCount === 1 ? "" : "s"} missing
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            {lastRefreshedAt && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Clock3 className="h-3 w-3" />
                {formatDate(lastRefreshedAt)}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => void refreshAll()}
              disabled={
                refreshingAll || updateInProgress || checkingUpdate || loadingConfig
              }
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${refreshingAll ? "animate-spin" : ""}`}
              />
              Refresh all
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-base font-semibold">Quick Actions</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Open related admin pages to make configuration changes
            </p>
          </div>
          <div className="p-4 grid gap-2 sm:grid-cols-3">
            <Button asChild variant="outline" className="justify-between bg-white">
              <Link href="/admin/data-compute">
                <span className="inline-flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Infrastructure
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-between bg-white">
              <Link href="/admin/settings/pipelines">
                <span className="inline-flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Pipelines
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-between bg-white">
              <Link href="/admin/ena">
                <span className="inline-flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Data Upload
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Software Updates</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Check and install SeqDesk updates
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => void checkForUpdates(true, true)}
              disabled={checkingUpdate || updateInProgress}
            >
              {checkingUpdate ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Check now
            </Button>
          </div>

          <div className="p-4 space-y-4">
            {updateStatus && updateStatus.status !== "idle" && (
              <div
                className={`border rounded-lg p-4 ${
                  updateStatus.status === "error"
                    ? "bg-red-50 border-red-200"
                    : "bg-muted/30 border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  {updateStatus.status === "error" ? (
                    <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                  ) : (
                    <Server className="h-5 w-5 text-muted-foreground mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{updateStatus.message}</p>
                    {updateStatus.error && (
                      <p className="text-xs text-red-700 mt-1">{updateStatus.error}</p>
                    )}
                    <div className="mt-3">
                      <div className="h-2 rounded bg-muted overflow-hidden">
                        <div
                          className={`h-2 ${
                            updateStatus.status === "error"
                              ? "bg-red-500"
                              : "bg-blue-600"
                          }`}
                          style={{
                            width: `${Math.min(updateStatus.progress || 0, 100)}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {updateStatus.progress || 0}% • {updateStatus.status}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {updateInfo?.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {updateInfo.error}
              </div>
            )}

            {updateInfo ? (
              <>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <div className="rounded-lg border bg-white px-3 py-2">
                    <p className="text-xs text-muted-foreground">Running</p>
                    <p className="font-medium">v{runningVersion}</p>
                  </div>
                  <div className="rounded-lg border bg-white px-3 py-2">
                    <p className="text-xs text-muted-foreground">Installed</p>
                    <p className="font-medium">
                      v{updateInfo.installedVersion || updateInfo.currentVersion}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-white px-3 py-2">
                    <p className="text-xs text-muted-foreground">Latest</p>
                    <p className="font-medium">v{latestVersion}</p>
                  </div>
                </div>

                {restartPending && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <p>Update is installed on disk and waiting for restart completion.</p>
                    <p className="mt-1 text-xs text-amber-800">
                      If it does not restart automatically, restart your process manager
                      (for example <code className="font-mono">pm2 restart seqdesk</code> or{" "}
                      <code className="font-mono">systemctl --user restart seqdesk</code>),
                      or restart the server process manually.
                    </p>
                  </div>
                )}

                {updateInfo.updateAvailable && updateInfo.latest ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="flex items-start gap-3">
                      <Download className="h-5 w-5 text-blue-600 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium text-blue-900">
                          Update available: v{updateInfo.latest.version}
                        </p>
                        {updateInfo.latest.releaseNotes && (
                          <p className="text-sm text-blue-800 mt-1">
                            {updateInfo.latest.releaseNotes}
                          </p>
                        )}
                        <div className="mt-3">
                          <Button
                            onClick={performUpdate}
                            disabled={updateInProgress || restartPending}
                          >
                            {updateInProgress ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {updateStatus?.message || "Updating..."}
                              </>
                            ) : restartPending ? (
                              <>
                                <Server className="h-4 w-4 mr-2" />
                                Restart pending
                              </>
                            ) : (
                              <>
                                <Download className="h-4 w-4 mr-2" />
                                Install update
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center gap-2 text-emerald-900">
                    <CheckCircle2 className="h-4 w-4" />
                    SeqDesk is up to date
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Each update creates a database backup before installation.
                </p>
              </>
            ) : checkingUpdate ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Failed to load update state. Use Check now to retry.
              </p>
            )}
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Detected Tool Versions</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Pipeline runtime tools discovered on this host
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => void detectInstalledVersions(true)}
              disabled={detectingVersions}
            >
              {detectingVersions ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Re-scan
            </Button>
          </div>

          <div className="p-4 space-y-4">
            {toolsMissingCount > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {toolsMissingCount} required tool
                {toolsMissingCount === 1 ? "" : "s"} not detected.
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                All required runtime tools are detected.
              </div>
            )}

            {detectedVersions.condaEnv && (
              <p className="text-xs text-muted-foreground">
                Active environment:{" "}
                <span className="font-mono">{detectedVersions.condaEnv}</span>
              </p>
            )}

            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              {[
                { key: "nextflow", label: "Nextflow", value: detectedVersions.nextflow },
                {
                  key: "java",
                  label: "Java",
                  value: detectedVersions.java
                    ? `Java ${detectedVersions.java}`
                    : undefined,
                },
                { key: "nfcore", label: "nf-core", value: detectedVersions.nfcore },
                { key: "conda", label: "Conda", value: detectedVersions.conda },
              ].map((tool) => (
                <div
                  key={tool.key}
                  className={`rounded-lg border px-3 py-2 ${
                    tool.value
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-border bg-muted/20"
                  }`}
                >
                  <p className="text-xs text-muted-foreground">{tool.label}</p>
                  <p className="text-sm font-mono mt-1">
                    {tool.value || "Not found"}
                  </p>
                </div>
              ))}
            </div>

            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link href="/admin/pipeline-runtime">
                Open Pipeline Runtime
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Configuration Status</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Effective values and their value source
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => void fetchConfigStatus(true)}
              disabled={loadingConfig}
            >
              {loadingConfig ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>

          <div className="p-4">
            {configStatus ? (
              <div className="space-y-4">
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-lg border bg-white px-3 py-2">
                    <p className="text-xs text-muted-foreground">Config file</p>
                    {configStatus.filePath ? (
                      <code className="text-xs break-all">{configStatus.filePath}</code>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        No file found (defaults and environment only)
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg border bg-white px-3 py-2">
                    <p className="text-xs text-muted-foreground">Loaded at</p>
                    <p className="text-sm">{formatDate(configStatus.loadedAt)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className="bg-blue-50 text-blue-700 border-blue-200"
                  >
                    ENV
                  </Badge>
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-200"
                  >
                    FILE
                  </Badge>
                  <Badge
                    variant="outline"
                    className="bg-violet-50 text-violet-700 border-violet-200"
                  >
                    DATABASE
                  </Badge>
                  <Badge
                    variant="outline"
                    className="bg-muted text-muted-foreground border-border"
                  >
                    DEFAULT
                  </Badge>
                </div>

                <div className="space-y-3">
                  <ConfigSection
                    title="Site"
                    config={configStatus.config.site as Record<string, unknown>}
                    sources={configStatus.sources}
                    prefix="site"
                  />
                  <ConfigSection
                    title="Pipelines"
                    config={configStatus.config.pipelines as Record<string, unknown>}
                    sources={configStatus.sources}
                    prefix="pipelines"
                  />
                  <ConfigSection
                    title="ENA"
                    config={configStatus.config.ena as Record<string, unknown>}
                    sources={configStatus.sources}
                    prefix="ena"
                  />
                  <ConfigSection
                    title="Sequencing Files"
                    config={
                      configStatus.config.sequencingFiles as Record<
                        string,
                        unknown
                      >
                    }
                    sources={configStatus.sources}
                    prefix="sequencingFiles"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  See{" "}
                  <a
                    href="https://github.com/hzi-bifo/SeqDesk/blob/main/docs/configuration.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    docs/configuration.md
                  </a>{" "}
                  for all configuration options.
                </p>
              </div>
            ) : loadingConfig ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Failed to load configuration status.
              </p>
            )}
          </div>
        </section>
      </div>
    </PageContainer>
  );
}

function ConfigSection({
  title,
  config,
  sources,
  prefix,
}: {
  title: string;
  config: Record<string, unknown> | undefined;
  sources: Record<string, string>;
  prefix: string;
}) {
  if (!config) return null;

  const getSourceBadge = (path: string) => {
    const source = sources[path] || "default";
    const styles: Record<string, string> = {
      env: "bg-blue-50 text-blue-700 border-blue-200",
      file: "bg-green-50 text-green-700 border-green-200",
      database: "bg-violet-50 text-violet-700 border-violet-200",
      default: "bg-muted text-muted-foreground border-border",
    };

    return (
      <Badge
        variant="outline"
        className={`text-[10px] px-1 py-0 ${styles[source] || styles.default}`}
      >
        {source.toUpperCase()}
      </Badge>
    );
  };

  const renderValue = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const flattenConfig = (
    obj: Record<string, unknown>,
    parentPath = ""
  ): Array<{ path: string; value: unknown }> => {
    const items: Array<{ path: string; value: unknown }> = [];

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = parentPath ? `${parentPath}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        items.push(...flattenConfig(value as Record<string, unknown>, fullPath));
      } else {
        items.push({ path: fullPath, value });
      }
    }

    return items;
  };

  const items = flattenConfig(config, prefix);
  if (items.length === 0) {
    return (
      <div className="rounded-lg border p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">{title}</p>
        No values.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="bg-muted/30 px-3 py-2 border-b">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="divide-y">
        {items.map(({ path, value }) => {
          const displayPath = path.startsWith(`${prefix}.`)
            ? path.slice(prefix.length + 1)
            : path;
          const renderedValue = renderValue(value);

          return (
            <div
              key={path}
              className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-xs text-muted-foreground break-all">
                    {displayPath}
                  </code>
                  {getSourceBadge(path)}
                </div>
              </div>
              <span
                className="text-right max-w-[55%] break-all"
                title={renderedValue}
              >
                {renderedValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
