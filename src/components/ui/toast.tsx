"use client";

/**
 * Lightweight, dependency-free transient toast notifications.
 *
 * Unlike `notifyPanel` (which persists a notification to the server-side bell),
 * these are ephemeral, in-page confirmations for actions like "Saved" or
 * "Run started". The `toast` API mirrors `notifyPanel`'s shape
 * (`toast.success(...)`, `toast.error(...)`, ...) so call sites are familiar,
 * and it is backed by a module-level store so it can be called from anywhere —
 * event handlers, async callbacks, even outside React.
 *
 * Mount <Toaster /> once near the app root (see providers.tsx).
 */

import * as React from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  /** Optional secondary line under the message. */
  description?: string;
  /** Auto-dismiss after this many ms. 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, "duration">> {
  id: number;
  variant: ToastVariant;
  message: string;
  description?: string;
}

let counter = 0;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(items);
}

function addToast(
  variant: ToastVariant,
  message: string,
  options?: ToastOptions
): number {
  const id = ++counter;
  const duration = options?.duration ?? (variant === "error" ? 6000 : 4000);
  items = [...items, { id, variant, message, description: options?.description, duration }];
  emit();
  return id;
}

function dismissToast(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

export const toast = Object.assign(
  (message: string, options?: ToastOptions) => addToast("info", message, options),
  {
    success: (message: string, options?: ToastOptions) => addToast("success", message, options),
    error: (message: string, options?: ToastOptions) => addToast("error", message, options),
    warning: (message: string, options?: ToastOptions) => addToast("warning", message, options),
    info: (message: string, options?: ToastOptions) => addToast("info", message, options),
    dismiss: dismissToast,
  }
);

// Status colors follow docs/design.md (success=green, error=red, warning=amber,
// info=blue). A solid background keeps the toast legible over page content.
const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: string }> = {
  success: { border: "border-green-500/40", icon: "text-green-600" },
  error: { border: "border-red-500/40", icon: "text-red-600" },
  warning: { border: "border-amber-500/40", icon: "text-amber-600" },
  info: { border: "border-blue-500/40", icon: "text-blue-600" },
};

const VARIANT_ICONS: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  React.useEffect(() => {
    if (item.duration <= 0) return;
    const timer = setTimeout(onDismiss, item.duration);
    return () => clearTimeout(timer);
  }, [item.duration, onDismiss]);

  const Icon = VARIANT_ICONS[item.variant];
  const styles = VARIANT_STYLES[item.variant];

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg",
        styles.border
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", styles.icon)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground break-words">{item.message}</p>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground break-words">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Toaster() {
  const [current, setCurrent] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    const listener = (next: ToastItem[]) => setCurrent([...next]);
    listeners.add(listener);
    listener(items);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (current.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
    >
      {current.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={() => dismissToast(item.id)} />
      ))}
    </div>
  );
}
