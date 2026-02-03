"use client";

import { useState, useEffect, useRef } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Info, Users, Loader2, AlertTriangle, CheckCircle2, FileJson, RefreshCw, Download, ArrowUpCircle, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [departmentSharing, setDepartmentSharing] = useState(false);

  // Detected tool versions
  const [detectedVersions, setDetectedVersions] = useState<{ nextflow?: string; nfcore?: string; conda?: string; java?: string; condaEnv?: string }>({});
  const [detectingVersions, setDetectingVersions] = useState(false);

  // Config status
  const [configStatus, setConfigStatus] = useState<{
    config: Record<string, unknown>;
    sources: Record<string, string>;
    filePath?: string;
    loadedAt?: string;
  } | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Update system
  const [updateInfo, setUpdateInfo] = useState<{
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
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<{
    status: "idle" | "checking" | "downloading" | "extracting" | "restarting" | "error" | "complete";
    progress: number;
    message: string;
    error?: string;
    updatedAt?: string;
    targetVersion?: string;
  } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    fetchSettings();
    detectInstalledVersions();
    fetchConfigStatus();
    checkForUpdates();
    fetchUpdateStatus();
  }, []);

  const updateInProgress =
    !!updateStatus && !["idle", "complete", "error"].includes(updateStatus.status);
  const installedMatchesLatest = !!(
    updateInfo?.installedVersion &&
    updateInfo?.latest?.version &&
    updateInfo.installedVersion === updateInfo.latest.version
  );
  const restartPending = !!updateInfo?.restartRequired && installedMatchesLatest;
  const updatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopUpdatePolling = () => {
    if (updatePollRef.current) {
      clearInterval(updatePollRef.current);
      updatePollRef.current = null;
    }
  };

  const stopRestartPolling = () => {
    if (restartPollRef.current) {
      clearInterval(restartPollRef.current);
      restartPollRef.current = null;
    }
  };

  const startUpdatePolling = () => {
    if (updatePollRef.current) return;
    updatePollRef.current = setInterval(async () => {
      await fetchUpdateStatus();
    }, 2000);
  };

  const startRestartPolling = (targetVersion: string) => {
    if (restartPollRef.current) return;
    restartPollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/updates?force=true");
        if (!res.ok) return;
        const data = await res.json();
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
  };

  useEffect(() => {
    if (updateInProgress) {
      startUpdatePolling();
      return;
    }

    stopUpdatePolling();
  }, [updateInProgress]);

  useEffect(() => {
    if (!updateStatus?.targetVersion) return;
    if (updateStatus.status === "restarting" || updateStatus.status === "complete") {
      startRestartPolling(updateStatus.targetVersion);
    }
  }, [updateStatus?.status, updateStatus?.targetVersion]);

  useEffect(() => () => {
    stopUpdatePolling();
    stopRestartPolling();
  }, []);

  const fetchConfigStatus = async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/admin/config/status");
      if (res.ok) {
        const data = await res.json();
        setConfigStatus(data);
      }
    } catch (error) {
      console.error("Failed to load config status:", error);
    } finally {
      setLoadingConfig(false);
    }
  };

  const fetchUpdateStatus = async () => {
    try {
      const res = await fetch("/api/admin/updates/progress");
      if (res.ok) {
        const data = await res.json();
        setUpdateStatus(data.status ?? null);
      }
    } catch (error) {
      console.error("Failed to load update status:", error);
    }
  };

  const checkForUpdates = async (force = false) => {
    setCheckingUpdate(true);
    try {
      const res = await fetch(`/api/admin/updates${force ? "?force=true" : ""}`);
      if (res.ok) {
        const data = await res.json();
        setUpdateInfo(data);
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      setCheckingUpdate(false);
    }
  };

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

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409) {
          throw new Error(data.error || "Update already in progress");
        }
        throw new Error(data.error || "Update failed");
      }

      toast.success("Update started. We'll reload when the server restarts.");
      await fetchUpdateStatus();
      await checkForUpdates(true);
    } catch (error) {
      console.error("Update failed:", error);
      toast.error(error instanceof Error ? error.message : "Update failed");
      setUpdateStatus({
        status: "error",
        progress: 0,
        message: "Update failed",
        error: error instanceof Error ? error.message : "Update failed",
        targetVersion: updateInfo.latest.version,
      });
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings/access");
      const data = await res.json();
      setDepartmentSharing(data.departmentSharing ?? false);
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDepartmentSharingChange = async (enabled: boolean) => {
    setSaving(true);
    setDepartmentSharing(enabled);

    try {
      await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentSharing: enabled }),
      });
    } catch (error) {
      console.error("Failed to save setting:", error);
      // Revert on error
      setDepartmentSharing(!enabled);
    } finally {
      setSaving(false);
    }
  };

  const detectInstalledVersions = async () => {
    setDetectingVersions(true);
    try {
      const res = await fetch("/api/admin/settings/pipelines/test-setting");
      if (res.ok) {
        const data = await res.json();
        setDetectedVersions(data.versions || {});
      }
    } catch {
      // Ignore
    }
    setDetectingVersions(false);
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Info className="h-6 w-6" />
          Info
        </h1>
        <p className="text-muted-foreground mt-1">
          Platform status, updates, and configuration overview
        </p>
      </div>

      {/* Access & Sharing */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <Users className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Access & Sharing</h2>
            <p className="text-sm text-muted-foreground">
              Control how users can access and share orders
            </p>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="department-sharing" className="text-base font-medium">
                Department Sharing
              </Label>
              <p className="text-sm text-muted-foreground">
                Allow users in the same department to view and edit each other&apos;s orders.
                When disabled, users can only see their own orders.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                id="department-sharing"
                checked={departmentSharing}
                onCheckedChange={handleDepartmentSharingChange}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Software Updates */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
              updateInfo?.updateAvailable ? "bg-blue-100" : "bg-slate-100"
            }`}>
              <ArrowUpCircle className={`h-5 w-5 ${
                updateInfo?.updateAvailable ? "text-blue-600" : "text-slate-600"
              }`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Software Updates</h2>
              <p className="text-sm text-muted-foreground">
                Check for and install SeqDesk updates
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => checkForUpdates(true)}
            disabled={checkingUpdate || updateInProgress}
          >
            {checkingUpdate ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="border-t pt-4">
          {updateStatus && updateStatus.status !== "idle" && (
            <div className={`border rounded-lg p-4 mb-4 ${
              updateStatus.status === "error"
                ? "bg-red-50 border-red-200"
                : "bg-slate-50 border-slate-200"
            }`}>
              <div className="flex items-start gap-3">
                {updateStatus.status === "error" ? (
                  <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                ) : (
                  <Server className="h-5 w-5 text-slate-600 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className={`font-medium ${
                    updateStatus.status === "error" ? "text-red-900" : "text-slate-900"
                  }`}>
                    {updateStatus.message}
                  </p>
                  {updateStatus.error && (
                    <p className="text-sm text-red-700 mt-1">
                      {updateStatus.error}
                    </p>
                  )}
                  <div className="mt-3">
                    <div className="h-2 rounded bg-slate-200 overflow-hidden">
                      <div
                        className={`h-2 ${
                          updateStatus.status === "error" ? "bg-red-500" : "bg-blue-600"
                        }`}
                        style={{ width: `${Math.min(updateStatus.progress || 0, 100)}%` }}
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
          {updateInfo ? (
            <div className="space-y-4">
              {/* Running Version */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Running version</span>
                <Badge variant="outline">v{updateInfo.runningVersion || updateInfo.currentVersion}</Badge>
              </div>

              {/* Installed Version */}
              {updateInfo.installedVersion && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Installed version</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={restartPending ? "default" : "outline"}>
                      v{updateInfo.installedVersion}
                    </Badge>
                    {restartPending && (
                      <Badge
                        variant="outline"
                        className="text-amber-700 bg-amber-50 border-amber-200"
                      >
                        Restart pending
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Latest Version */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Latest version</span>
                <Badge variant={updateInfo.updateAvailable ? "default" : "outline"}>
                  v{updateInfo.latest?.version || updateInfo.currentVersion}
                </Badge>
              </div>

              {restartPending && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-900">
                        Update installed. Restart required to finish.
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        The server will restart automatically once the update completes.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Update Status */}
              {updateInfo.updateAvailable && updateInfo.latest ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Download className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-blue-900">
                        Update available: v{updateInfo.latest.version}
                      </p>
                      {updateInfo.latest.releaseNotes && (
                        <p className="text-sm text-blue-700 mt-1">
                          {updateInfo.latest.releaseNotes}
                        </p>
                      )}
                      {restartPending && (
                        <p className="text-sm text-amber-700 mt-2">
                          Update is already installed on disk. Waiting for restart.
                        </p>
                      )}
                      <div className="mt-3">
                        <Button
                          onClick={performUpdate}
                          disabled={updateInProgress || restartPending}
                          className="bg-blue-600 hover:bg-blue-700"
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
                              Install Update
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <p className="text-green-900">
                      SeqDesk is up to date
                    </p>
                  </div>
                </div>
              )}

              {/* Warning */}
              <p className="text-xs text-muted-foreground">
                Updates will backup your database before installing.
                The server will restart automatically after the update.
              </p>
            </div>
          ) : checkingUpdate ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Failed to check for updates. Click refresh to try again.
            </p>
          )}
        </div>
      </GlassCard>

      {/* Detected Tool Versions */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <Server className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Detected Tool Versions</h2>
              <p className="text-sm text-muted-foreground">
                Pipeline tools detected on this server
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={detectInstalledVersions}
            disabled={detectingVersions}
            className="h-8"
          >
            {detectingVersions ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="border-t pt-4">
          {detectedVersions.condaEnv && (
            <p className="text-xs text-muted-foreground mb-3">
              Using: <span className="font-mono font-medium">{detectedVersions.condaEnv}</span>
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className={`p-2 rounded ${detectedVersions.nextflow ? "bg-green-50" : "bg-muted"}`}>
              <p className="text-xs text-muted-foreground">Nextflow</p>
              <p className="font-mono">{detectedVersions.nextflow || "Not found"}</p>
            </div>
            <div className={`p-2 rounded ${detectedVersions.java ? "bg-green-50" : "bg-muted"}`}>
              <p className="text-xs text-muted-foreground">Java</p>
              <p className="font-mono">{detectedVersions.java ? `Java ${detectedVersions.java}` : "Not found"}</p>
            </div>
            <div className={`p-2 rounded ${detectedVersions.nfcore ? "bg-green-50" : "bg-muted"}`}>
              <p className="text-xs text-muted-foreground">nf-core</p>
              <p className="font-mono">{detectedVersions.nfcore || "Not found"}</p>
            </div>
            <div className={`p-2 rounded ${detectedVersions.conda ? "bg-green-50" : "bg-muted"}`}>
              <p className="text-xs text-muted-foreground">Conda</p>
              <p className="font-mono">{detectedVersions.conda || "Not found"}</p>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Configuration Status */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <FileJson className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Configuration Status</h2>
              <p className="text-sm text-muted-foreground">
                View current configuration and sources
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchConfigStatus}
            disabled={loadingConfig}
          >
            {loadingConfig ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="border-t pt-4">
          {configStatus ? (
            <div className="space-y-4">
              {/* Config File Info */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Config file:</span>
                {configStatus.filePath ? (
                  <code className="bg-muted px-2 py-0.5 rounded text-xs">
                    {configStatus.filePath}
                  </code>
                ) : (
                  <span className="text-muted-foreground italic">
                    No config file found (using defaults)
                  </span>
                )}
              </div>

              {/* Source Legend */}
              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">Sources:</span>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">ENV</Badge>
                  <span>Environment</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">FILE</Badge>
                  <span>Config file</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">DB</Badge>
                  <span>Database</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">DEFAULT</Badge>
                  <span>Built-in</span>
                </div>
              </div>

              {/* Config Overview */}
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
                  config={configStatus.config.sequencingFiles as Record<string, unknown>}
                  sources={configStatus.sources}
                  prefix="sequencingFiles"
                />
              </div>

              {/* Docs Link */}
              <p className="text-xs text-muted-foreground pt-2">
                See{" "}
                <a
                  href="https://github.com/hzi-bifo/SeqDesk/blob/main/docs/configuration.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  docs/configuration.md
                </a>{" "}
                for configuration options.
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
      </GlassCard>
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
      default: "bg-slate-50 text-slate-700 border-slate-200",
    };
    return (
      <Badge variant="outline" className={`text-[10px] px-1 py-0 ${styles[source] || styles.default}`}>
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
    parentKey: string = ""
  ): Array<{ key: string; path: string; value: unknown }> => {
    const items: Array<{ key: string; path: string; value: unknown }> = [];

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = parentKey ? `${parentKey}.${key}` : key;
      const displayKey = parentKey ? key : key;

      if (value && typeof value === "object" && !Array.isArray(value)) {
        items.push(...flattenConfig(value as Record<string, unknown>, fullPath));
      } else {
        items.push({ key: displayKey, path: fullPath, value });
      }
    }

    return items;
  };

  const items = flattenConfig(config, prefix);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 border-b">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="divide-y">
        {items.map(({ key, path, value }) => (
          <div key={path} className="flex items-center justify-between px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <code className="text-xs text-muted-foreground">{key}</code>
              {getSourceBadge(path)}
            </div>
            <span className="text-right truncate max-w-[50%]" title={renderValue(value)}>
              {renderValue(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
