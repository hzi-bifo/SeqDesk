"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle2, Clock3, RotateCw } from "lucide-react";
import { useModuleEnabled } from "@/lib/modules";

type StatusKey = "dataPath" | "runDir" | "conda" | "weblog";

interface StatusItem {
  key: StatusKey;
  label: string;
  ok: boolean | null;
  message: string;
  fixHref: string;
}

interface SequencingFilesResponse {
  dataBasePath?: string;
  config?: {
    allowedExtensions?: string[];
  };
}

interface ExecutionSettingsResponse {
  settings?: {
    pipelineRunDir?: string;
    condaPath?: string;
    weblogUrl?: string;
    weblogSecret?: string;
  };
}

interface PipelineSettingTestResponse {
  success: boolean;
  message: string;
}

interface PathTestResponse {
  valid: boolean;
  message?: string;
  error?: string;
}

const DEFAULT_FIX_LINKS: Record<StatusKey, string> = {
  dataPath: "/admin/data-storage#required-data-storage",
  runDir: "/admin/pipeline-runtime#required-runtime",
  conda: "/admin/pipeline-runtime#required-runtime",
  weblog: "/admin/pipeline-runtime#advanced-runtime",
};

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function InfrastructureSetupStatus({
  fixLinks,
}: {
  fixLinks?: Partial<Record<StatusKey, string>>;
}) {
  const scanForSequencingFiles = useModuleEnabled("sequencing-management");
  const [items, setItems] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasRunChecks, setHasRunChecks] = useState(false);

  // Parents pass inline fixLinks objects. Depend on the actual hrefs so typing
  // in a settings form does not trigger another request or erase check results.
  const dataPathHref = fixLinks?.dataPath ?? DEFAULT_FIX_LINKS.dataPath;
  const runDirHref = fixLinks?.runDir ?? DEFAULT_FIX_LINKS.runDir;
  const condaHref = fixLinks?.conda ?? DEFAULT_FIX_LINKS.conda;
  const weblogHref = fixLinks?.weblog ?? DEFAULT_FIX_LINKS.weblog;
  const mergedFixLinks = useMemo(
    () => ({ dataPath: dataPathHref, runDir: runDirHref, conda: condaHref, weblog: weblogHref }),
    [dataPathHref, runDirHref, condaHref, weblogHref]
  );

  const testPipelineSetting = useCallback(
    async (
      setting: "pipelineRunDir" | "condaPath" | "weblogUrl",
      value?: string
    ): Promise<PipelineSettingTestResponse> => {
      const res = await fetch("/api/admin/settings/pipelines/test-setting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setting, value }),
      });
      const data = await readJson<PipelineSettingTestResponse | { error?: string }>(res);
      if (!res.ok) {
        return {
          success: false,
          message:
            (data && "error" in data && data.error) ||
            `Request failed (${res.status})`,
        };
      }
      if (!data || !("success" in data) || !("message" in data)) {
        return { success: false, message: "Unexpected response" };
      }
      return data;
    },
    []
  );

  const loadStatuses = useCallback(async (runChecks = false) => {
    setLoadError(null);

    const [seqRes, execRes] = await Promise.all([
      fetch("/api/admin/settings/sequencing-files"),
      fetch("/api/admin/settings/pipelines/execution"),
    ]);

    const seqDataRaw = await readJson<SequencingFilesResponse | { error?: string }>(
      seqRes
    );
    const execDataRaw = await readJson<ExecutionSettingsResponse | { error?: string }>(
      execRes
    );

    if (!seqRes.ok) {
      throw new Error(
        (seqDataRaw && "error" in seqDataRaw && seqDataRaw.error) ||
          "Failed to load data storage settings"
      );
    }
    if (!execRes.ok) {
      throw new Error(
        (execDataRaw && "error" in execDataRaw && execDataRaw.error) ||
          "Failed to load runtime settings"
      );
    }

    const seqData =
      seqDataRaw && "dataBasePath" in seqDataRaw ? seqDataRaw : {};
    const execData =
      execDataRaw && "settings" in execDataRaw ? execDataRaw : {};

    const dataBasePath = seqData?.dataBasePath?.trim() || "";
    const allowedExtensions = seqData?.config?.allowedExtensions || [
      ".fastq.gz",
      ".fq.gz",
    ];
    const pipelineRunDir = execData?.settings?.pipelineRunDir?.trim() || "";
    const condaPath = execData?.settings?.condaPath?.trim() || "";
    const weblogUrl = execData?.settings?.weblogUrl?.trim() || "";
    const weblogSecret = execData?.settings?.weblogSecret || "";

    if (!runChecks) {
      setHasRunChecks(false);
      setItems([
        { key: "dataPath", label: "Data directory", ok: dataBasePath ? null : false, message: dataBasePath ? "Configured · not checked" : "Not configured", fixHref: mergedFixLinks.dataPath },
        { key: "runDir", label: "Pipeline working directory", ok: pipelineRunDir && pipelineRunDir !== "/" ? null : false, message: pipelineRunDir && pipelineRunDir !== "/" ? "Configured · not checked" : "Not configured", fixHref: mergedFixLinks.runDir },
        { key: "conda", label: "Pipeline software (Conda)", ok: null, message: condaPath ? "Configured · not checked" : "Auto-detection · not checked", fixHref: mergedFixLinks.conda },
        { key: "weblog", label: "Run progress connection", ok: weblogUrl ? null : false, message: weblogUrl ? "Configured · not checked" : "Not configured", fixHref: mergedFixLinks.weblog },
      ]);
      return;
    }

    const dataPathStatusPromise = (async () => {
      if (!dataBasePath) {
        return {
          ok: false,
          message: "Not configured",
        };
      }

      const testRes = await fetch("/api/admin/settings/sequencing-files/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basePath: dataBasePath,
          allowedExtensions,
          scanForSequencingFiles,
        }),
      });
      const testData = await readJson<PathTestResponse | { error?: string }>(testRes);

      if (!testRes.ok) {
        return {
          ok: false,
          message:
            (testData && "error" in testData && testData.error) ||
            `Request failed (${testRes.status})`,
        };
      }
      if (!testData || !("valid" in testData)) {
        return { ok: false, message: "Unexpected response" };
      }
      return {
        ok: Boolean(testData.valid),
        message: testData.valid
          ? testData.message || "Directory looks good"
          : testData.error || "Directory check failed",
      };
    })();

    const runDirStatusPromise = (async () => {
      if (!pipelineRunDir || pipelineRunDir === "/") {
        return { ok: false, message: "Not configured" };
      }
      return testPipelineSetting("pipelineRunDir", pipelineRunDir).then((result) => ({
        ok: result.success,
        message: result.message,
      }));
    })();

    const condaStatusPromise = (async () => {
      const result = await testPipelineSetting(
        "condaPath",
        condaPath || undefined
      );
      return {
        ok: result.success,
        message: result.message,
      };
    })();

    const weblogStatusPromise = (async () => {
      if (!weblogUrl) {
        return { ok: false, message: "Not configured" };
      }
      return testPipelineSetting(
        "weblogUrl",
        JSON.stringify({ url: weblogUrl, secret: weblogSecret })
      ).then((result) => ({
        ok: result.success,
        message: result.message,
      }));
    })();

    const [dataPath, runDir, conda, weblog] = await Promise.all([
      dataPathStatusPromise,
      runDirStatusPromise,
      condaStatusPromise,
      weblogStatusPromise,
    ]);

    const nextItems: StatusItem[] = [
      {
        key: "dataPath",
        label: "Data directory",
        ok: dataPath.ok,
        message: dataPath.message,
        fixHref: mergedFixLinks.dataPath,
      },
      {
        key: "runDir",
        label: "Pipeline working directory",
        ok: runDir.ok,
        message: runDir.message,
        fixHref: mergedFixLinks.runDir,
      },
      {
        key: "conda",
        label: "Pipeline software (Conda)",
        ok: conda.ok,
        message: conda.message,
        fixHref: mergedFixLinks.conda,
      },
      {
        key: "weblog",
        label: "Run progress connection",
        ok: weblog.ok,
        message: weblog.message,
        fixHref: mergedFixLinks.weblog,
      },
    ];

    setItems(nextItems);
    setHasRunChecks(true);
  }, [mergedFixLinks, scanForSequencingFiles, testPipelineSetting]);

  const refreshStatuses = useCallback(async (runChecks = false) => {
    setRefreshing(true);
    try {
      await loadStatuses(runChecks);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Failed to refresh setup status"
      );
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [loadStatuses]);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading saved configuration...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold">Storage &amp; pipeline checks</h2>
            <p className="text-xs text-muted-foreground">
              {hasRunChecks ? "Checks use the saved configuration, not unsaved edits in this form." : "Saved configuration only. Run checks to test directory access, pipeline software and the configured progress connection."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="bg-card"
            onClick={() => void refreshStatuses(true)}
            disabled={refreshing}
            aria-label="Run storage and pipeline checks"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
            {refreshing ? "Checking…" : hasRunChecks ? "Run checks again" : "Run checks"}
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.key}
              className={`rounded-md border px-3 py-2 ${
                item.ok === null
                  ? "border-border bg-card"
                  : item.ok
                  ? "border-green-200 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{item.label}</p>
                  <p className="text-xs mt-0.5 break-words">{item.message}</p>
                </div>
                {item.ok === null ? (
                  <Clock3 className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-label="Not checked" />
                ) : item.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-700 flex-shrink-0" />
                )}
              </div>
              {item.ok === false && (
                <div className="mt-2">
                  <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                    <Link href={item.fixHref}>Fix</Link>
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {loadError && (
        <p role="alert" className="text-xs text-destructive">{loadError}</p>
      )}
    </div>
  );
}
