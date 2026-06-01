"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { notifyPanel } from "@/lib/notifications/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HelpBox } from "@/components/ui/help-box";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  Loader2,
  Play,
  Radio,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { SequencingSampleRow } from "@/lib/sequencing/types";

interface StreamRunSummary {
  id: string;
  orderId: string;
  minknowRunId: string | null;
  flowCellId: string | null;
  deviceId: string | null;
  outputDir: string;
  status: string;
  totalBases: string;
  totalReads: number;
  barcodeMap: Record<string, string>;
  startedAt: string;
  lastSeenAt: string;
  stoppedAt: string | null;
  latestEvent: { kind: string; ts: string; payload: unknown } | null;
}

interface StreamEvent {
  id: string;
  seq: number;
  ts: string;
  kind: string;
  payload: unknown;
}

interface SequencingStreamViewProps {
  orderId: string;
  samples: SequencingSampleRow[];
  canManage: boolean;
  onDataChanged: () => void;
}

function formatBytes(value: string | number | bigint): string {
  const n = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Format a base-pair count using the sequencing convention (kb/Mb/Gb, base-10).
function formatBases(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 bp";
  if (value < 1_000) return `${value} bp`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} kb`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(2)} Mb`;
  return `${(value / 1_000_000_000).toFixed(2)} Gb`;
}

// Format reads-per-second; show "—" when no rate is available yet.
function formatReadsPerSec(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1) return `<1 r/s`;
  if (value < 1_000) return `${value.toFixed(0)} r/s`;
  return `${(value / 1_000).toFixed(1)}k r/s`;
}

function avgReadLength(reads: number, bases: number): number {
  if (reads <= 0) return 0;
  return Math.round(bases / reads);
}

