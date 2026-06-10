"use client";

/**
 * Promise-based confirmation dialog.
 *
 * Replaces native window.confirm() with a styled, branded dialog that matches
 * the rest of the app. Usage:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete run?", variant: "destructive" }))) return;
 *
 * Mount <ConfirmDialogProvider> once near the app root (see providers.tsx).
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (result: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const close = React.useCallback((result: boolean) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        {pending && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{pending.options.title}</DialogTitle>
              {pending.options.description != null && (
                <DialogDescription asChild>
                  <div>{pending.options.description}</div>
                </DialogDescription>
              )}
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                {pending.options.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={pending.options.variant === "destructive" ? "destructive" : "default"}
                onClick={() => close(true)}
                autoFocus
              >
                {pending.options.confirmLabel ?? "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

// Used when no ConfirmDialogProvider is mounted (e.g. unit tests or isolated
// rendering). Falls back to the native confirm so behaviour is preserved without
// the styled dialog, rather than throwing and breaking the whole tree.
const fallbackConfirm: ConfirmFn = async (options) => {
  if (typeof window === "undefined") return false;
  const description =
    typeof options.description === "string" ? options.description : "";
  const message = description ? `${options.title}\n\n${description}` : options.title;
  return window.confirm(message);
};

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  return ctx ?? fallbackConfirm;
}
