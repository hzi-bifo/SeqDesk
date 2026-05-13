"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  Download,
  FileText,
  HardDrive,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  currentDatabaseProvider?: "postgresql" | "sqlite" | "unknown";
  databaseCompatible?: boolean;
  databaseCompatibilityError?: string;
  latest?: {
    version: string;
    releaseNotes?: string;
    downloadUrl?: string;
    databaseRequirement?: "postgresql";
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

interface AccessSettingsResponse {
  orderNotesEnabled?: boolean;
}

interface TelemetrySettingsResponse {
  enabled: boolean;
  endpoint: string;
  intervalHours: number;
  instanceId: string | null;
  clientTokenConfigured: boolean;
  lastSentAt: string | null;
  lastError: string | null;
  lastStatus: number | null;
  promptDismissed: boolean;
}

interface GemmaMetaxPathSeedStatus {
  seeded: boolean;
  orderNumber: string;
  orderId: string | null;
  orderStatus: string | null;
  studyId: string | null;
  samplesCount: number;
  readsCount: number;
  sourceUrl: string;
  sha256: string;
}

interface InstallProfileSummary {
  id?: string;
  name?: string;
  version?: string;
  minSeqDeskVersion?: string;
  appliedAt?: string;
  source?: string;
}

interface InstallProfileReloadStatus {
  profile: InstallProfileSummary | null;
  profileRegistryUrl: string;
  profileCodeEnvName: string | null;
  profileCodeEnvAvailable: boolean;
}

interface ScriptRunSummary {
  script: string;
  stdout: string;
  stderr: string;
}

interface InstallProfileReloadResult {
  success?: boolean;
  profile?: InstallProfileSummary;
  includeAssets?: boolean;
  settings?: ScriptRunSummary;
  assets?: ScriptRunSummary;
  error?: string;
}

function formatDate(value?: string | Date | null): string {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export default function SettingsPage() {
  const [detectedVersions, setDetectedVersions] = useState<ToolVersions>({});
  const [detectingVersions, setDetectingVersions] = useState(false);
  const [versionsLoaded, setVersionsLoaded] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const [configStatus, setConfigStatus] = useState<ConfigStatusResponse | null>(
    null
  );
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateProgress | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateLoaded, setUpdateLoaded] = useState(false);
  const [installProfileStatus, setInstallProfileStatus] =
    useState<InstallProfileReloadStatus | null>(null);
  const [loadingInstallProfileStatus, setLoadingInstallProfileStatus] =
    useState(false);
  const [installProfileLoaded, setInstallProfileLoaded] = useState(false);
  const [installProfileStatusError, setInstallProfileStatusError] =
    useState<string | null>(null);
  const [profileReloadDialogOpen, setProfileReloadDialogOpen] = useState(false);
  const [profileAccessCode, setProfileAccessCode] = useState("");
  const [reloadProfileIncludeAssets, setReloadProfileIncludeAssets] =
    useState(false);
  const [reloadingHostedProfile, setReloadingHostedProfile] = useState(false);
  const [profileReloadResult, setProfileReloadResult] =
    useState<InstallProfileReloadResult | null>(null);
  const [orderNotesEnabled, setOrderNotesEnabled] = useState(true);
  const [telemetrySettings, setTelemetrySettings] =
    useState<TelemetrySettingsResponse | null>(null);
  const [loadingAccessSettings, setLoadingAccessSettings] = useState(false);
  const [savingOrderNotesSetting, setSavingOrderNotesSetting] = useState(false);
  const [savingTelemetrySetting, setSavingTelemetrySetting] = useState(false);
  const [testingTelemetry, setTestingTelemetry] = useState(false);
  const [applyingOntRunPreset, setApplyingOntRunPreset] = useState(false);
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  const [seedStatus, setSeedStatus] = useState<{
    seeded: boolean;
    ordersCount: number;
    dummyDataEnabled: boolean | null;
  } | null>(null);
  const [gemmaSeedStatus, setGemmaSeedStatus] =
    useState<GemmaMetaxPathSeedStatus | null>(null);
  const [seedStatusError, setSeedStatusError] = useState<string | null>(null);
  const [gemmaSeedStatusError, setGemmaSeedStatusError] = useState<string | null>(null);
  const [seedingDummy, setSeedingDummy] = useState(false);
  const [seedingGemma, setSeedingGemma] = useState(false);
  const [wipingDummy, setWipingDummy] = useState(false);
  const [wipeDialogOpen, setWipeDialogOpen] = useState(false);

  const [refreshingAll, setRefreshingAll] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [showConfigDetails, setShowConfigDetails] = useState(false);
  const [diagnosticsText, setDiagnosticsText] = useState<string | null>(null);

  const updatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartTargetRef = useRef<string | null>(null);
  const diagnosticsTextRef = useRef<HTMLTextAreaElement | null>(null);

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
  const showTelemetryPrompt =
    telemetrySettings !== null &&
    telemetrySettings.enabled !== true &&
    telemetrySettings.promptDismissed !== true;
  const currentInstallProfile = installProfileStatus?.profile || null;
  const installProfileEnvHint = installProfileStatus?.profileCodeEnvName || null;
  const canSubmitProfileReload = Boolean(currentInstallProfile?.id) && (
    installProfileStatus?.profileCodeEnvAvailable === true ||
    profileAccessCode.trim().length > 0
  );

  const toolsMissingCount = useMemo(() => {
    if (!versionsLoaded) return null;
    const requiredTools: Array<keyof ToolVersions> = [
      "nextflow",
      "java",
      "nfcore",
      "conda",
    ];
    return requiredTools.filter((tool) => !detectedVersions[tool]).length;
  }, [detectedVersions, versionsLoaded]);

  const healthItems = useMemo(() => {
    const updateState = updateInProgress
      ? "warning"
      : updateInfo?.error
        ? "error"
        : !updateLoaded || checkingUpdate
          ? "pending"
          : updateInfo?.updateAvailable || restartPending
            ? "warning"
            : "ok";
    const runtimeState = versionsError
      ? "error"
      : !versionsLoaded || detectingVersions
        ? "pending"
        : toolsMissingCount && toolsMissingCount > 0
          ? "warning"
          : "ok";
    const configState = configError
      ? "error"
      : !configLoaded || loadingConfig
        ? "pending"
        : "ok";
    const workspaceState = accessError
      ? "error"
      : !accessLoaded || loadingAccessSettings
        ? "pending"
        : "ok";

    return [
      {
        id: "updates",
        label: "Updates",
        state: updateState,
        detail: updateInProgress
          ? updateStatus?.message || "Update is running"
          : updateInfo?.error
            ? "Update check failed"
            : updateInfo?.updateAvailable
              ? `v${latestVersion} available`
              : restartPending
                ? "Restart pending"
                : updateLoaded
                  ? "Up to date"
                  : "Checking",
      },
      {
        id: "runtime",
        label: "Runtime",
        state: runtimeState,
        detail: versionsError
          ? "Tool scan failed"
          : toolsMissingCount && toolsMissingCount > 0
            ? `${toolsMissingCount} missing`
            : versionsLoaded
              ? "Tools detected"
              : "Scanning",
      },
      {
        id: "config",
        label: "Config",
        state: configState,
        detail: configError
          ? "Config status failed"
          : configLoaded
            ? "Sources loaded"
            : "Loading",
      },
      {
        id: "workspace",
        label: "Workspace",
        state: workspaceState,
        detail: accessError
          ? "Feature settings failed"
          : accessLoaded
            ? "Feature flags loaded"
            : "Loading",
      },
    ] as const;
  }, [
    accessError,
    accessLoaded,
    checkingUpdate,
    configError,
    configLoaded,
    detectingVersions,
    latestVersion,
    loadingAccessSettings,
    loadingConfig,
    restartPending,
    toolsMissingCount,
    updateInfo?.error,
    updateInfo?.updateAvailable,
    updateInProgress,
    updateLoaded,
    updateStatus?.message,
    versionsError,
    versionsLoaded,
  ]);

  const healthIssueCount = healthItems.filter(
    (item) => item.state === "warning" || item.state === "error"
  ).length;
  const healthPendingCount = healthItems.filter(
    (item) => item.state === "pending"
  ).length;

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
      setConfigError(null);
    } catch (error) {
      console.error("Failed to load config status:", error);
      const message =
        error instanceof Error ? error.message : "Failed to load configuration status";
      setConfigError(message);
      if (showToast) {
        toast.error(message);
      }
    } finally {
      setConfigLoaded(true);
      setLoadingConfig(false);
    }
  }, []);

  const fetchInstallProfileStatus = useCallback(async (showToast = false) => {
    setLoadingInstallProfileStatus(true);
    try {
      const res = await fetch("/api/admin/install-profile/reload");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to load hosted profile status");
      }

      const data = (await res.json()) as InstallProfileReloadStatus;
      setInstallProfileStatus(data);
      setInstallProfileStatusError(null);
    } catch (error) {
      console.error("Failed to load hosted profile status:", error);
      const message =
        error instanceof Error ? error.message : "Failed to load hosted profile status";
      setInstallProfileStatusError(message);
      if (showToast) {
        toast.error(message);
      }
    } finally {
      setInstallProfileLoaded(true);
      setLoadingInstallProfileStatus(false);
    }
  }, []);

  const fetchAccessSettings = useCallback(async (showToast = false) => {
    setLoadingAccessSettings(true);
    try {
      const res = await fetch("/api/admin/settings/access");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to load workspace settings");
      }

      const data = (await res.json()) as AccessSettingsResponse;
      setOrderNotesEnabled(data.orderNotesEnabled !== false);
      setAccessError(null);
    } catch (error) {
      console.error("Failed to load workspace settings:", error);
      const message =
        error instanceof Error ? error.message : "Failed to load workspace settings";
      setAccessError(message);
      if (showToast) {
        toast.error(message);
      }
    } finally {
      setAccessLoaded(true);
      setLoadingAccessSettings(false);
    }
  }, []);

  const fetchTelemetrySettings = useCallback(async (showToast = false) => {
    try {
      const res = await fetch("/api/admin/settings/telemetry");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to load telemetry settings");
      }

      const data = (await res.json()) as TelemetrySettingsResponse;
      setTelemetrySettings(data);
      setTelemetryError(null);
    } catch (error) {
      console.error("Failed to load telemetry settings:", error);
      const message =
        error instanceof Error ? error.message : "Failed to load telemetry settings";
      setTelemetryError(message);
      if (showToast) {
        toast.error(message);
      }
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
        setUpdateLoaded(true);
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
        setUpdateLoaded(true);
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
      setVersionsError(null);
      setVersionsLoaded(true);
    } catch (error) {
      console.error("Failed to detect tool versions:", error);
      const message =
        error instanceof Error ? error.message : "Failed to detect tool versions";
      setVersionsError(message);
      if (showToast) {
        toast.error(message);
      }
    } finally {
      setVersionsLoaded(true);
      setDetectingVersions(false);
    }
  }, []);

  const updateOrderNotesSetting = useCallback(
    async (enabled: boolean) => {
      const previousValue = orderNotesEnabled;
      setOrderNotesEnabled(enabled);
      setSavingOrderNotesSetting(true);

      try {
        const res = await fetch("/api/admin/settings/access", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orderNotesEnabled: enabled,
          }),
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "Failed to save workspace settings");
        }

        toast.success(`Order notes ${enabled ? "enabled" : "disabled"}`);
      } catch (error) {
        console.error("Failed to save workspace settings:", error);
        setOrderNotesEnabled(previousValue);
        toast.error(
          error instanceof Error ? error.message : "Failed to save workspace settings"
        );
      } finally {
        setSavingOrderNotesSetting(false);
      }
    },
    [orderNotesEnabled]
  );

  const updateTelemetrySetting = useCallback(
    async (enabled: boolean, dismissPrompt = false) => {
      const previousValue = telemetrySettings;
      setTelemetrySettings((current) =>
        current
          ? {
              ...current,
              enabled,
              promptDismissed: dismissPrompt ? true : current.promptDismissed,
            }
          : current
      );
      setSavingTelemetrySetting(true);

      try {
        const res = await fetch("/api/admin/settings/telemetry", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enabled,
            ...(dismissPrompt ? { promptDismissed: true } : {}),
          }),
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "Failed to save telemetry settings");
        }

        const data = (await res.json()) as TelemetrySettingsResponse;
        setTelemetrySettings(data);
        setTelemetryError(null);
        toast.success(`Telemetry ${enabled ? "enabled" : "disabled"}`);
      } catch (error) {
        console.error("Failed to save telemetry settings:", error);
        setTelemetrySettings(previousValue);
        toast.error(
          error instanceof Error ? error.message : "Failed to save telemetry settings"
        );
      } finally {
        setSavingTelemetrySetting(false);
      }
    },
    [telemetrySettings]
  );

  const keepTelemetryDisabled = useCallback(async () => {
    const previousValue = telemetrySettings;
    setTelemetrySettings((current) =>
      current ? { ...current, enabled: false, promptDismissed: true } : current
    );
    setSavingTelemetrySetting(true);

    try {
      const res = await fetch("/api/admin/settings/telemetry", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: false, promptDismissed: true }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to save telemetry settings");
      }

      const data = (await res.json()) as TelemetrySettingsResponse;
      setTelemetrySettings(data);
      setTelemetryError(null);
      toast.success("Telemetry kept disabled");
    } catch (error) {
      console.error("Failed to save telemetry settings:", error);
      setTelemetrySettings(previousValue);
      toast.error(
        error instanceof Error ? error.message : "Failed to save telemetry settings"
      );
    } finally {
      setSavingTelemetrySetting(false);
    }
  }, [telemetrySettings]);

  const sendTestTelemetry = useCallback(async () => {
    setTestingTelemetry(true);
    try {
      const res = await fetch("/api/admin/settings/telemetry/test", {
        method: "POST",
      });
      const payload = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string; reason?: string }
        | null;
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.reason || "Failed to send telemetry");
      }
      toast.success("Telemetry heartbeat sent");
      await fetchTelemetrySettings();
    } catch (error) {
      console.error("Failed to send telemetry:", error);
      toast.error(error instanceof Error ? error.message : "Failed to send telemetry");
      await fetchTelemetrySettings();
    } finally {
      setTestingTelemetry(false);
    }
  }, [fetchTelemetrySettings]);

  const applyOntRunPlanPreset = useCallback(async () => {
    setApplyingOntRunPreset(true);
    try {
      const res = await fetch("/api/admin/sequencing-run-form-config/preset", {
        method: "POST",
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            orderFieldsAdded?: number;
            runAssignmentFieldsAdded?: number;
            error?: string;
          }
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to apply preset");
      }
      toast.success(
        `ONT run plan preset applied (${payload?.orderFieldsAdded ?? 0} order/sample fields, ${payload?.runAssignmentFieldsAdded ?? 0} run-assignment fields added)`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply preset");
    } finally {
      setApplyingOntRunPreset(false);
    }
  }, []);

  const fetchSeedStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/seed/dummy-data");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string; dataBasePath?: string }
          | null;
        setSeedStatusError(payload?.error || "Failed to check dummy data state");
        return;
      }
      const data = (await res.json()) as {
        seeded: boolean;
        ordersCount: number;
        dummyDataEnabled?: boolean | null;
      };
      setSeedStatusError(null);
      setSeedStatus({
        seeded: data.seeded,
        ordersCount: data.ordersCount,
        dummyDataEnabled: data.dummyDataEnabled ?? null,
      });
    } catch (error) {
      setSeedStatusError(
        error instanceof Error ? error.message : "Failed to check dummy data state"
      );
    }
  }, []);

  const fetchGemmaSeedStatus = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/admin/seed/example-datasets/gemma-metaxpath"
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string; dataBasePath?: string }
          | null;
        setGemmaSeedStatusError(
          payload?.error || "Failed to check Gemma dataset state"
        );
        return;
      }
      setGemmaSeedStatusError(null);
      setGemmaSeedStatus((await res.json()) as GemmaMetaxPathSeedStatus);
    } catch (error) {
      setGemmaSeedStatusError(
        error instanceof Error ? error.message : "Failed to check Gemma dataset state"
      );
    }
  }, []);

  const seedDummyData = useCallback(async () => {
    setSeedingDummy(true);
    try {
      const res = await fetch("/api/admin/seed/dummy-data", { method: "POST" });
      const payload = (await res.json().catch(() => null)) as
        | {
            success?: boolean;
            ordersCreated?: number;
            samplesCreated?: number;
            readsCreated?: number;
            filesCreated?: number;
            dataPath?: string;
            platform?: {
              instrumentModel?: string;
              pairedEnd?: boolean;
              fromConfiguredDevice?: boolean;
            };
            error?: string;
          }
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to seed dummy data");
      }
      const platform = payload?.platform;
      const platformLabel = platform?.instrumentModel
        ? ` on ${platform.instrumentModel}${
            platform.fromConfiguredDevice ? "" : " (default)"
          }`
        : "";
      toast.success(
        `Seeded ${payload?.ordersCreated ?? 0} orders, ${payload?.samplesCreated ?? 0} samples, ${payload?.readsCreated ?? 0} reads (${payload?.filesCreated ?? 0} FASTQ files)${platformLabel}`
      );
      await fetchSeedStatus();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to seed dummy data"
      );
    } finally {
      setSeedingDummy(false);
    }
  }, [fetchSeedStatus]);

  const seedGemmaMetaxPathData = useCallback(async () => {
    setSeedingGemma(true);
    try {
      const res = await fetch(
        "/api/admin/seed/example-datasets/gemma-metaxpath",
        { method: "POST" }
      );
      const payload = (await res.json().catch(() => null)) as
        | (GemmaMetaxPathSeedStatus & {
            success?: boolean;
            started?: boolean;
            seededFixtures?: number;
            error?: string;
          })
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to seed Gemma dataset");
      }
      if (payload?.started) {
        toast.success("Gemma MetaxPath dataset load started");
      } else {
        toast.success(
          `Gemma MetaxPath dataset loaded: ${payload?.samplesCount ?? 0} samples, ${payload?.readsCount ?? 0} read sets`
        );
      }
      await fetchGemmaSeedStatus();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to seed Gemma dataset"
      );
    } finally {
      setSeedingGemma(false);
    }
  }, [fetchGemmaSeedStatus]);

  const wipeDummyData = useCallback(async () => {
    setWipingDummy(true);
    try {
      const res = await fetch("/api/admin/seed/dummy-data", { method: "DELETE" });
      const payload = (await res.json().catch(() => null)) as
        | { success?: boolean; ordersDeleted?: number; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to wipe seeded data");
      }
      toast.success(
        `Removed ${payload?.ordersDeleted ?? 0} seeded order${
          payload?.ordersDeleted === 1 ? "" : "s"
        } and the seeded study + files`
      );
      setWipeDialogOpen(false);
      await fetchSeedStatus();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to wipe seeded data"
      );
    } finally {
      setWipingDummy(false);
    }
  }, [fetchSeedStatus]);

  const reloadHostedProfile = useCallback(async () => {
    if (!currentInstallProfile?.id || !canSubmitProfileReload) return;

    setReloadingHostedProfile(true);
    setProfileReloadResult(null);
    try {
      const res = await fetch("/api/admin/install-profile/reload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          includeAssets: reloadProfileIncludeAssets,
          profileCode: profileAccessCode.trim() || undefined,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | InstallProfileReloadResult
        | null;
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error || "Failed to reload hosted profile");
      }

      setProfileReloadResult(payload);
      setProfileAccessCode("");
      setProfileReloadDialogOpen(false);
      toast.success(
        `Hosted profile ${payload?.profile?.id || currentInstallProfile.id} applied`
      );
      await Promise.all([
        fetchInstallProfileStatus(),
        fetchConfigStatus(),
        fetchAccessSettings(),
        fetchSeedStatus(),
        fetchGemmaSeedStatus(),
        detectInstalledVersions(),
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reload hosted profile";
      console.error("Failed to reload hosted profile:", error);
      setProfileReloadResult({ success: false, error: message });
      toast.error(message);
    } finally {
      setReloadingHostedProfile(false);
    }
  }, [
    canSubmitProfileReload,
    currentInstallProfile?.id,
    detectInstalledVersions,
    fetchAccessSettings,
    fetchConfigStatus,
    fetchGemmaSeedStatus,
    fetchInstallProfileStatus,
    fetchSeedStatus,
    profileAccessCode,
    reloadProfileIncludeAssets,
  ]);

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
      fetchInstallProfileStatus(true),
      fetchAccessSettings(true),
      fetchTelemetrySettings(true),
      fetchSeedStatus(),
      fetchGemmaSeedStatus(),
      checkForUpdates(true, true),
      fetchUpdateStatus(),
    ]);
    setLastRefreshedAt(new Date());
    setRefreshingAll(false);
  }, [
    checkForUpdates,
    detectInstalledVersions,
    fetchAccessSettings,
    fetchConfigStatus,
    fetchInstallProfileStatus,
    fetchGemmaSeedStatus,
    fetchTelemetrySettings,
    fetchUpdateStatus,
    fetchSeedStatus,
  ]);

  const copyDiagnostics = useCallback(async () => {
    const sourceSummary = Object.values(configStatus?.sources || {}).reduce<
      Record<string, number>
    >((summary, source) => {
      summary[source] = (summary[source] || 0) + 1;
      return summary;
    }, {});

    const diagnostics = {
      generatedAt: new Date().toISOString(),
      seqdesk: {
        runningVersion,
        latestVersion,
        updateLoaded,
        updateAvailable: updateInfo?.updateAvailable ?? null,
        restartPending,
      },
      health: healthItems.map((item) => ({
        area: item.label,
        state: item.state,
        detail: item.detail,
      })),
      runtime: {
        loaded: versionsLoaded,
        missingRequiredTools: toolsMissingCount,
        detectedVersions,
        error: versionsError,
      },
      configuration: {
        loaded: configLoaded,
        filePath: configStatus?.filePath || null,
        loadedAt: configStatus?.loadedAt || null,
        sections: Object.keys(configStatus?.config || {}),
        sourceSummary,
        error: configError,
      },
      featureFlags: {
        loaded: accessLoaded,
        orderNotesEnabled,
        error: accessError,
      },
      telemetry: telemetrySettings
        ? {
            enabled: telemetrySettings.enabled,
            endpoint: telemetrySettings.endpoint,
            intervalHours: telemetrySettings.intervalHours,
            instanceId: telemetrySettings.instanceId,
            lastSentAt: telemetrySettings.lastSentAt,
            lastError: telemetrySettings.lastError,
          }
        : null,
      installProfile: {
        loaded: installProfileLoaded,
        profile: installProfileStatus?.profile ?? null,
        registryUrl: installProfileStatus?.profileRegistryUrl ?? null,
        profileCodeEnvName: installProfileStatus?.profileCodeEnvName ?? null,
        profileCodeEnvAvailable:
          installProfileStatus?.profileCodeEnvAvailable ?? false,
        error: installProfileStatusError,
      },
      updateProgress: updateStatus,
    };

    const text = JSON.stringify(diagnostics, null, 2);

    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(text);
      setDiagnosticsText(null);
      toast.success("Diagnostics copied");
    } catch {
      if (fallbackCopyText(text)) {
        setDiagnosticsText(null);
        toast.success("Diagnostics copied");
        return;
      }
      setDiagnosticsText(text);
      toast.info("Clipboard blocked. Diagnostics are shown below.");
    }
  }, [
    accessError,
    accessLoaded,
    configError,
    configLoaded,
    configStatus,
    detectedVersions,
    healthItems,
    installProfileLoaded,
    installProfileStatus,
    installProfileStatusError,
    latestVersion,
    orderNotesEnabled,
    restartPending,
    runningVersion,
    telemetrySettings,
    toolsMissingCount,
    updateInfo?.updateAvailable,
    updateLoaded,
    updateStatus,
    versionsError,
    versionsLoaded,
  ]);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        detectInstalledVersions(),
        fetchConfigStatus(),
        fetchInstallProfileStatus(),
        fetchAccessSettings(),
        fetchTelemetrySettings(),
        fetchSeedStatus(),
        fetchGemmaSeedStatus(),
        checkForUpdates(true),
        fetchUpdateStatus(),
      ]);
      setLastRefreshedAt(new Date());
    })();
  }, [
    checkForUpdates,
    detectInstalledVersions,
    fetchAccessSettings,
    fetchConfigStatus,
    fetchInstallProfileStatus,
    fetchGemmaSeedStatus,
    fetchSeedStatus,
    fetchTelemetrySettings,
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
    if (
      !updateInfo?.updateAvailable ||
      !updateInfo.latest ||
      updateInfo.databaseCompatible === false
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Update to v${updateInfo.latest.version}?\n\n` +
        `This will:\n` +
        `1. Download the new version\n` +
        `2. Run PostgreSQL migrations\n` +
        `3. Install the update\n` +
        `4. Restart the server\n\n` +
        `Ensure you have a recent database backup before continuing.\n\n` +
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
    <>
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="relative flex items-center justify-center h-[52px] px-6 lg:px-8">
          <span className="text-sm font-medium">Platform Info</span>
        </div>
      </div>
    <PageContainer>
      <div className="mb-6 mt-6">
        <h1 className="text-xl font-semibold">Platform Info</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Creator diagnostics for updates, runtime checks, feature flags, and configuration sources
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
                Running {runningVersion === "unknown" ? "unknown version" : `v${runningVersion}`} •{" "}
                {!updateLoaded
                  ? "Update check pending"
                  : updateInfo?.updateAvailable
                    ? `v${latestVersion} available`
                    : "Up to date"}{" "}
                •{" "}
                {versionsLoaded && toolsMissingCount !== null
                  ? `${toolsMissingCount} tool${toolsMissingCount === 1 ? "" : "s"} missing`
                  : "Tool scan pending"}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => void copyDiagnostics()}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy diagnostics
            </Button>
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

      {diagnosticsText && (
        <section className="bg-card rounded-xl border border-border mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Diagnostics Snapshot</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Clipboard access was blocked; select this text for sharing with maintainers
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => diagnosticsTextRef.current?.select()}
              >
                <Copy className="h-4 w-4 mr-2" />
                Select text
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => setDiagnosticsText(null)}
              >
                <ChevronDown className="h-4 w-4 mr-2" />
                Hide
              </Button>
            </div>
          </div>
          <div className="p-4">
            <textarea
              ref={diagnosticsTextRef}
              readOnly
              value={diagnosticsText}
              className="h-56 w-full resize-y rounded-lg border bg-muted/20 p-3 font-mono text-xs text-foreground outline-none"
              aria-label="Diagnostics snapshot"
            />
          </div>
        </section>
      )}

      <div className="space-y-6">
        {showTelemetryPrompt && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <h2 className="text-base font-semibold text-emerald-950">
                    Help SeqDesk track version adoption and update status
                  </h2>
                </div>
                <p className="mt-2 max-w-3xl text-sm text-emerald-950/80">
                  Optional telemetry sends a small operational heartbeat to SeqDesk.com so we can
                  count active deployments and see which versions are installed. It includes a stable
                  random instance UUID, SeqDesk version and update status, install profile id/version
                  when present, database provider, operating system platform/architecture, Node.js
                  major version, and heartbeat timestamps.
                </p>
                <p className="mt-2 max-w-3xl text-sm text-emerald-950/80">
                  It does not send user accounts, researcher names, order or sample data, uploaded
                  files, pipeline inputs or outputs, file paths, secrets, ENA credentials, or facility
                  contact details. The public receiver stores the UUID and heartbeat fields only; IP
                  addresses are not stored as telemetry application data.
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  className="bg-emerald-700 text-white hover:bg-emerald-800"
                  onClick={() => void updateTelemetrySetting(true, true)}
                  disabled={savingTelemetrySetting || testingTelemetry}
                >
                  {savingTelemetrySetting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Enable telemetry
                </Button>
                <Button
                  variant="outline"
                  className="border-emerald-300 bg-white text-emerald-950"
                  onClick={() => void keepTelemetryDisabled()}
                  disabled={savingTelemetrySetting || testingTelemetry}
                >
                  Keep disabled
                </Button>
              </div>
            </div>
          </section>
        )}

        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Health Overview</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Fast signal for maintainers before testing forms, pipelines, or upload flows
              </p>
            </div>
            <Badge
              variant={healthIssueCount > 0 ? "secondary" : "outline"}
              className="w-fit"
            >
              {healthPendingCount > 0
                ? "Checking diagnostics"
                : healthIssueCount > 0
                ? `${healthIssueCount} item${healthIssueCount === 1 ? "" : "s"} to review`
                : "No issues detected"}
            </Badge>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {healthItems.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border px-3 py-3 ${
                  item.state === "ok"
                    ? "border-emerald-200 bg-emerald-50"
                    : item.state === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : item.state === "error"
                        ? "border-red-200 bg-red-50"
                        : "border-border bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.label}</p>
                  {item.state === "pending" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : item.state === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  ) : (
                    <AlertTriangle
                      className={`h-4 w-4 ${
                        item.state === "error" ? "text-red-700" : "text-amber-700"
                      }`}
                    />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-base font-semibold">Diagnostics Shortcuts</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Open the admin areas most likely to explain broken installs, pipeline runs, or user-facing workflows
            </p>
          </div>
          <div className="p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
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
              <Link href="/admin/form-builder?tab=import-export">
                <span className="inline-flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Order Form
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-between bg-white">
              <Link href="/admin/study-form-builder?tab=import-export">
                <span className="inline-flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Study Forms
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-between bg-white">
              <Link href="/admin/sequencing-run-form-builder">
                <span className="inline-flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Run Fields
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
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-base font-semibold">Feature Flags</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Small switches that change platform behavior and are useful for reproducing user reports
            </p>
          </div>

          <div className="p-4 space-y-3">
            {accessError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <p className="font-medium">Feature settings failed</p>
                <p className="mt-1">{accessError}</p>
              </div>
            )}
            {telemetryError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <p className="font-medium">Telemetry settings failed</p>
                <p className="mt-1">{telemetryError}</p>
              </div>
            )}
            <div className="flex items-start justify-between gap-4 rounded-lg border bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">Order notes</p>
                  {savingOrderNotesSetting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Shows the shared markdown notepad on order pages and disables the notes API when turned off.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {orderNotesEnabled ? "Enabled" : "Disabled"}
                </span>
                <Switch
                  checked={orderNotesEnabled}
                  onCheckedChange={(checked) => void updateOrderNotesSetting(checked)}
                  disabled={loadingAccessSettings || savingOrderNotesSetting}
                  aria-label="Enable order notes"
                />
              </div>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">SeqDesk telemetry</p>
                  {(savingTelemetrySetting || testingTelemetry) && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sends anonymous version and runtime status to SeqDesk.com for install monitoring.
                </p>
                {telemetrySettings && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    <span>ID: {telemetrySettings.instanceId?.slice(0, 8) || "not generated"}</span>
                    <span className="mx-2">•</span>
                    <span>Last sent: {formatDate(telemetrySettings.lastSentAt)}</span>
                    {telemetrySettings.lastError && (
                      <>
                        <span className="mx-2">•</span>
                        <span className="text-red-700">{telemetrySettings.lastError}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  onClick={() => void sendTestTelemetry()}
                  disabled={
                    !telemetrySettings?.enabled ||
                    savingTelemetrySetting ||
                    testingTelemetry
                  }
                >
                  {testingTelemetry ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Test
                </Button>
                <span className="text-xs text-muted-foreground">
                  {telemetrySettings?.enabled ? "Enabled" : "Disabled"}
                </span>
                <Switch
                  checked={telemetrySettings?.enabled === true}
                  onCheckedChange={(checked) => void updateTelemetrySetting(checked)}
                  disabled={
                    !telemetrySettings ||
                    savingTelemetrySetting ||
                    testingTelemetry
                  }
                  aria-label="Enable SeqDesk telemetry"
                />
              </div>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">ONT run plan preset</p>
                  {applyingOntRunPreset && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Adds order, sample, and sequencing run-assignment fields for barcode mapping,
                  flowcell details, and metagenomics/metatranscriptomics tracking.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="shrink-0 bg-white"
                onClick={() => void applyOntRunPlanPreset()}
                disabled={applyingOntRunPreset}
              >
                {applyingOntRunPreset ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                Apply preset
              </Button>
            </div>
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-base font-semibold">Demo data</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Populate this installation with one realistic seeded study and two
              orders (one submitted with synthetic FASTQ files on disk, one draft)
              owned by your admin profile. Useful for demos, screenshots, and
              smoke tests. The platform/instrument is picked from your configured
              sequencer devices.
            </p>
          </div>

          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-4 rounded-lg border bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    Load dummy data
                  </p>
                  {(seedingDummy || wipingDummy) && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {seedStatusError
                    ? seedStatusError
                    : seedStatus === null
                    ? "Checking current state…"
                    : seedStatus.seeded
                      ? `${seedStatus.ordersCount} seeded order${
                          seedStatus.ordersCount === 1 ? "" : "s"
                        } currently loaded for your profile.`
                      : "No seeded data present. Toggle on to create the example dataset."}
                </p>
                {seedStatusError && (
                  <p className="mt-1 text-xs text-destructive">
                    Configure a writable sequencing data path before loading dummy data.
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {seedStatus?.seeded ? "On" : "Off"}
                </span>
                <Switch
                  checked={seedStatus?.seeded === true}
                  onCheckedChange={(checked) => {
                    if (seedStatus === null) return;
                    if (checked && !seedStatus.seeded) {
                      void seedDummyData();
                    } else if (!checked && seedStatus.seeded) {
                      setWipeDialogOpen(true);
                    }
                  }}
                  disabled={
                    seedingDummy || wipingDummy || seedStatus === null || Boolean(seedStatusError)
                  }
                  aria-label="Load dummy data"
                />
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    Gemma Nanopore MetaxPath dataset
                  </p>
                  {seedingGemma && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {gemmaSeedStatusError
                    ? gemmaSeedStatusError
                    : gemmaSeedStatus === null
                    ? "Checking current state..."
                    : gemmaSeedStatus.seeded
                      ? `${gemmaSeedStatus.samplesCount} ONT MinION Mk1D samples loaded in order ${gemmaSeedStatus.orderNumber}.`
                      : "Downloads the verified 580 MB hosted bundle and creates the linked study, submitted order, samples, and cleaned FASTQ read links for MetaxPath."}
                </p>
                {gemmaSeedStatusError && (
                  <p className="mt-1 text-xs text-destructive">
                    Configure a writable sequencing data path before loading this dataset.
                  </p>
                )}
                {gemmaSeedStatus?.seeded && gemmaSeedStatus.orderId && (
                  <Link
                    href={`/orders/${gemmaSeedStatus.orderId}/sequencing?view=analysis`}
                    className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                  >
                    Open order analysis
                  </Link>
                )}
              </div>

              <Button
                variant={gemmaSeedStatus?.seeded ? "outline" : "default"}
                size="sm"
                className="shrink-0"
                onClick={() => void seedGemmaMetaxPathData()}
                disabled={seedingGemma || gemmaSeedStatus === null || Boolean(gemmaSeedStatusError)}
              >
                {seedingGemma ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {gemmaSeedStatus?.seeded ? "Re-seed" : "Load dataset"}
              </Button>
            </div>
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
                <p className="font-medium">Update check failed</p>
                <p className="mt-1">{updateInfo.error}</p>
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

                {updateInfo.updateAvailable &&
                  updateInfo.databaseCompatible === false &&
                  updateInfo.databaseCompatibilityError && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                      <p className="font-medium">Manual database migration required</p>
                      <p className="mt-1">{updateInfo.databaseCompatibilityError}</p>
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
                        {updateInfo.latest.databaseRequirement === "postgresql" && (
                          <p className="text-xs text-blue-800 mt-2">
                            Requires PostgreSQL-backed runtime storage.
                          </p>
                        )}
                        <div className="mt-3">
                          <Button
                            onClick={performUpdate}
                            disabled={
                              updateInProgress ||
                              restartPending ||
                              updateInfo.databaseCompatible === false
                            }
                          >
                            {updateInProgress ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {updateStatus?.message || "Updating..."}
                              </>
                            ) : updateInfo.databaseCompatible === false ? (
                              <>
                                <AlertTriangle className="h-4 w-4 mr-2" />
                                Migration required
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
                  Database backups stay operator-managed. SeqDesk applies PostgreSQL migrations during install.
                </p>
              </>
            ) : checkingUpdate ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {updateLoaded
                  ? "Failed to load update state. Use Check now to retry."
                  : "Update state has not loaded yet."}
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
            {versionsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <p className="font-medium">Tool scan failed</p>
                <p className="mt-1">{versionsError}</p>
              </div>
            )}
            {!versionsLoaded ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Detecting tool versions...
              </div>
            ) : (
              <>
                {toolsMissingCount && toolsMissingCount > 0 ? (
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
              </>
            )}
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Configuration Sources</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Hosted profile, config file, and effective values
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {configStatus && (
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  onClick={() => setShowConfigDetails((visible) => !visible)}
                  aria-expanded={showConfigDetails}
                >
                  <ChevronDown
                    className={`h-4 w-4 mr-2 transition-transform ${
                      showConfigDetails ? "rotate-180" : ""
                    }`}
                  />
                  {showConfigDetails ? "Hide details" : "Show details"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => {
                  void Promise.all([
                    fetchInstallProfileStatus(true),
                    fetchConfigStatus(true),
                  ]);
                }}
                disabled={loadingConfig || loadingInstallProfileStatus}
              >
                {loadingConfig || loadingInstallProfileStatus ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh
              </Button>
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <p className="font-medium">How SeqDesk resolves settings</p>
              <p className="mt-1 text-blue-800">
                Hosted profiles are managed baselines. Effective config is resolved as{" "}
                <span className="font-mono">ENV &gt; FILE &gt; DATABASE &gt; DEFAULT</span>,
                so environment variables and{" "}
                <span className="font-mono">seqdesk.config.json</span> override
                database/profile-managed values.
              </p>
              <p className="mt-1 text-xs text-blue-800">
                Reloading a hosted profile reapplies profile-managed forms, modules,
                and pipeline settings, but it does not replace env/file-backed overrides.
              </p>
            </div>

            <div className="rounded-lg border bg-white px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Hosted install profile</p>
                    {loadingInstallProfileStatus && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                    {currentInstallProfile?.id && (
                      <Badge variant="outline">{currentInstallProfile.id}</Badge>
                    )}
                    {currentInstallProfile?.version && (
                      <Badge variant="secondary">v{currentInstallProfile.version}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {installProfileStatusError
                      ? installProfileStatusError
                      : !installProfileLoaded
                        ? "Checking hosted profile state..."
                        : currentInstallProfile?.id
                          ? `Reload ${currentInstallProfile.name || currentInstallProfile.id} from the hosted profile registry to reapply profile-managed settings.`
                          : "No hosted install profile is recorded for this installation."}
                  </p>
                  {currentInstallProfile?.appliedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last applied: {formatDate(currentInstallProfile.appliedAt)}
                      {currentInstallProfile.source
                        ? ` from ${currentInstallProfile.source}`
                        : ""}
                    </p>
                  )}
                  {installProfileStatus?.profileRegistryUrl && (
                    <p className="mt-1 text-xs text-muted-foreground break-all">
                      Registry:{" "}
                      <span className="font-mono">
                        {installProfileStatus.profileRegistryUrl}
                      </span>
                    </p>
                  )}
                  {profileReloadResult?.success === false && profileReloadResult.error && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      <p className="font-medium">Profile reload failed</p>
                      <p className="mt-1">{profileReloadResult.error}</p>
                    </div>
                  )}
                  {profileReloadResult?.success && (
                    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                      <p className="font-medium">Hosted profile applied</p>
                      <p className="mt-1 text-xs text-emerald-800">
                        Settings script completed
                        {profileReloadResult.includeAssets
                          ? " and assets were applied."
                          : "."}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white"
                    onClick={() => void fetchInstallProfileStatus(true)}
                    disabled={loadingInstallProfileStatus || reloadingHostedProfile}
                  >
                    {loadingInstallProfileStatus ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Refresh profile
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setProfileReloadResult(null);
                      setProfileReloadDialogOpen(true);
                    }}
                    disabled={
                      !currentInstallProfile?.id ||
                      loadingInstallProfileStatus ||
                      reloadingHostedProfile
                    }
                  >
                    {reloadingHostedProfile ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Reload hosted profile
                  </Button>
                </div>
              </div>
            </div>

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

                {showConfigDetails && (
                  <>
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
                  </>
                )}

                <p className="text-xs text-muted-foreground">
                  See{" "}
                  <a
                    href="https://www.seqdesk.com/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    seqdesk.com/docs
                  </a>{" "}
                  for all configuration options.
                </p>
              </div>
            ) : loadingConfig ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <p className="font-medium">Configuration status failed</p>
                <p className="mt-1">
                  {configError || "Use Refresh to retry loading effective configuration sources."}
                </p>
              </div>
            )}
          </div>
        </section>

        {process.env.NODE_ENV === "development" && (
          <section className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  Development
                  <Badge variant="warning">dev only</Badge>
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Browse internal pages with mocked state. Hidden in production builds.
                </p>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="eyebrow mb-2">Setup page scenarios</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Open <code className="font-mono">/setup</code> with a forced state instead of waiting for real polling outcomes.
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { key: "loading", label: "Loading", detail: "Initial check" },
                    { key: "connecting", label: "Connecting", detail: "DB not yet reachable" },
                    { key: "seeding", label: "Seeding", detail: "DB ready, data being created" },
                    { key: "configured", label: "Configured", detail: "Both checks pass" },
                    { key: "failed", label: "Failed (DB ready)", detail: "Auto-seed timed out" },
                    { key: "failed-no-db", label: "Failed (no DB)", detail: "DB missing" },
                    { key: "error", label: "Error", detail: "Connection error message" },
                  ].map((scenario) => (
                    <Button
                      key={scenario.key}
                      asChild
                      variant="outline"
                      className="justify-between bg-white h-auto py-2"
                    >
                      <Link href={`/setup?preview=${scenario.key}`} target="_blank">
                        <span className="flex flex-col items-start text-left">
                          <span className="text-sm font-medium">
                            {scenario.label}
                          </span>
                          <span className="text-xs text-muted-foreground font-normal">
                            {scenario.detail}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0" />
                      </Link>
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <p className="eyebrow mb-2">Live pages</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Button
                    asChild
                    variant="outline"
                    className="justify-between bg-white"
                  >
                    <Link href="/setup" target="_blank">
                      <span className="inline-flex items-center gap-2">
                        <Server className="h-4 w-4" />
                        Setup (real polling)
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="justify-between bg-white"
                  >
                    <Link href="/login" target="_blank">
                      <span className="inline-flex items-center gap-2">
                        <Server className="h-4 w-4" />
                        Login
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      <Dialog
        open={profileReloadDialogOpen}
        onOpenChange={(open) => {
          if (reloadingHostedProfile) return;
          setProfileReloadDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reload hosted install profile?</DialogTitle>
            <DialogDescription>
              This fetches the hosted profile for{" "}
              <span className="font-mono">
                {currentInstallProfile?.id || "this installation"}
              </span>{" "}
              and reapplies profile-managed settings, form presets, and pipeline
              enablement. Existing orders, samples, users, and sequencing files are not
              deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">Profile settings will be overwritten</p>
              <p className="mt-1">
                Values controlled by the hosted profile will be set back to the
                currently published profile. Local edits outside that profile remain
                operator-managed.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-access-code" className="text-sm font-medium">
                Profile access code
              </label>
              <Input
                id="profile-access-code"
                type="password"
                value={profileAccessCode}
                onChange={(event) => setProfileAccessCode(event.target.value)}
                placeholder={
                  installProfileStatus?.profileCodeEnvAvailable && installProfileEnvHint
                    ? `Optional; server can use ${installProfileEnvHint}`
                    : "Enter hosted profile setup code"
                }
                disabled={reloadingHostedProfile}
              />
              <p className="text-xs text-muted-foreground">
                {installProfileEnvHint
                  ? installProfileStatus?.profileCodeEnvAvailable
                    ? `The server environment already provides ${installProfileEnvHint}.`
                    : `Leave empty only if ${installProfileEnvHint}, SEQDESK_PROFILE_CODE, or SEQDESK_KEY is set on the server.`
                  : "No recorded profile id was found, so SeqDesk cannot infer a profile-specific setup-code variable."}
              </p>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border bg-white px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Apply profile assets</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Also apply database assets and seed fixtures from the profile. This can
                  download large files or reuse configured local paths.
                </p>
              </div>
              <Switch
                checked={reloadProfileIncludeAssets}
                onCheckedChange={setReloadProfileIncludeAssets}
                disabled={reloadingHostedProfile}
                aria-label="Apply hosted profile assets"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProfileReloadDialogOpen(false)}
              disabled={reloadingHostedProfile}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void reloadHostedProfile()}
              disabled={!canSubmitProfileReload || reloadingHostedProfile}
            >
              {reloadingHostedProfile ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Apply hosted profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={wipeDialogOpen} onOpenChange={setWipeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wipe seeded dummy data?</DialogTitle>
            <DialogDescription>
              This permanently removes the {seedStatus?.ordersCount ?? 0} seeded
              order{seedStatus?.ordersCount === 1 ? "" : "s"}, the seeded study,
              all linked samples and reads, and the on-disk FASTQ folder created
              for your admin profile. Other orders, studies, and files are not
              touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWipeDialogOpen(false)}
              disabled={wipingDummy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void wipeDummyData()}
              disabled={wipingDummy}
            >
              {wipingDummy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Wipe seeded data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
    </>
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
