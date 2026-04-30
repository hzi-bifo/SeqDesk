"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepProgressNavItem {
  id: string;
  title: string;
}

interface StepProgressNavProps<TStep extends StepProgressNavItem> {
  steps: TStep[];
  currentIndex: number;
  onNavigate: (step: TStep, index: number) => void;
  className?: string;
  ariaLabel?: string;
}

export function StepProgressNav<TStep extends StepProgressNavItem>({
  steps,
  currentIndex,
  onNavigate,
  className,
  ariaLabel = "Form progress",
}: StepProgressNavProps<TStep>) {
  if (steps.length === 0) return null;

  const safeCurrentIndex = Math.min(Math.max(currentIndex, 0), steps.length - 1);

  return (
    <nav aria-label={ariaLabel} className={className}>
      <div
        className="grid h-10 gap-1 rounded-lg border border-border bg-secondary p-1"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, index) => {
          const isCompleted = index < safeCurrentIndex;
          const isCurrent = index === safeCurrentIndex;
          const isClickable = isCompleted;

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                if (isClickable) {
                  onNavigate(step, index);
                }
              }}
              disabled={!isClickable}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex h-full min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                isCurrent && "bg-foreground text-background font-semibold shadow-sm",
                isCompleted && "bg-background text-foreground shadow-sm",
                !isCurrent && !isCompleted && "text-muted-foreground",
                isClickable
                  ? "cursor-pointer hover:bg-background/80 hover:text-foreground"
                  : "cursor-default"
              )}
              title={isClickable ? `Go back to ${step.title}` : step.title}
            >
              {isCompleted && <Check className="h-3 w-3 shrink-0" />}
              <span className="truncate">{step.title}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
