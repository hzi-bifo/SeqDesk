"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Radio, Loader2, CheckCircle2, XCircle } from "lucide-react";

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

export default function MinknowStreamSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<MinknowStreamConfig>(DEFAULT);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

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
      toast.error("Failed to load MinKNOW stream settings");
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
      const data = (await res.json()) as TestResult;
      setTestResult(data);
    } catch (error) {
      console.error("Test failed:", error);
      toast.error("Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading…</span>
        </div>
      </PageContainer>
    );
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
    <PageContainer>
      <div className="mb-6 flex items-start gap-3">
        <Radio className="h-6 w-6 text-primary mt-1" />
        <div>
          <h1 className="text-2xl font-semibold">MinKNOW Stream</h1>
          <p className="text-sm text-muted-foreground">
            Configure direct ingest from a MinION (or other Oxford Nanopore device) running MinKNOW.
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground space-y-2">
        <p>
          <strong className="text-foreground">What this enables.</strong> When configured, facility admins can
          attach a running MinKNOW sequencing run to an order from <em>Sequencing Data &rarr; Stream</em>.
          SeqDesk watches the run&apos;s output folder and links new FASTQ files to samples by barcode as
          MinKNOW writes them, replacing the post-run upload step.
        </p>
        <p>
          <strong className="text-foreground">Two cooperating components.</strong> A long-lived
          <em> stream-monitor daemon</em> (started outside the web app via <code>npm run stream:monitor</code>)
          watches the filesystem; this admin form records the configuration the daemon reads on startup. If
          the daemon isn&apos;t running, no files will be ingested even when the form below is saved.
        </p>
        <p>
          <strong className="text-foreground">Where to point it.</strong> The output root is the parent
          directory MinKNOW writes runs into &mdash; <em>not</em> a specific run folder. Each individual
          stream attached to an order will name a child run folder under this root.
        </p>
      </div>

      <GlassCard className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <input
            id="enabled"
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            className="h-4 w-4 mt-1"
          />
          <div>
            <Label htmlFor="enabled" className="cursor-pointer">
              Enable stream monitor
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Soft toggle &mdash; the daemon checks this flag on each tick and pauses ingestion when off, so
              you can stop ingestion without killing the process. Disable while reconfiguring the output root.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label htmlFor="outputRoot">MinKNOW output root</Label>
            <Input
              id="outputRoot"
              placeholder="/data"
              value={config.outputRoot}
              onChange={(e) => setConfig({ ...config, outputRoot: e.target.value })}
            />
            <div className="mt-1.5 text-xs text-muted-foreground space-y-1">
              <p>
                Absolute path to the parent directory MinKNOW writes runs into. Defaults if you didn&apos;t
                change MinKNOW&apos;s output settings:
              </p>
              <ul className="list-disc list-inside ml-1 space-y-0.5">
                <li>Linux: <code>/data</code></li>
                <li>macOS: <code>/Library/MinKNOW/data</code></li>
                <li>Windows: <code>C:\data</code></li>
              </ul>
              <p>
                The daemon must have read access to this path. For network-separated setups, expose it via NFS
                or SMB and mount on the SeqDesk host.
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="pollIntervalMs">Poll interval (ms)</Label>
            <Input
              id="pollIntervalMs"
              type="number"
              min={1000}
              step={500}
              value={config.pollIntervalMs}
              onChange={(e) => setConfig({ ...config, pollIntervalMs: Number(e.target.value) })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              How often the daemon reconciles its watcher set against active streams in the database. The
              filesystem watcher itself is event-driven (chokidar), so this only controls how quickly newly
              started/stopped streams are picked up. 5000&ndash;15000&nbsp;ms is a sensible range.
            </p>
          </div>

          <div>
            <Label htmlFor="host">MinKNOW host</Label>
            <Input
              id="host"
              placeholder="localhost"
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Hostname of the workstation running MinKNOW. Used by the optional gRPC client (status enrichment
              only &mdash; ingestion works without it). <code>localhost</code> if SeqDesk and MinKNOW share a
              machine.
            </p>
          </div>

          <div>
            <Label htmlFor="grpcPort">gRPC port</Label>
            <Input
              id="grpcPort"
              type="number"
              min={1}
              max={65535}
              value={config.grpcPort}
              onChange={(e) => setConfig({ ...config, grpcPort: Number(e.target.value) })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              MinKNOW&apos;s manager service. Default <code>9501</code> for secure gRPC,
              <code> 9502</code> for gRPC-Web. The Test Connection button uses a plain TCP probe &mdash; a
              successful probe doesn&apos;t guarantee gRPC will negotiate, but a failed one means the daemon
              has no chance.
            </p>
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="tlsCaCertPath">TLS CA cert path (optional)</Label>
            <Input
              id="tlsCaCertPath"
              placeholder="/data/rpc-certs/minknow/ca.crt"
              value={config.tlsCaCertPath}
              onChange={(e) => setConfig({ ...config, tlsCaCertPath: e.target.value })}
            />
            <div className="mt-1.5 text-xs text-muted-foreground space-y-1">
              <p>
                Required for live status via gRPC. Leave blank to use the directory watcher only &mdash; you
                still get full ingest, just without the &ldquo;sequencer connected&rdquo; banner and live pore
                metrics in the order Stream view.
              </p>
              <p>Default cert locations:</p>
              <ul className="list-disc list-inside ml-1 space-y-0.5">
                <li>Linux: <code>/data/rpc-certs/minknow/ca.crt</code></li>
                <li>macOS: <code>/Library/MinKNOW/data/rpc-certs/minknow/ca.crt</code></li>
                <li>Windows: <code>C:\data\rpc-certs\minknow\ca.crt</code></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-2 border-t border-border/40">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save settings
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Test connection
          </Button>
          <p className="text-xs text-muted-foreground self-center">
            Test connection runs read-only checks &mdash; nothing is sent to MinKNOW.
          </p>
        </div>

        {testResult ? (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-4">
            <p className="text-xs text-muted-foreground mb-1">
              All three checks pass &rarr; the daemon should be able to ingest. <em>Output directory</em> is
              required; the others gate optional gRPC enrichment only.
            </p>
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
          </div>
        ) : null}
      </GlassCard>
    </PageContainer>
  );
}
