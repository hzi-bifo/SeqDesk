"use client";

import React, { ReactNode } from "react";
import { useModule } from "./ModuleContext";

interface ModuleGateProps {
  moduleId: string;
  children: ReactNode;
  // What to show when module is disabled
  fallback?: "hide" | "message" | ReactNode;
  // For admin views - show greyed out content with enable link
  adminView?: boolean;
}

/**
 * Gate component that only renders children if the module is enabled.
 * Use this to wrap features that depend on a module.
 *
 * Usage:
 * <ModuleGate moduleId="ai-validation">
 *   <AIValidationFeature />
 * </ModuleGate>
 *
 * Or with custom fallback:
 * <ModuleGate moduleId="ai-validation" fallback="hide">
 *   ...
 * </ModuleGate>
 */
export function ModuleGate({ moduleId, children, fallback = "message", adminView = false }: ModuleGateProps) {
  const { enabled, module } = useModule(moduleId);

  if (enabled) {
    return <>{children}</>;
  }

  // Handle fallback
  if (fallback === "hide") {
    return null;
  }

  if (React.isValidElement(fallback)) {
    return fallback;
  }

  if (adminView) {
    // Admin view - show greyed out content with enable message
    return (
      <div className="opacity-50">
        {children}
        <p className="text-xs text-muted-foreground mt-2">
          Enable in <a href="/admin/modules" className="text-primary hover:underline">Modules</a> to activate
        </p>
      </div>
    );
  }

  // User-facing message (more subtle)
  return (
    <div className="text-sm text-muted-foreground italic p-2">
      This feature is not currently available.
    </div>
  );
}

/**
 * Hook-based alternative for conditional rendering in code
 */
export function useModuleGate(moduleId: string) {
  const { enabled, module } = useModule(moduleId);
  return { enabled, module };
}
