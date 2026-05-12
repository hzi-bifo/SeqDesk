"use client";

import { useState, useEffect, useContext, useMemo } from "react";
import { useHelpText } from "@/lib/useHelpText";
import { SidebarContext } from "./SidebarContext";

interface AdminActivityJob {
  id: string;
  label: string;
  state: "running" | "success" | "error";
  phase?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  progressPercent?: number | null;
  speedBytesPerSecond?: number | null;
  etaSeconds?: number | null;
  updatedAt?: string;
  targetPath?: string;
  error?: string;
  logAvailable?: boolean;
  logExcerpt?: string[];
}

function formatBytes(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(seconds?: number | null): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) {
    return null;
  }
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function formatActivitySummary(job: AdminActivityJob): string {
  const phase =
    job.state === "error"
      ? "Failed"
      : job.phase === "verifying"
        ? "Verifying"
        : job.phase === "installing"
          ? "Installing"
          : job.phase === "extracting"
            ? "Extracting"
            : job.phase === "seeding"
              ? "Seeding"
              : "Downloading";
  const parts = [`${phase} ${job.label}`];
  if (typeof job.progressPercent === "number") {
    parts.push(`${job.progressPercent}%`);
  }
  const downloaded = formatBytes(job.bytesDownloaded);
  const total = formatBytes(job.totalBytes);
  if (downloaded && total) {
    parts.push(`${downloaded} / ${total}`);
  } else if (downloaded) {
    parts.push(`${downloaded}`);
  }
  const speed = formatBytes(job.speedBytesPerSecond);
  if (speed && job.state === "running") {
    parts.push(`${speed}/s`);
  }
  const eta = formatDuration(job.etaSeconds);
  if (eta && job.state === "running") {
    parts.push(`ETA ${eta}`);
  }
  if (job.state === "error" && job.error) {
    parts.push(job.error);
  }
  return parts.join(" · ");
}

export function Footer() {
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [activityJobs, setActivityJobs] = useState<AdminActivityJob[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { showHelpText, isLoaded, toggleHelpText } = useHelpText();
  const sidebarContext = useContext(SidebarContext);
  const collapsed = sidebarContext?.collapsed ?? false;

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      try {
        const response = await fetch("/api/admin/activity", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setActivityJobs([]);
          return;
        }
        const payload = (await response.json()) as { jobs?: AdminActivityJob[] };
        if (!cancelled) {
          setActivityJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
        }
      } catch {
        if (!cancelled) setActivityJobs([]);
      }
    }

    void loadActivity();
    const timer = setInterval(() => void loadActivity(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const visibleJobs = useMemo(
    () =>
      activityJobs.filter(
        (job) => job.state === "running" || job.state === "error"
      ),
    [activityJobs]
  );
  const primaryJob = visibleJobs[0] || null;

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <footer
      className="fixed bottom-0 right-0 border-t border-border bg-background px-4 py-1.5 z-30 transition-all duration-300"
      style={{ left: collapsed ? '64px' : '256px' }}
    >
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="relative flex min-w-0 items-center gap-4">
          {isLoaded && (
            <button
              onClick={toggleHelpText}
              className={`flex items-center gap-1.5 hover:text-foreground transition-colors ${
                showHelpText ? "text-foreground" : ""
              }`}
              title={showHelpText ? "Hide help text" : "Show help text"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${showHelpText ? "bg-foreground" : "bg-muted-foreground"}`} />
              <span>Help tips {showHelpText ? "on" : "off"}</span>
            </button>
          )}
          {primaryJob && (
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  primaryJob.state === "error" ? "bg-destructive" : "bg-[#00BD7D]"
                }`}
              />
              <span
                className={`max-w-[52vw] truncate ${
                  primaryJob.state === "error" ? "text-destructive" : "text-foreground"
                }`}
                title={formatActivitySummary(primaryJob)}
              >
                {formatActivitySummary(primaryJob)}
              </span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setDetailsOpen((open) => !open)}
              >
                details
              </button>
            </div>
          )}
          {detailsOpen && visibleJobs.length > 0 && (
            <div className="absolute bottom-7 left-0 z-50 w-[min(760px,calc(100vw-2rem))] rounded-md border border-border bg-background p-3 text-xs shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-foreground">Admin activity</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setDetailsOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="space-y-2">
                {visibleJobs.slice(0, 4).map((job) => (
                  <div key={job.id} className="rounded border border-border/70 p-2">
                    <p className={job.state === "error" ? "text-destructive" : "text-foreground"}>
                      {formatActivitySummary(job)}
                    </p>
                    {job.targetPath && (
                      <p className="mt-1 break-all text-muted-foreground">
                        Target: {job.targetPath}
                      </p>
                    )}
                    {job.logExcerpt && job.logExcerpt.length > 0 && (
                      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px] text-muted-foreground">
                        {job.logExcerpt.join("\n")}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {currentTime && (
            <>
              <span>{formatDate(currentTime)}</span>
              <span className="font-mono">{formatTime(currentTime)}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
