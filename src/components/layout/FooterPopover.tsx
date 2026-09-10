"use client";

import { useId, useRef, type ReactElement, type ReactNode } from "react";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Footer panels share viewport-aware positioning, keyboard dismissal and scrolling. */
export function FooterPopover({
  open,
  onOpenChange,
  trigger,
  title,
  subtitle,
  actions,
  width = 420,
  align = "start",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  width?: number;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align={align}
        sideOffset={10}
        collisionPadding={8}
        sticky="always"
        aria-labelledby={titleId}
        className="flex flex-col overflow-hidden bg-background text-xs text-foreground shadow-xl motion-reduce:animate-none"
        style={{
          width,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "min(70dvh, var(--radix-popover-content-available-height))",
        }}
        onOpenAutoFocus={(event) => {
          // Opening a status panel must not focus a worker or notification action.
          event.preventDefault();
          closeRef.current?.focus();
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 py-1 [overflow-wrap:anywhere]">
            <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              ref={closeRef}
              type="button"
              aria-label={`Close ${title.toLowerCase()}`}
              title="Close"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div
          role="region"
          aria-label={`${title} content`}
          tabIndex={0}
          className="min-h-0 overflow-y-auto overscroll-contain p-3 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
