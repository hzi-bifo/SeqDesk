import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type LoadingVariant = "report" | "cards" | "table" | "chart" | "metric" | "metrics" | "canvas" | "text";

function LoadingStatus({ label, className, children, height }: {
  label: string; className?: string; children: ReactNode; height?: number | string;
}) {
  return <div role="status" aria-label={label} aria-busy="true" className={cn("min-w-0", className)} style={height === undefined ? undefined : { height }}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className="h-full min-w-0">{children}</div>
  </div>;
}

function TableShapes() {
  return <div className="flex h-full min-h-40 flex-col overflow-hidden rounded-lg border bg-card">
    <div className="grid grid-cols-3 gap-5 border-b bg-muted/30 px-4 py-3">
      {[0, 1, 2].map(key => <Skeleton key={key} className="h-3 w-3/5" />)}
    </div>
    {Array.from({ length: 5 }, (_, row) => <div key={row} className="grid flex-1 grid-cols-3 items-center gap-5 border-b border-border/50 px-4 py-3 last:border-0">
      {["w-4/5", "w-3/5", "w-2/3"].map((width, column) => <Skeleton key={column} className={cn("h-2.5", width, row % 2 === 1 && "opacity-60")} />)}
    </div>)}
  </div>;
}

function ChartShapes() {
  return <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden rounded-lg border bg-card p-4">
    <Skeleton className="h-3 w-2/5 shrink-0" />
    <div className="flex min-h-12 flex-1 items-end gap-3 border-b border-l border-border/70 px-4 pb-1 pt-4">
      {/* Decorative placeholders only, not a preview of scientific measurements. */}
      {["h-2/5", "h-3/5", "h-1/2", "h-4/5", "h-2/3"].map((height, key) => <Skeleton key={key} className={cn("min-w-0 flex-1 rounded-b-none opacity-60", height)} />)}
    </div>
    <div className="flex shrink-0 justify-center gap-3"><Skeleton className="h-2 w-12" /><Skeleton className="h-2 w-16" /></div>
  </div>;
}

function CardShapes() {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {[0, 1, 2].map(key => <div key={key} className="space-y-3 rounded-lg border bg-card p-4">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="mt-5 h-3 w-1/2" />
    </div>)}
  </div>;
}

function ReportShapes() {
  return <div className="space-y-6 py-6">
    <Skeleton className="h-8 w-2/3 max-w-md" />
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <Skeleton className="mb-5 h-5 w-2/5" />
      <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-11/12" /><Skeleton className="h-3 w-3/4" />
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="h-60"><ChartShapes /></div>
      <div className="h-60"><TableShapes /></div>
    </div>
  </div>;
}

function CanvasShapes() {
  return <div className="relative h-full min-h-64 overflow-hidden rounded-lg border bg-muted/20 p-5">
    <div className="mb-12 flex justify-end gap-2"><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-20" /></div>
    <div className="grid max-w-4xl grid-cols-2 items-center gap-6 md:grid-cols-3">
      {[0, 1, 2].map(key => <div key={key} className={cn("space-y-3 rounded-xl border bg-card p-4", key === 1 && "mt-20", key === 2 && "hidden md:block")}>
        <Skeleton className="h-4 w-3/4" /><Skeleton className="h-20 w-full" /><Skeleton className="h-3 w-1/2" />
      </div>)}
    </div>
    <Skeleton className="absolute bottom-4 left-4 h-8 w-28" />
  </div>;
}

/** Shared by every pipeline's outputs; only the expected content shape changes. */
export function ExploreLoading({ variant, label, height, className }: {
  variant: LoadingVariant; label: string; height?: number | string; className?: string;
}) {
  return <LoadingStatus label={label} height={height} className={className}>
    {variant === "report" ? <ReportShapes />
      : variant === "table" ? <TableShapes />
        : variant === "chart" ? <ChartShapes />
          : variant === "cards" ? <CardShapes />
            : variant === "canvas" ? <CanvasShapes />
              : variant === "text" ? <div className="space-y-3 overflow-hidden rounded-lg border bg-card p-4"><Skeleton className="mb-5 h-4 w-1/3" />{["w-full", "w-4/5", "w-full", "w-2/3"].map((width, key) => <Skeleton key={key} className={cn("h-3", width)} />)}</div>
              : <div className={cn("grid h-full gap-3", variant === "metrics" && "grid-cols-3")}>{(variant === "metric" ? [0] : [0, 1, 2]).map(key => <div key={key} className="flex flex-col justify-center gap-3 rounded-lg border bg-card p-3"><Skeleton className="h-2 w-3/4" /><Skeleton className="h-6 w-1/2" /></div>)}</div>}
  </LoadingStatus>;
}

/** Keep the report header, document and (requested) editor sidebar in place on first load. */
export function ReportLoadingLayout({ view = "page", sidebar = false }: {
  view?: "page" | "canvas" | "list"; sidebar?: boolean;
}) {
  return <LoadingStatus label="Loading report…">
    <div className="flex min-w-0 items-start">
      <div className="min-w-0 flex-1">
        <PageContainer className="border-b py-3 md:py-3"><div className="flex h-9 items-center justify-between gap-4"><Skeleton className="h-4 w-24" /><div className="flex gap-2"><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-16" /></div></div></PageContainer>
        <PageContainer className="pt-0 md:pt-0">
          {view === "page" ? <ReportShapes /> : view === "canvas" ? <div className="mt-3 h-[560px]"><CanvasShapes /></div> : <div className="space-y-8 pt-6"><TableShapes /><TableShapes /></div>}
        </PageContainer>
      </div>
      {sidebar && <div data-report-loading-sidebar className="hidden min-h-[calc(100dvh-var(--seqdesk-footer-height,2.5rem))] w-80 shrink-0 border-l bg-card lg:block">
        <div className="flex h-[61px] items-center border-b px-3"><Skeleton className="h-4 w-28" /></div>
        <div className="space-y-6 p-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-28 w-full" /><Skeleton className="h-3 w-2/3" />{[0, 1, 2, 3].map(key => <div key={key} className="flex items-center gap-3"><Skeleton className="h-10 w-14" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-2 w-full" /></div></div>)}</div>
      </div>}
    </div>
  </LoadingStatus>;
}
