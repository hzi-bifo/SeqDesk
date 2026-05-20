"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { notifyPanel } from "@/lib/notifications/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  Loader2,
  Pause,
  Play,
  Settings,
  Square,
  Terminal,
} from "lucide-react";

interface WorkerLatest {
  id: string;
  name: string;
  pid: number;
  startedAt: string;
  stoppedAt: string | null;
  status: string;
  exitCode: number | null;
  logPath: string;
  lastErrorMsg: string | null;
  startedByEmail: string | null;
}

interface WorkerCard {
  name: string;
  label: string;
  description: string;
  script: string;
  args: string[];
  supportsPause: boolean;
  devOnly: boolean;
  settingsHref: string | null;
  configNote: string | null;
  paused: boolean;
  latest: WorkerLatest | null;
}

interface LogResponse {
  lines: string[];
  pid?: number;
  startedAt?: string;
  status?: string;
  logPath?: string;
  message?: string;
}

function formatRelative(ts: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function statusBadge(card: WorkerCard) {
  const status = card.latest?.status ?? "STOPPED";
  if (card.paused && (status === "RUNNING" || status === "STOPPING")) {
    return <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">Paused</Badge>;
  }
  switch (status) {
    case "RUNNING":
      return <Badge variant="default" className="bg-emerald-100 text-emerald-800 border-emerald-200">Running</Badge>;
    case "STOPPING":
      return <Badge variant="secondary">Stopping…</Badge>;
    case "STOPPED":
      return <Badge variant="secondary">Stopped</Badge>;
    case "ERROR":
      return <Badge variant="destructive">Error</Badge>;
    case "ZOMBIE":
      return <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200">Zombie</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function BackgroundWorkersPanel() {
  const [workers, setWorkers] = useState<WorkerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<Record<string, LogResponse>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/workers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { workers: WorkerCard[] };
      setWorkers(data.workers);
    } catch (error) {
      console.error("Failed to load workers", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handle = setInterval(() => void refresh(), 5000);
    return () => clearInterval(handle);
  }, [refresh]);

  const refreshLog = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/admin/workers/${name}/logs?tail=100`);
      if (!res.ok) return;
      const data = (await res.json()) as LogResponse;
      setLogs((prev) => ({ ...prev, [name]: data }));
    } catch (error) {
      console.error(`Failed to load logs for ${name}`, error);
    }
  }, []);

  // Auto-refresh logs for any open log section
  useEffect(() => {
    const openNames = Object.keys(openLogs).filter((k) => openLogs[k]);
    if (openNames.length === 0) return;
    const handle = setInterval(() => {
      for (const name of openNames) void refreshLog(name);
    }, 4000);
    return () => clearInterval(handle);
  }, [openLogs, refreshLog]);

  const act = async (name: string, action: "start" | "stop" | "pause" | "resume") => {
    setBusyName(name);
    try {
      const res = await fetch(`/api/admin/workers/${name}/${action}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      notifyPanel.success(`${action} sent to ${name}`);
      await refresh();
    } catch (error) {
      notifyPanel.error(`${action} failed: ${(error as Error).message}`);
    } finally {
      setBusyName(null);
    }
  };

  if (loading) {
    return (
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workers…
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5">
      <div className="space-y-4">
        {workers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workers registered.</p>
        ) : (
          workers.map((card) => {
            const status = card.latest?.status ?? "STOPPED";
            const isRunning = status === "RUNNING" || status === "STOPPING";
            const isStopped = !isRunning;
            const isBusy = busyName === card.name;
            const logOpen = !!openLogs[card.name];
            const log = logs[card.name];

            return (
              <div key={card.name} className="rounded-lg border border-border/70 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{card.label}</span>
                      {statusBadge(card)}
                      {card.devOnly ? (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">dev-only</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xl">{card.description}</p>
                    {card.latest ? (
                      <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                        <div>pid {card.latest.pid} · started {formatRelative(card.latest.startedAt)} {card.latest.startedByEmail ? `by ${card.latest.startedByEmail}` : ""}</div>
                        {card.latest.lastErrorMsg ? (
                          <div className="flex items-start gap-1 text-red-600">
                            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                            <span className="break-all">{card.latest.lastErrorMsg}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-2">Never started.</p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-2 font-mono break-all">
                      {card.script}{card.args.length ? ` ${card.args.join(" ")}` : ""}
                    </p>
                    {card.configNote ? (
                      <p className="text-[11px] text-muted-foreground/80 mt-1 italic">{card.configNote}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isStopped ? (
                      <Button size="sm" disabled={isBusy} onClick={() => void act(card.name, "start")}>
                        {isBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                        Start
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" disabled={isBusy} onClick={() => void act(card.name, "stop")}>
                        {isBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1.5 h-3.5 w-3.5" />}
                        Stop
                      </Button>
                    )}
                    {card.supportsPause && isRunning ? (
                      card.paused ? (
                        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void act(card.name, "resume")}>
                          <Play className="mr-1.5 h-3.5 w-3.5" />
                          Resume
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void act(card.name, "pause")}>
                          <Pause className="mr-1.5 h-3.5 w-3.5" />
                          Pause
                        </Button>
                      )
                    ) : null}
                    {card.settingsHref ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={card.settingsHref}>
                          <Settings className="mr-1.5 h-3.5 w-3.5" />
                          Settings
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setOpenLogs((prev) => ({ ...prev, [card.name]: !prev[card.name] }));
                        if (!logOpen) void refreshLog(card.name);
                      }}
                    >
                      <Terminal className="mr-1.5 h-3.5 w-3.5" />
                      {logOpen ? "Hide log" : "Show log"}
                    </Button>
                  </div>
                </div>

                {logOpen ? (
                  <div className="rounded-md bg-muted/40 border border-border/60">
                    <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border/60 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        {log?.logPath ?? "no log file yet"}
                      </span>
                      <span>{log ? `${log.lines.length} lines` : ""}</span>
                    </div>
                    <ScrollArea className="max-h-56">
                      <pre className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap break-all leading-snug">
                        {log?.lines.length ? log.lines.join("\n") : (log?.message ?? "(no log output yet)")}
                      </pre>
                    </ScrollArea>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </GlassCard>
  );
}
