"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import { ModuleProvider } from "@/lib/modules";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ModuleProvider>
        {children}
      </ModuleProvider>
    </SessionProvider>
  );
}
