import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkbenchPageHeaderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  badge?: string;
}

interface WorkbenchEmptyPanelProps {
  title: string;
  description: string;
  icon: LucideIcon;
  columns?: string[];
}

interface WorkbenchStatusBadgeProps {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "warning";
}

export function WorkbenchPageHeader({
  title,
  description,
  icon: Icon,
  badge = "Private workspace",
}: WorkbenchPageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-200">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            <WorkbenchStatusBadge tone="accent">{badge}</WorkbenchStatusBadge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </header>
  );
}

export function WorkbenchEmptyPanel({
  title,
  description,
  icon: Icon,
  columns,
}: WorkbenchEmptyPanelProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      {columns && columns.length > 0 && (
        <div className="grid border-b border-border bg-secondary/30 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid-cols-4">
          {columns.map((column) => (
            <div key={column} className="hidden px-4 py-3 first:block md:block">
              {column}
            </div>
          ))}
        </div>
      )}
      <div className="flex min-h-56 flex-col items-center justify-center px-6 py-12 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>
      </div>
    </section>
  );
}

export function WorkbenchStatusBadge({
  children,
  tone = "neutral",
}: WorkbenchStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "accent" && "bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200",
        tone === "neutral" && "bg-secondary text-muted-foreground",
        tone === "warning" && "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
      )}
    >
      {children}
    </span>
  );
}
