"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowLeft,
  Braces,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PayloadRecord = Record<string, unknown>;

interface WeblogEvent {
  id: string;
  eventType: string;
  processName: string | null;
  stepId: string | null;
  status: string | null;
  message: string | null;
  payload: unknown;
  payloadRaw: string | null;
  source: string | null;
  occurredAt: string;
}

interface WeblogData {
  run: {
    id: string;
    runNumber: number | string;
    pipelineId: string;
  };
  webhook: {
    method: string;
    endpoint: string;
    tokenRequired: boolean;
  };
  count: number;
  events: WeblogEvent[];
}

const fetcher = async (url: string): Promise<WeblogData> => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Failed to load weblog events";
    throw new Error(message);
  }

  return data as WeblogData;
};

function formatEventType(value?: string | null): string {
  if (!value) return "Event";
  return value.replace(/_/g, " ");
}

function formatHumanEventTitle(eventType?: string | null, processName?: string | null): string {
  const normalized = (eventType || "event").toLowerCase();

  if (normalized.includes("workflow_start") || normalized.includes("workflow_begin")) {
    return "Workflow started";
  }
  if (normalized.includes("workflow_complete") || normalized.includes("workflow_finish")) {
    return "Workflow completed";
  }
  if (normalized.includes("workflow_error") || normalized.includes("workflow_fail")) {
    return "Workflow failed";
  }
  if (normalized.includes("process_start") || normalized.includes("task_start")) {
    return processName ? `${processName} started` : "Process started";
  }
  if (normalized.includes("process_complete") || normalized.includes("task_complete")) {
    return processName ? `${processName} completed` : "Process completed";
  }
  if (normalized.includes("process_error") || normalized.includes("task_error")) {
    return processName ? `${processName} failed` : "Process failed";
  }

  const prettyType = formatEventType(eventType);
  return processName ? `${prettyType}: ${processName}` : prettyType;
}

