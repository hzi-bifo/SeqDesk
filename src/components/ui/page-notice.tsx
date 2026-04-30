"use client";

import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type PageNoticeVariant = "info" | "warning" | "error" | "success";

interface PageNoticeProps {
  variant?: PageNoticeVariant;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const variantStyles: Record<
  PageNoticeVariant,
  {
    root: string;
    icon: string;
    title: string;
    body: string;
    Icon: typeof Info;
  }
> = {
  info: {
    root: "border-blue-200/70 bg-blue-50/35",
    icon: "bg-blue-100 text-blue-700 ring-blue-200",
    title: "text-blue-950",
    body: "text-blue-800",
    Icon: Info,
  },
  warning: {
    root: "border-amber-200/80 bg-amber-50/35",
    icon: "bg-amber-100 text-amber-700 ring-amber-200",
    title: "text-amber-950",
    body: "text-amber-800",
    Icon: AlertTriangle,
  },
  error: {
    root: "border-destructive/25 bg-destructive/5",
    icon: "bg-destructive/10 text-destructive ring-destructive/20",
    title: "text-destructive",
    body: "text-destructive/90",
    Icon: AlertCircle,
  },
  success: {
    root: "border-emerald-200/80 bg-emerald-50/45",
    icon: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    title: "text-emerald-950",
    body: "text-emerald-800",
    Icon: CheckCircle2,
  },
};

export function PageNotice({
  variant = "info",
  title,
  children,
  actions,
  onDismiss,
  className,
}: PageNoticeProps) {
  const styles = variantStyles[variant];
  const Icon = styles.Icon;

  return (
    <div
      className={cn("border-y px-6 py-3", styles.root, className)}
      role={variant === "error" ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1", styles.icon)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          {title ? <p className={cn("text-sm font-medium", styles.title)}>{title}</p> : null}
          <div className={cn("text-sm leading-5", title ? "mt-0.5" : "", styles.body)}>{children}</div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label="Dismiss notice"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
