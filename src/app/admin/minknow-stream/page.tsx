"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { notifyPanel } from "@/lib/notifications/client";
import { toast } from "@/components/ui/toast";
import { PageLoader } from "@/components/ui/page-loader";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { HelpBox } from "@/components/ui/help-box";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Radio,
  Loader2,
  CheckCircle2,
  XCircle,
  FolderOpen,
  Power,
  ShieldCheck,
  Check,
  Activity,
  Play,
  ExternalLink,
  AlertTriangle,
  FlaskConical,
} from "lucide-react";

interface MinknowStreamConfig {
  enabled: boolean;
  host: string;
  grpcPort: number;
  tlsCaCertPath: string;
  outputRoot: string;
  pollIntervalMs: number;
}

const DEFAULT: MinknowStreamConfig = {
  enabled: false,
  host: "localhost",
  grpcPort: 9501,
  tlsCaCertPath: "",
  outputRoot: "",
  pollIntervalMs: 5000,
};

interface CheckResult {
  ok: boolean;
  detail: string;
}

interface TestResult {
  overallOk: boolean;
  checks: {
    outputDir: CheckResult;
    grpcPort: CheckResult;
    tlsCert: CheckResult;
  };
}

interface WorkerStatus {
  status: string;
  pid: number | null;
  startedAt: string | null;
  lastErrorMsg: string | null;
  paused: boolean;
}