function formatRelative(ts: string): string {
  const date = new Date(ts);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatElapsed(startedAt: string): string {
  const ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function isPayloadObject(payload: unknown): payload is Record<string, unknown> {
  return payload !== null && typeof payload === "object";
}

export function SequencingStreamView({
  orderId,
  samples,
  canManage,
  onDataChanged,
}: SequencingStreamViewProps) {
  const [runs, setRuns] = useState<StreamRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [barcodeMapDraft, setBarcodeMapDraft] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const lastEventSeqRef = useRef<number | null>(null);

  // Stream-monitor daemon status. Only populated when the user has admin access
  // (the /api/admin/workers endpoint is FACILITY_ADMIN only). Non-admins see
  // the static fallback hint.
  const [daemon, setDaemon] = useState<
    | { available: true; status: string; pid: number | null; lastErrorMsg: string | null }
    | { available: false }
    | null
  >(null);
  const [startingDaemon, setStartingDaemon] = useState(false);

  // Per-barcode aggregates, computed server-side over the run's full FILE_INGESTED
  // history (the events array client-side only holds the last 50 — not enough for
  // accurate totals on a long-running stream). `readsPerSec` is derived client-side
  // from the delta between consecutive polls.
  const [barcodeStats, setBarcodeStats] = useState<
    Array<{
      barcode: string;
      fileCount: number;
      totalSize: number;
      totalReads: number;
      totalBases: number;
      readsPerSec: number | null;
      lastFileAt: string | null;
      lastFilePath: string | null;
    }>
  >([]);
  const prevBarcodeSnapshotRef = useRef<{
    at: number;
    byBarcode: Map<string, { totalReads: number; totalBases: number }>;
  } | null>(null);
  const [showRecentFiles, setShowRecentFiles] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);

  const activeRun = useMemo(() => runs.find((r) => r.status === "ACTIVE") ?? null, [runs]);

  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/stream`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { runs: StreamRunSummary[] };
      setRuns(data.runs);
    } catch (error) {
      console.error("Failed to load stream runs:", error);
    } finally {
      setLoadingRuns(false);
    }
  }, [orderId]);

  useEffect(() => {
    void refreshRuns();
    const handle = setInterval(() => void refreshRuns(), 5000);
    return () => clearInterval(handle);
  }, [refreshRuns]);

  const refreshDaemon = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/workers");
      if (res.status === 401 || res.status === 403) {
        setDaemon({ available: false });
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        workers: Array<{
          name: string;
          latest: { status: string; pid: number; lastErrorMsg: string | null } | null;
        }>;
      };
      const m = data.workers.find((w) => w.name === "stream-monitor");
      setDaemon({
        available: true,
        status: m?.latest?.status ?? "STOPPED",
        pid: m?.latest?.pid ?? null,
        lastErrorMsg: m?.latest?.lastErrorMsg ?? null,
      });
    } catch (error) {
      console.error("Failed to load daemon status:", error);
    }
  }, []);

  useEffect(() => {
    void refreshDaemon();
    const handle = setInterval(() => void refreshDaemon(), 5000);
    return () => clearInterval(handle);
  }, [refreshDaemon]);

  // Poll per-barcode aggregates only while a run is active. Stops polling
  // automatically when the run ends to avoid churning the DB.
  useEffect(() => {
    if (!activeRun) {
      setBarcodeStats([]);
      prevBarcodeSnapshotRef.current = null;
      return;
    }
    let cancelled = false;
    const fetchBarcodes = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/stream/${activeRun.id}/by-barcode`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          barcodes: Array<{
            barcode: string;
            fileCount: number;
            totalSize: number;
            totalReads: number;
            totalBases: number;
            lastFileAt: string | null;
            lastFilePath: string | null;
          }>;
        };
        if (cancelled) return;

        // Derive reads/sec from the delta to the previous snapshot. First poll
        // has no previous, so rate is null and the UI shows "—".
        const now = Date.now();
        const prev = prevBarcodeSnapshotRef.current;
        const elapsedSec = prev ? Math.max(1, (now - prev.at) / 1000) : 0;
        const next = data.barcodes.map((row) => {
          let readsPerSec: number | null = null;
          if (prev && elapsedSec > 0) {
            const before = prev.byBarcode.get(row.barcode);
            if (before) {
              readsPerSec = Math.max(0, (row.totalReads - before.totalReads) / elapsedSec);
            } else {
              // New barcode this poll — treat all reads as having arrived in the window.
              readsPerSec = row.totalReads / elapsedSec;
            }
          }
          return { ...row, readsPerSec };
        });
        setBarcodeStats(next);
        prevBarcodeSnapshotRef.current = {
          at: now,
          byBarcode: new Map(
            data.barcodes.map((r) => [r.barcode, { totalReads: r.totalReads, totalBases: r.totalBases }]),
          ),
        };
      } catch (error) {
        console.error("Failed to load barcode stats:", error);
      }
    };
    void fetchBarcodes();
    const handle = setInterval(() => void fetchBarcodes(), 5000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [activeRun, orderId]);

  const handleStartDaemon = async () => {
    setStartingDaemon(true);
    try {
      const res = await fetch("/api/admin/workers/stream-monitor/start", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      notifyPanel.success("Stream monitor started");
      await refreshDaemon();
    } catch (error) {
      notifyPanel.error(`Failed to start daemon: ${(error as Error).message}`);
    } finally {
      setStartingDaemon(false);
    }
  };

  // In dev, default the run-dir to the simulator's output path on first render
  // so testing without a real MinION is one click. No-op once the user has
  // typed anything (we only seed when the field is still empty).
  const isDev = process.env.NODE_ENV !== "production";
  useEffect(() => {
    if (isDev && outputDir === "" && !activeRun) {
      setOutputDir("/tmp/seqdesk-sim");
    }
    // We intentionally don't re-run when outputDir changes — this only seeds once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun, isDev]);

  // Reset event polling when active run changes
  useEffect(() => {
    if (!activeRun) {
      setEvents([]);
      lastEventSeqRef.current = null;
      return;
    }
    let cancelled = false;
    const fetchEvents = async () => {
      try {
        const url = new URL(`/api/orders/${orderId}/stream/${activeRun.id}/events`, window.location.origin);
        if (lastEventSeqRef.current !== null) url.searchParams.set("after", String(lastEventSeqRef.current));
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const data = (await res.json()) as { events: StreamEvent[]; cursor: number };
        if (cancelled) return;
        if (data.events.length > 0) {
          setEvents((prev) => {
            const combined = [...data.events, ...prev];
            return combined.slice(0, 50);
          });
          // Use the cursor returned by the server so we never drop events that share a timestamp.
          lastEventSeqRef.current = data.cursor;
          // Refresh totals/barcodeMap whenever new events arrive
          void refreshRuns();
          if (data.events.some((e) => e.kind === "FILE_INGESTED")) {
            onDataChanged();
          }
        } else if (lastEventSeqRef.current === null) {
          // First poll on a stream with no events yet — lock in the server-issued cursor (0).
          lastEventSeqRef.current = data.cursor;
        }
      } catch (error) {
        console.error("Failed to fetch events:", error);
      }
    };
    void fetchEvents();
    const handle = setInterval(() => void fetchEvents(), 3000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [activeRun, orderId, refreshRuns, onDataChanged]);

  const handleStart = async () => {
    if (!outputDir.trim()) {
      notifyPanel.error("Output directory is required");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputDir: outputDir.trim(),
          barcodeMap: barcodeMapDraft,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      notifyPanel.success("Stream started");
      setOutputDir("");
      setBarcodeMapDraft({});
      await refreshRuns();
    } catch (error) {
      notifyPanel.error(`Failed to start stream: ${(error as Error).message}`);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (streamRunId: string) => {
    setStopping(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/stream/${streamRunId}/stop`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      notifyPanel.success("Stream stopped");
      await refreshRuns();
    } catch (error) {
      notifyPanel.error(`Failed to stop stream: ${(error as Error).message}`);
    } finally {
      setStopping(false);
    }
  };

  const ingestedFiles = useMemo(() => {
    const files: Array<{ ts: string; filePath: string; barcode: string; size: number; sampleId: string | null }> = [];
    for (const e of events) {
      if (e.kind !== "FILE_INGESTED") continue;
      if (!isPayloadObject(e.payload)) continue;
      const p = e.payload;
      files.push({
        ts: e.ts,
        filePath: typeof p.filePath === "string" ? p.filePath : "(unknown)",
        barcode: typeof p.barcode === "string" ? p.barcode : "?",
        size: typeof p.size === "number" ? p.size : 0,
        sampleId: typeof p.linkedSampleId === "string" ? p.linkedSampleId : null,
      });
      if (files.length >= 20) break;
    }
    return files;
  }, [events]);

  const sampleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of samples) {
      map.set(s.id, s.sampleAlias || s.sampleId);
    }
    return map;
  }, [samples]);

  if (loadingRuns) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading stream status…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Stream</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Ingest reads from a running MinION (or other MinKNOW-driven sequencer) directly into this order
        </p>
      </div>

      <HelpBox title="What is Stream mode?">
        Stream mode lets SeqDesk watch a MinKNOW output directory while sequencing is in progress and link new
        FASTQ files to samples as they appear &mdash; no need to wait for the run to finish, copy files, and
        run Discover &amp; Associate afterwards. Stream is additive: existing flows still work for files that
        arrive from external collaborators or older sequencing runs. The MinKNOW stream monitor must be running
        on the host that has access to the output directory (<code>npm run stream:monitor</code>), and a
        facility admin must configure the MinKNOW location in <em>Application Settings &rarr; MinKNOW Stream</em>.
      </HelpBox>

      {/* Status header */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5" />
              Live sequencer stream
            </CardTitle>
            <CardDescription>
              Watch a MinKNOW output directory and ingest reads into this order as they appear.
            </CardDescription>
          </div>
          {activeRun ? (
            <Badge variant="default" className="gap-1">
              <Wifi className="h-3 w-3" />
              Active
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <WifiOff className="h-3 w-3" />
              Idle
            </Badge>
          )}
        </CardHeader>
        {activeRun ? (
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Output directory</div>
                <div className="font-mono break-all">{activeRun.outputDir}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Elapsed</div>
                <div>{formatElapsed(activeRun.startedAt)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs" title="Total reads parsed from all ingested FASTQ files across every barcode in this run.">
                  Reads
                </div>
                <div className="tabular-nums">{activeRun.totalReads.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs" title="Total bases (basecalled yield) summed across every barcode. Shown in kb / Mb / Gb (base-10).">
                  Bases
                </div>
                <div className="tabular-nums">{formatBases(Number(activeRun.totalBases))}</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Activity className="h-3 w-3" />
              <span title="Last time the stream-monitor daemon checked in. If this falls behind your poll interval, the monitor process may have stopped.">
                Monitor heartbeat: {formatRelative(activeRun.lastSeenAt)}
              </span>
            </div>
            {canManage ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="destructive" size="sm" disabled={stopping} onClick={() => void handleStop(activeRun.id)}>
                  {stopping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                  Stop receiving
                </Button>
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Stopping the stream detaches the watcher but keeps every ingested Read row and event in this order.
                </span>
              </div>
            ) : null}
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No active stream for this order. Use the form below to point SeqDesk at a MinKNOW run directory
              (the folder MinKNOW creates when you click <em>Start sequencing</em>) and map each barcode to one
              of this order&apos;s samples. As soon as MinKNOW writes its first FASTQ, it will appear here.
            </p>
          </CardContent>
        )}
      </Card>

      {!activeRun && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start receiving</CardTitle>
            <CardDescription>
              Point this stream at the MinKNOW run directory and map each barcode to a sample. You can start
              before MinKNOW finishes its first read &mdash; SeqDesk will simply wait for files to appear.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label htmlFor="outputDir">Output directory</Label>
              <Input
                id="outputDir"
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="/data/myrun_2026_05_07/no_sample/20260507_1201_3E_PAA12345_e05460c6"
              />
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                <p>
                  Use the <strong>run folder</strong> &mdash; the one that contains <code>fastq_pass/</code>,
                  <code> fastq_fail/</code>, and <code>pod5/</code>. MinKNOW prints this path under the
                  <em> Output</em> section of the Run Setup screen.
                </p>
                <p>Common defaults if you didn&apos;t change MinKNOW&apos;s output settings:</p>
                <ul className="list-disc list-inside ml-1 space-y-0.5">
                  <li>Linux: <code>/data/&lt;experiment&gt;/&lt;sample&gt;/&lt;timestamp_devid&gt;/</code></li>
                  <li>macOS: <code>/Library/MinKNOW/data/&lt;experiment&gt;/&lt;sample&gt;/&lt;timestamp_devid&gt;/</code></li>
                  <li>Windows: <code>C:\data\&lt;experiment&gt;\&lt;sample&gt;\&lt;timestamp_devid&gt;\</code></li>
                </ul>
                <p>
                  The path must be readable from wherever the stream-monitor daemon is running &mdash; usually
                  the same machine as MinKNOW, or via an NFS/SMB mount on a shared server.
                </p>
              </div>
            </div>
            <div>
              <Label>Barcode &rarr; sample mapping</Label>
              <p className="text-xs text-muted-foreground mb-2">
                MinKNOW writes one folder per barcode under <code>fastq_pass/</code> (e.g.
                <code> barcode01/</code>, <code>barcode02/</code>, plus <code>unclassified/</code> for reads
                that don&apos;t match any barcode). Add a row for every barcode you expect to receive and
                point it at the right sample. Files arriving in unmapped barcode folders are still recorded
                in the event log but won&apos;t be linked to a sample.
              </p>
              <BarcodeMapEditor
                samples={samples}
                value={barcodeMapDraft}
                onChange={setBarcodeMapDraft}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void handleStart()} disabled={starting}>
                {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}
                Start receiving
              </Button>
              {daemon == null ? (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking daemon status…
                </span>
              ) : !daemon.available ? (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Make sure the stream-monitor daemon is running (<code>npm run stream:monitor</code>), otherwise files won&apos;t be picked up.
                </span>
              ) : daemon.status === "RUNNING" ? (
                <span className="text-xs inline-flex items-center gap-1.5 text-[#00BD7D]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Stream-monitor daemon running
                  {daemon.pid != null ? <span className="text-muted-foreground">(pid {daemon.pid})</span> : null}
                </span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs inline-flex items-center gap-1.5 text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Stream-monitor daemon {daemon.status === "ERROR" ? "errored" : "stopped"} — files won&apos;t be picked up
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-white h-7 px-2 text-xs"
                    onClick={() => void handleStartDaemon()}
                    disabled={startingDaemon}
                  >
                    {startingDaemon ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="mr-1 h-3 w-3" />
                    )}
                    Start daemon
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    <Link href="/admin/minknow-stream">
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Settings
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeRun ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Barcode mapping</CardTitle>
            <CardDescription>
              Files landing in these barcode directories will be linked to the listed sample. To change the
              mapping, stop this stream and start a new one &mdash; mappings are immutable once a stream is
              receiving so the audit trail stays unambiguous.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(activeRun.barcodeMap).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No barcode mapping was configured for this stream. Files will still be recorded in the event
                log but won&apos;t be linked to samples.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2">Barcode</th>
                    <th className="py-2">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(activeRun.barcodeMap).map(([barcode, sampleId]) => (
                    <tr key={barcode} className="border-b last:border-0">
                      <td className="py-2 font-mono">{barcode}</td>
                      <td className="py-2">{sampleNameById.get(sampleId) ?? sampleId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeRun ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By barcode</CardTitle>
            <CardDescription>
              Live totals per barcode across the whole run. Rows marked
              <em> unmapped</em> arrived in a barcode folder that wasn&apos;t in the mapping above &mdash;
              they&apos;re recorded for audit but not linked to any sample.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {barcodeStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No files ingested yet. The first batch typically appears 30&ndash;90 seconds after MinKNOW
                starts writing.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3">Barcode</th>
                    <th className="py-2 pr-3">Sample</th>
                    <th className="py-2 pr-3 text-right">Reads</th>
                    <th className="py-2 pr-3 text-right">Bases</th>
                    <th className="py-2 pr-3 text-right">Avg length</th>
                    <th className="py-2 pr-3 text-right" title="Reads ingested per second since the last 5-second poll. Empty for the first poll.">
                      Rate
                    </th>
                    <th className="py-2 pr-3 text-right text-muted-foreground font-normal">Files</th>
                    <th className="py-2 pr-3">Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {barcodeStats.map((row) => {
                    const sampleId = activeRun.barcodeMap[row.barcode];
                    const avg = avgReadLength(row.totalReads, row.totalBases);
                    const lastAgeMs = row.lastFileAt ? Date.now() - new Date(row.lastFileAt).getTime() : null;
                    const isActive = lastAgeMs != null && lastAgeMs < 30_000;
                    return (
                      <tr key={row.barcode} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-mono">{row.barcode}</td>
                        <td className="py-2 pr-3">
                          {sampleId ? (
                            sampleNameById.get(sampleId) ?? sampleId
                          ) : (
                            <span className="text-muted-foreground">unmapped</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">
                          {row.totalReads.toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">
                          {formatBases(row.totalBases)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {avg > 0 ? `${avg.toLocaleString()} bp` : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {formatReadsPerSec(row.readsPerSec)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {row.fileCount.toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className={
                                "inline-block h-1.5 w-1.5 rounded-full " +
                                (isActive
                                  ? "bg-[#00BD7D] animate-pulse"
                                  : row.lastFileAt
                                  ? "bg-muted-foreground/40"
                                  : "bg-transparent")
                              }
                            />
                            {row.lastFileAt ? formatRelative(row.lastFileAt) : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeRun ? (
        <Card>
          <CardHeader className="pb-2">
            <button
              type="button"
              onClick={() => setShowRecentFiles((v) => !v)}
              className="flex items-center gap-2 text-left -m-2 p-2 rounded hover:bg-muted/40 transition-colors"
            >
              {showRecentFiles ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <CardTitle className="text-base">Recent files</CardTitle>
              <span className="text-xs text-muted-foreground">
                Last {ingestedFiles.length} of {activeRun.totalReads > 0 ? "many" : "0"}
              </span>
            </button>
          </CardHeader>
          {showRecentFiles ? (
            <CardContent>
              {ingestedFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No files ingested yet.</p>
              ) : (
                <ScrollArea className="max-h-72">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="py-1">When</th>
                        <th className="py-1">Barcode</th>
                        <th className="py-1">Sample</th>
                        <th className="py-1">Size</th>
                        <th className="py-1">File</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingestedFiles.map((f, idx) => (
                        <tr key={`${f.filePath}-${idx}`} className="border-b last:border-0">
                          <td className="py-1 whitespace-nowrap">{formatRelative(f.ts)}</td>
                          <td className="py-1 font-mono">{f.barcode}</td>
                          <td className="py-1">
                            {f.sampleId ? (sampleNameById.get(f.sampleId) ?? f.sampleId) : <span className="text-muted-foreground">unmapped</span>}
                          </td>
                          <td className="py-1">{formatBytes(f.size)}</td>
                          <td className="py-1 font-mono text-xs break-all">{f.filePath}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {activeRun ? (
        <Card>
          <CardHeader className="pb-2">
            <button
              type="button"
              onClick={() => setShowAuditLog((v) => !v)}
              className="flex items-center gap-2 text-left -m-2 p-2 rounded hover:bg-muted/40 transition-colors"
            >
              {showAuditLog ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <CardTitle className="text-base">Audit trail</CardTitle>
              <span className="text-xs text-muted-foreground">Raw event log — debug only</span>
            </button>
          </CardHeader>
          {showAuditLog ? (
            <CardContent className="space-y-2">
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-mono text-green-600">FILE_INGESTED</span> &mdash; a new FASTQ was picked up</span>
                <span><span className="font-mono">RUN_STARTED</span> &mdash; the stream was attached to this order</span>
                <span><span className="font-mono">RUN_STOPPED</span> &mdash; the watcher was detached</span>
                <span><span className="font-mono text-red-500">ERROR</span> &mdash; ingest failed; check the payload</span>
              </div>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events yet.</p>
              ) : (
                <ScrollArea className="max-h-72 w-full">
                  <ul className="space-y-1 text-xs font-mono w-full">
                    {events.map((e) => (
                      <li key={e.id} className="flex gap-2 w-full overflow-hidden">
                        <span className="text-muted-foreground whitespace-nowrap shrink-0">
                          {formatRelative(e.ts)}
                        </span>
                        <span
                          className={
                            "shrink-0 " +
                            (e.kind === "ERROR"
                              ? "text-red-500"
                              : e.kind === "FILE_INGESTED"
                              ? "text-green-600"
                              : "")
                          }
                        >
                          {e.kind}
                        </span>
                        {isPayloadObject(e.payload) ? (
                          <span className="text-muted-foreground truncate min-w-0 flex-1">
                            {JSON.stringify(e.payload)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

interface BarcodeMapEditorProps {
  samples: SequencingSampleRow[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

function BarcodeMapEditor({ samples, value, onChange }: BarcodeMapEditorProps) {
  const [newBarcode, setNewBarcode] = useState("");
  const entries = Object.entries(value);

  const addRow = () => {
    const key = newBarcode.trim().toLowerCase();
    if (!key) return;
    if (value[key]) {
      notifyPanel.error(`${key} is already mapped`);
      return;
    }
    onChange({ ...value, [key]: samples[0]?.id ?? "" });
    setNewBarcode("");
  };

  const updateRow = (barcode: string, sampleId: string) => {
    onChange({ ...value, [barcode]: sampleId });
  };

  const removeRow = (barcode: string) => {
    const next = { ...value };
    delete next[barcode];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No barcodes added yet. Type a barcode name (e.g. <code>barcode01</code>) below and press Enter or
          click <em>Add barcode</em>.
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {entries.map(([barcode, sampleId]) => (
              <tr key={barcode}>
                <td className="py-1 font-mono w-40">{barcode}</td>
                <td className="py-1">
                  <select
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                    value={sampleId}
                    onChange={(e) => updateRow(barcode, e.target.value)}
                  >
                    {samples.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sampleAlias || s.sampleId}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 w-20 text-right">
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(barcode)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex items-center gap-2">
        <Input
          placeholder="barcode01"
          value={newBarcode}
          onChange={(e) => setNewBarcode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRow();
            }
          }}
          className="w-40"
        />
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          Add barcode
        </Button>
      </div>
    </div>
  );
}
