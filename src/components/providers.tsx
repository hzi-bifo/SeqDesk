"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { ModuleProvider } from "@/lib/modules";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { Toaster } from "@/components/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ModuleProvider>
        <ConfirmDialogProvider>
          {children}
          <Toaster />
        </ConfirmDialogProvider>
      </ModuleProvider>
    </SessionProvider>
  );
}