function formatRelative(ts: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function MinknowStreamSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<MinknowStreamConfig>(DEFAULT);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [simulator, setSimulator] = useState<WorkerStatus | null>(null);
  const [simulatorAvailable, setSimulatorAvailable] = useState(false);
  const [startingWorker, setStartingWorker] = useState(false);
  const [applyingSimulator, setApplyingSimulator] = useState(false);

  const refreshWorker = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/workers");
      if (!res.ok) return;
      const data = (await res.json()) as {
        workers: Array<{
          name: string;
          paused: boolean;
          latest: {
            status: string;
            pid: number;
            startedAt: string;
            lastErrorMsg: string | null;
          } | null;
        }>;
      };
      const monitor = data.workers.find((w) => w.name === "stream-monitor");
      if (monitor) {
        setWorker({
          status: monitor.latest?.status ?? "STOPPED",
          pid: monitor.latest?.pid ?? null,
          startedAt: monitor.latest?.startedAt ?? null,
          lastErrorMsg: monitor.latest?.lastErrorMsg ?? null,
          paused: monitor.paused,
        });
      } else {
        setWorker(null);
      }
      const sim = data.workers.find((w) => w.name === "stream-simulator");
      setSimulatorAvailable(!!sim);
      if (sim) {
        setSimulator({
          status: sim.latest?.status ?? "STOPPED",
          pid: sim.latest?.pid ?? null,
          startedAt: sim.latest?.startedAt ?? null,
          lastErrorMsg: sim.latest?.lastErrorMsg ?? null,
          paused: sim.paused,
        });
      } else {
        setSimulator(null);
      }
    } catch (error) {
      console.error("Failed to load worker status:", error);
    }
  }, []);

  useEffect(() => {
    void refreshWorker();
    const handle = setInterval(() => void refreshWorker(), 5000);
    return () => clearInterval(handle);
  }, [refreshWorker]);

  const handleStartWorker = async () => {
    setStartingWorker(true);
    try {
      const res = await fetch("/api/admin/workers/stream-monitor/start", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      toast.success("Stream monitor started");
      await refreshWorker();
    } catch (error) {
      toast.error(`Start failed: ${(error as Error).message}`);
    } finally {
      setStartingWorker(false);
    }
  };

  const applySimulatorPreset = async () => {
    setApplyingSimulator(true);
    try {
      // 1. Point the config at the simulator's output dir and enable ingestion.
      const newConfig: MinknowStreamConfig = {
        ...config,
        outputRoot: "/tmp/seqdesk-sim",
        enabled: true,
      };
      setConfig(newConfig);
      const saveRes = await fetch("/api/admin/settings/minknow", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: newConfig }),
      });
      if (!saveRes.ok) {
        const errBody = await saveRes.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `Save failed: HTTP ${saveRes.status}`);
      }

      // 2. Make sure stream-monitor is running (it does the ingest).
      if (!worker || worker.status !== "RUNNING") {
        const r = await fetch("/api/admin/workers/stream-monitor/start", { method: "POST" });
        const b = await r.json().catch(() => ({}));
        if (!r.ok && r.status !== 409) {
          throw new Error(b?.error ?? `stream-monitor start failed: HTTP ${r.status}`);
        }
      }

      // 3. Start the simulator if not running. 409 means already running — fine.
      if (!simulator || simulator.status !== "RUNNING") {
        const r = await fetch("/api/admin/workers/stream-simulator/start", { method: "POST" });
        const b = await r.json().catch(() => ({}));
        if (!r.ok && r.status !== 409) {
          throw new Error(b?.error ?? `stream-simulator start failed: HTTP ${r.status}`);
        }
      }

      toast.success("Simulator preset applied — mock FASTQ files will appear in a few seconds");
      await refreshWorker();
    } catch (error) {
      toast.error(`Preset failed: ${(error as Error).message}`);
    } finally {
      setApplyingSimulator(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      const res = await fetch("/api/admin/settings/minknow");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      if (data.config) setConfig({ ...DEFAULT, ...data.config });
    } catch (error) {
      console.error("Failed to load minknow settings:", error);
      notifyPanel.error("Failed to load MinKNOW stream settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/minknow", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("MinKNOW stream settings saved");
    } catch (error) {
      console.error("Save failed:", error);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/minknow/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: config.host,
          grpcPort: config.grpcPort,
          outputRoot: config.outputRoot,
          tlsCaCertPath: config.tlsCaCertPath,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as TestResult;
      setTestResult(data);
      if (data.overallOk) {
        toast.success("Connection test passed");
      } else {
        const failed = (["outputDir", "grpcPort", "tlsCert"] as const)
          .filter((k) => !data.checks[k].ok)
          .map((k) =>
            k === "outputDir" ? "output dir" : k === "grpcPort" ? "gRPC port" : "TLS cert",
          )
          .join(", ");
        toast.error(`Connection test failed: ${failed}`);
      }
      // Scroll the result panel into view so the user sees the breakdown.
      requestAnimationFrame(() => {
        document
          .getElementById("connection-test-results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      console.error("Test failed:", error);
      toast.error(`Connection test failed: ${(error as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <PageLoader />;
  }

  const checkLabels: Record<"outputDir" | "grpcPort" | "tlsCert", { label: string; hint: string }> = {
    outputDir: {
      label: "Output directory",
      hint: "The stream-monitor process can read this folder.",
    },
    grpcPort: {
      label: "gRPC port",
      hint: "TCP connect succeeds — MinKNOW or a MinKNOW-compatible service is listening.",
    },
    tlsCert: {
      label: "TLS CA cert",
      hint: "If you provided a path, it is readable. Skipped if left blank.",
    },
  };

  return (
    <>
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="relative flex h-[52px] items-center justify-center px-6 lg:px-8">
          <span className="text-sm font-medium">MinKNOW Stream</span>
        </div>
        <div className="flex min-h-12 flex-col gap-2 border-t border-border/60 px-4 py-2 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="text-xs text-muted-foreground">
            {(() => {
              const daemonRunning = worker?.status === "RUNNING";
              const toggleOn = config.enabled;
              if (worker == null) {
                return <>Stream monitor: <span className="text-muted-foreground">loading…</span></>;
              }
              if (daemonRunning && toggleOn) {
                return <>Stream monitor: <span className="text-green-600 font-medium">ingesting</span></>;
              }
              if (daemonRunning && !toggleOn) {
                return (
                  <>
                    Stream monitor: <span className="text-amber-600 font-medium">running, ingestion paused</span>
                  </>
                );
              }
              return <>Stream monitor: <span className="text-red-600 font-medium">daemon stopped</span></>;
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Test connection
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Save settings
            </Button>
          </div>
        </div>
      </div>

      <PageContainer>
        <div className="space-y-8">
          <div className="mb-4 mt-6">
            <h1 className="text-xl font-semibold">MinKNOW Stream</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure direct ingest from a MinION (or other Oxford Nanopore device) running MinKNOW
            </p>
          </div>

        <HelpBox title="How it works">
          When configured, facility admins can attach a running MinKNOW sequencing run to an order from
          Sequencing Data &rarr; Stream. A long-lived stream-monitor daemon (started outside the web app via
          <code className="font-mono"> npm run stream:monitor</code>) watches the output folder and links new
          FASTQ files to samples by barcode as MinKNOW writes them. This admin form records the configuration
          the daemon reads on startup — if the daemon isn&apos;t running, nothing is ingested even when the
          form below is saved. Point the output root at the parent directory MinKNOW writes runs into, not a
          specific run folder.
        </HelpBox>

        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">Daemon process</h2>
            <Badge variant="secondary">Required</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            The long-lived <code className="font-mono">stream-monitor</code> process must be running for any
            file to be ingested &mdash; the form below only records configuration the daemon reads on startup.
          </p>

          <GlassCard className="p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">MinKNOW stream monitor</span>
                  {worker == null ? (
                    <Badge variant="secondary">Loading…</Badge>
                  ) : worker.paused && (worker.status === "RUNNING" || worker.status === "STOPPING") ? (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
                      Paused
                    </Badge>
                  ) : worker.status === "RUNNING" ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Running</Badge>
                  ) : worker.status === "STOPPING" ? (
                    <Badge variant="secondary">Stopping…</Badge>
                  ) : worker.status === "ERROR" ? (
                    <Badge variant="destructive">Error</Badge>
                  ) : worker.status === "ZOMBIE" ? (
                    <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200">
                      Zombie
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Stopped</Badge>
                  )}
                </div>
                {worker?.status === "RUNNING" && worker.pid != null && worker.startedAt ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    pid {worker.pid} &middot; started {formatRelative(worker.startedAt)}
                  </p>
                ) : worker?.status === "STOPPED" ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    Not running &mdash; no files will be ingested.
                  </p>
                ) : null}
                {worker?.lastErrorMsg ? (
                  <p className="mt-2 flex items-start gap-1 text-xs text-red-600">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span className="break-all">{worker.lastErrorMsg}</span>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {worker && worker.status !== "RUNNING" && worker.status !== "STOPPING" ? (
                  <Button size="sm" onClick={handleStartWorker} disabled={startingWorker}>
                    {startingWorker ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Start
                  </Button>
                ) : null}
                <Button asChild variant="outline" size="sm" className="bg-white">
                  <Link href="/admin/background-workers">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Manage in Background Workers
                  </Link>
                </Button>
              </div>
            </div>
          </GlassCard>
        </div>

        {simulatorAvailable ? (
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                <FlaskConical className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="text-base font-semibold">Test without a real MinION</h2>
              <Badge variant="outline">Dev only</Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              One-click setup that points the output root at <code className="font-mono">/tmp/seqdesk-sim</code>,
              turns ingestion on, and starts the stream simulator. The simulator drips mock FASTQ files into that
              directory every few seconds so you can exercise the Stream view end-to-end without hardware.
            </p>

            <GlassCard className="p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">Stream simulator</span>
                    {simulator == null ? (
                      <Badge variant="secondary">Loading…</Badge>
                    ) : simulator.status === "RUNNING" ? (
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Running</Badge>
                    ) : simulator.status === "ERROR" ? (
                      <Badge variant="destructive">Error</Badge>
                    ) : (
                      <Badge variant="secondary">Stopped</Badge>
                    )}
                  </div>
                  {simulator?.status === "RUNNING" && simulator.pid != null && simulator.startedAt ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      pid {simulator.pid} &middot; started {formatRelative(simulator.startedAt)} &middot; writing
                      to <code className="font-mono">/tmp/seqdesk-sim</code>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Not running &mdash; no mock files are being generated.
                    </p>
                  )}
                  {simulator?.lastErrorMsg ? (
                    <p className="mt-2 flex items-start gap-1 text-xs text-red-600">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="break-all">{simulator.lastErrorMsg}</span>
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={applySimulatorPreset} disabled={applyingSimulator}>
                    {applyingSimulator ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Use simulator preset
                  </Button>
                </div>
              </div>
            </GlassCard>
          </div>
        ) : null}

        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <Power className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">Stream monitor toggle</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Soft toggle &mdash; the daemon checks this on each tick and pauses ingestion when off, so you can
            stop ingestion without killing the process. Disable while reconfiguring the output root.
          </p>

          <GlassCard className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="enabled" className="text-base font-medium">
                  Enable stream monitor
                </Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Currently {config.enabled ? "active — ingestion is running" : "paused — no files are being ingested"}.
                </p>
              </div>
              <Switch
                id="enabled"
                checked={config.enabled}
                onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
              />
            </div>
          </GlassCard>
        </div>

        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">Filesystem watcher</h2>
            <Badge variant="secondary">Required</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Where the daemon looks for MinKNOW output, and how often it reconciles its watcher set.
          </p>

          <GlassCard className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="outputRoot" className="text-base font-medium">
                  MinKNOW output root
                </Label>
                <p className="text-sm text-muted-foreground">
                  Absolute path to the parent directory MinKNOW writes runs into. The daemon must have read
                  access; for network-separated setups, expose it via NFS or SMB and mount on the SeqDesk host.
                </p>
                <Input
                  id="outputRoot"
                  placeholder="/data"
                  value={config.outputRoot}
                  onChange={(e) => setConfig({ ...config, outputRoot: e.target.value })}
                />
                <ul className="list-disc list-inside ml-1 text-xs text-muted-foreground space-y-0.5">
                  <li>Linux: <code className="font-mono">/data</code></li>
                  <li>macOS: <code className="font-mono">/Library/MinKNOW/data</code></li>
                  <li>Windows: <code className="font-mono">C:\data</code></li>
                </ul>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pollIntervalMs" className="text-base font-medium">
                  Poll interval (ms)
                </Label>
                <p className="text-sm text-muted-foreground">
                  How often the daemon reconciles its watcher set against active streams. The filesystem
                  watcher itself is event-driven, so this only affects how quickly newly started/stopped
                  streams are picked up. 5000&ndash;15000&nbsp;ms is a sensible range.
                </p>
                <Input
                  id="pollIntervalMs"
                  type="number"
                  min={1000}
                  step={500}
                  value={config.pollIntervalMs}
                  onChange={(e) => setConfig({ ...config, pollIntervalMs: Number(e.target.value) })}
                />
              </div>
            </div>
          </GlassCard>
        </div>

        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <Radio className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">MinKNOW gRPC connection</h2>
            <Badge variant="outline">Optional</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Used for live status enrichment only &mdash; ingestion works without it. Provides the
            &ldquo;sequencer connected&rdquo; banner and live pore metrics in the order Stream view.
          </p>

          <GlassCard className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="host" className="text-base font-medium">
                  MinKNOW host
                </Label>
                <p className="text-sm text-muted-foreground">
                  Hostname of the workstation running MinKNOW. Use <code className="font-mono">localhost</code>
                  {" "}if SeqDesk and MinKNOW share a machine.
                </p>
                <Input
                  id="host"
                  placeholder="localhost"
                  value={config.host}
                  onChange={(e) => setConfig({ ...config, host: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="grpcPort" className="text-base font-medium">
                  gRPC port
                </Label>
                <p className="text-sm text-muted-foreground">
                  MinKNOW&apos;s manager service. Default <code className="font-mono">9501</code> for secure
                  gRPC, <code className="font-mono">9502</code> for gRPC-Web. The Test connection button uses a
                  plain TCP probe.
                </p>
                <Input
                  id="grpcPort"
                  type="number"
                  min={1}
                  max={65535}
                  value={config.grpcPort}
                  onChange={(e) => setConfig({ ...config, grpcPort: Number(e.target.value) })}
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="tlsCaCertPath" className="text-base font-medium">
                  TLS CA cert path
                </Label>
                <p className="text-sm text-muted-foreground">
                  Required for live status via gRPC. Leave blank to use the directory watcher only — you still
                  get full ingest.
                </p>
                <Input
                  id="tlsCaCertPath"
                  placeholder="/data/rpc-certs/minknow/ca.crt"
                  value={config.tlsCaCertPath}
                  onChange={(e) => setConfig({ ...config, tlsCaCertPath: e.target.value })}
                />
                <ul className="list-disc list-inside ml-1 text-xs text-muted-foreground space-y-0.5">
                  <li>Linux: <code className="font-mono">/data/rpc-certs/minknow/ca.crt</code></li>
                  <li>macOS: <code className="font-mono">/Library/MinKNOW/data/rpc-certs/minknow/ca.crt</code></li>
                  <li>Windows: <code className="font-mono">C:\data\rpc-certs\minknow\ca.crt</code></li>
                </ul>
              </div>
            </div>
          </GlassCard>
        </div>

        {testResult ? (
          <div id="connection-test-results" className="scroll-mt-28">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="text-base font-semibold">Connection test results</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Read-only checks &mdash; nothing was sent to MinKNOW. Output directory is required; the other
              checks gate optional gRPC enrichment only.
            </p>

            <GlassCard className="p-6 space-y-2">
              {(["outputDir", "grpcPort", "tlsCert"] as const).map((key) => {
                const c = testResult.checks[key];
                return (
                  <div key={key} className="flex items-start gap-2 text-sm">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 text-red-500 shrink-0" />
                    )}
                    <div>
                      <div className="font-medium">{checkLabels[key].label}</div>
                      <div className="text-muted-foreground">{c.detail}</div>
                      <div className="text-xs text-muted-foreground/80 mt-0.5">
                        {checkLabels[key].hint}
                      </div>
                    </div>
                  </div>
                );
              })}
            </GlassCard>
          </div>
        ) : null}
        </div>
      </PageContainer>
    </>
  );
}