function formatRelativeTime(timestamp?: string | null): string {
  if (!timestamp) return "-";
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return "-";
  const diffMs = Date.now() - time;
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAbsoluteTime(timestamp?: string | null): string {
  if (!timestamp) return "-";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function isPayloadRecord(value: unknown): value is PayloadRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPath(payload: unknown, path: string): unknown {
  if (!isPayloadRecord(payload)) return undefined;

  let cursor: unknown = payload;
  for (const part of path.split(".")) {
    if (!isPayloadRecord(cursor) || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }

  return cursor;
}

function firstPayloadValue(payload: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = readPath(payload, path);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function formatPayloadValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function extractPayloadHighlights(payload: unknown): Array<{ label: string; value: string }> {
  const candidates: Array<{ label: string; paths: string[] }> = [
    { label: "Task", paths: ["task_id", "taskId", "task.hash", "trace.task_id", "trace.taskId", "trace.hash"] },
    { label: "Attempt", paths: ["attempt", "task.attempt", "trace.attempt"] },
    { label: "Exit", paths: ["exit", "exitStatus", "exit_code", "trace.exit", "trace.exitStatus"] },
    { label: "Duration", paths: ["duration", "realtime", "trace.duration", "trace.realtime"] },
    { label: "CPU", paths: ["cpus", "cpu", "trace.cpus"] },
    { label: "Memory", paths: ["memory", "mem", "trace.memory"] },
    { label: "Work dir", paths: ["workdir", "workDir", "trace.workdir", "trace.workDir"] },
    { label: "Session", paths: ["sessionId", "session_id", "run.sessionId", "workflow.sessionId"] },
  ];
  const highlights: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const value = firstPayloadValue(payload, candidate.paths);
    const formatted = formatPayloadValue(value);
    if (!formatted) continue;
    const key = `${candidate.label}:${formatted}`;
    if (seen.has(key)) continue;
    seen.add(key);
    highlights.push({ label: candidate.label, value: formatted });
  }

  return highlights.slice(0, 8);
}

function formatPayloadJson(payload: unknown, payloadRaw?: string | null): string {
  if (payload === null || payload === undefined) return payloadRaw || "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return payloadRaw || String(payload);
  }
}

function getPayloadSummary(payload: unknown): string | null {
  if (!isPayloadRecord(payload)) {
    return typeof payload === "string" && payload.trim() ? payload.trim() : null;
  }

  const keys = Object.keys(payload).filter((key) => key !== "trace").slice(0, 5);
  const trace = readPath(payload, "trace");
  if (isPayloadRecord(trace)) {
    keys.push(...Object.keys(trace).slice(0, 3).map((key) => `trace.${key}`));
  }

  return keys.length > 0 ? keys.join(", ") : null;
}

function getSourceLabel(source?: string | null): string {
  if (!source) return "Unknown source";
  if (source === "weblog") return "Weblog";
  if (source === "trace") return "Trace";
  if (source === "queue") return "Queue";
  return source.replace(/_/g, " ");
}

function getEventTone(event: WeblogEvent): {
  icon: typeof CheckCircle2;
  iconClassName: string;
  railClassName: string;
} {
  const normalized = `${event.eventType} ${event.status || ""}`.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error")) {
    return {
      icon: XCircle,
      iconClassName: "text-destructive",
      railClassName: "bg-destructive",
    };
  }
  if (normalized.includes("complete") || normalized.includes("finish")) {
    return {
      icon: CheckCircle2,
      iconClassName: "text-[#00BD7D]",
      railClassName: "bg-[#00BD7D]",
    };
  }
  if (normalized.includes("start") || normalized.includes("running")) {
    return {
      icon: Clock,
      iconClassName: "text-blue-600",
      railClassName: "bg-blue-600",
    };
  }
  return {
    icon: AlertTriangle,
    iconClassName: "text-muted-foreground",
    railClassName: "bg-muted-foreground",
  };
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const normalized = status.toLowerCase();

  if (normalized.includes("complete") || normalized === "success") {
    return <Badge variant="success">{status}</Badge>;
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return <Badge variant="destructive">{status}</Badge>;
  }
  if (normalized.includes("start") || normalized.includes("running")) {
    return <Badge variant="info">{status}</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function compactCounts(values: string[]): string {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => `${key}: ${count}`)
    .join(" | ");
}

function EventRow({ event }: { event: WeblogEvent }) {
  const title = formatHumanEventTitle(event.eventType, event.processName);
  const highlights = extractPayloadHighlights(event.payload);
  const payloadJson = formatPayloadJson(event.payload, event.payloadRaw);
  const payloadSummary = getPayloadSummary(event.payload);
  const tone = getEventTone(event);
  const Icon = tone.icon;

  return (
    <div className="grid gap-3 py-4 md:grid-cols-[180px_minmax(0,1fr)]">
      <div className="text-xs text-muted-foreground">
        <div className="font-mono text-foreground">{formatAbsoluteTime(event.occurredAt)}</div>
        <div>{formatRelativeTime(event.occurredAt)}</div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background",
              "border border-border"
            )}
          >
            <Icon className={cn("h-4 w-4", tone.iconClassName)} />
          </span>
          <h2 className="min-w-0 text-sm font-semibold text-foreground">{title}</h2>
          <StatusBadge status={event.status} />
          <Badge variant="outline">{getSourceLabel(event.source)}</Badge>
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{event.eventType || "event"}</span>
          {event.processName && <span>Process: {event.processName}</span>}
          {event.stepId && <span>Step: {event.stepId}</span>}
        </div>

        {event.message && (
          <p className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
            {event.message}
          </p>
        )}

        {highlights.length > 0 && (
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
            {highlights.map((item) => (
              <div key={`${item.label}-${item.value}`} className="min-w-0 rounded-md border border-border px-3 py-2">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="truncate font-mono text-foreground" title={item.value}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {payloadJson && (
          <details className="mt-3 rounded-md border border-border bg-muted/20">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
              <Braces className="h-3.5 w-3.5" />
              Payload details{payloadSummary ? `: ${payloadSummary}` : ""}
            </summary>
            <pre className="max-h-[360px] overflow-auto border-t border-border p-3 text-xs leading-relaxed">
              {payloadJson}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

export default function ProcessedWeblogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, error, isLoading, isValidating, mutate } = useSWR<WeblogData>(
    `/api/pipelines/runs/${id}/weblog?limit=500`,
    fetcher,
    { refreshInterval: 15000 }
  );

  const events = useMemo(() => data?.events ?? [], [data?.events]);
  const latestEvent = events[0] ?? null;
  const statusSummary = useMemo(
    () =>
      compactCounts(
        events
          .map((event) => event.status || event.eventType)
          .filter((value): value is string => Boolean(value))
      ),
    [events]
  );
  const sourceSummary = useMemo(
    () =>
      compactCounts(
        events
          .map((event) => getSourceLabel(event.source))
          .filter((value): value is string => Boolean(value))
      ),
    [events]
  );

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  if (error || !data) {
    return (
      <PageContainer>
        <div className="py-16 text-center">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load weblog events"}
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href={`/analysis/${id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to run
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="mb-3 px-0" asChild>
            <Link href={`/analysis/${id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to run
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-normal">Processed weblog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run {data.run.runNumber} · {data.run.pipelineId} · {data.run.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void mutate()}
            disabled={isValidating}
          >
            {isValidating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a
              href={`/api/pipelines/runs/${id}/weblog?limit=500`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Braces className="mr-2 h-4 w-4" />
              Raw JSON
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <GlassCard>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Events loaded</dt>
              <dd className="mt-1 font-mono text-lg font-semibold">{data.count}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Latest event</dt>
              <dd className="mt-1 font-medium">{formatRelativeTime(latestEvent?.occurredAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Statuses</dt>
              <dd className="mt-1 truncate font-mono text-xs" title={statusSummary || "-"}>
                {statusSummary || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sources</dt>
              <dd className="mt-1 truncate font-mono text-xs" title={sourceSummary || "-"}>
                {sourceSummary || "-"}
              </dd>
            </div>
          </dl>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Webhook target</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.webhook.method} endpoint used by Nextflow callbacks
              </p>
            </div>
            <Badge variant={data.webhook.tokenRequired ? "warning" : "outline"}>
              {data.webhook.tokenRequired ? "Token required" : "No token"}
            </Badge>
          </div>
          <p className="mt-3 break-all rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
            {data.webhook.endpoint}
          </p>
        </GlassCard>
      </div>

      <GlassCard className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Event timeline</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Newest events first, with Nextflow payload details folded under each row.
            </p>
          </div>
          <Badge variant="outline">{events.length} rows</Badge>
        </div>

        {events.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No weblog events have been stored for this run yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </GlassCard>
    </PageContainer>
  );
}
