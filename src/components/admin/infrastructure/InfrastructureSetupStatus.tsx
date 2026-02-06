"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle2, RotateCw } from "lucide-react";

type StatusKey = "dataPath" | "runDir" | "conda" | "weblog";

interface StatusItem {
  key: StatusKey;
  label: string;
  ok: boolean;
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
  const [items, setItems] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mergedFixLinks = useMemo(
    () => ({ ...DEFAULT_FIX_LINKS, ...(fixLinks || {}) }),
    [fixLinks]
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

  const loadStatuses = useCallback(async () => {
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
        label: "Data Path",
        ok: dataPath.ok,
        message: dataPath.message,
        fixHref: mergedFixLinks.dataPath,
      },
      {
        key: "runDir",
        label: "Run Directory",
        ok: runDir.ok,
        message: runDir.message,
        fixHref: mergedFixLinks.runDir,
      },
      {
        key: "conda",
        label: "Conda",
        ok: conda.ok,
        message: conda.message,
        fixHref: mergedFixLinks.conda,
      },
      {
        key: "weblog",
        label: "Weblog",
        ok: weblog.ok,
        message: weblog.message,
        fixHref: mergedFixLinks.weblog,
      },
    ];

    setItems(nextItems);
  }, [mergedFixLinks, testPipelineSetting]);

  const refreshStatuses = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadStatuses();
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
        Checking setup status...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold">Setup Status</h2>
            <p className="text-xs text-muted-foreground">
              Validate key runtime requirements before imports and pipeline runs
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            onClick={() => void refreshStatuses()}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.key}
              className={`rounded-md border px-3 py-2 ${
                item.ok
                  ? "border-green-200 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{item.label}</p>
                  <p className="text-xs mt-0.5 truncate">{item.message}</p>
                </div>
                {item.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-700 flex-shrink-0" />
                )}
              </div>
              {!item.ok && (
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
        <p className="text-xs text-destructive">{loadError}</p>
      )}
    </div>
  );
}
