"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import {
  AVAILABLE_MODULES,
  getModuleDefinition,
  isAlwaysEnabledModule,
  ModuleDefinition,
} from "./types";

interface ModuleContextValue {
  // Check if a module is enabled
  isModuleEnabled: (moduleId: string) => boolean;
  // Get all module states
  moduleStates: Record<string, boolean>;
  // Get module definition
  getModule: (moduleId: string) => ModuleDefinition | undefined;
  // All available modules
  availableModules: ModuleDefinition[];
  // Loading state
  loading: boolean;
  // A failed load is unknown state, not an installation with everything disabled.
  error: string | null;
  // For admin: update module state
  setModuleEnabled: (moduleId: string, enabled: boolean) => Promise<void>;
  // Refresh from server
  refresh: () => Promise<void>;
  // Global disable state
  globalDisabled: boolean;
  // Modules excluded by the installation-wide deployment profile
  incompatibleModules: string[];
  // Set global disabled
  setGlobalDisabled: (disabled: boolean) => Promise<void>;
}

const ModuleContext = createContext<ModuleContextValue | undefined>(undefined);

export function ModuleProvider({ children }: { children: ReactNode }) {
  const [moduleStates, setModuleStates] = useState<Record<string, boolean>>({});
  const [incompatibleModules, setIncompatibleModules] = useState<string[]>([]);
  const [globalDisabled, setGlobalDisabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load module states from API
  const loadModuleStates = useCallback(async () => {
    try {
      const res = await fetch("/api/modules");
      if (!res.ok) throw new Error("Could not load module settings. Please try again.");
      const data = await res.json();
      if (!data || !data.modules || typeof data.modules !== "object" || Array.isArray(data.modules)) {
        throw new Error("The module settings response was invalid. Please try again.");
      }
      setModuleStates(data.modules);
      setIncompatibleModules(
        Array.isArray(data.incompatibleModules)
          ? data.incompatibleModules.filter(
              (moduleId: unknown): moduleId is string => typeof moduleId === "string"
            )
          : []
      );
      setGlobalDisabledState(data.globalDisabled === true);
      setError(null);
    } catch (error) {
      console.error("Failed to load module states:", error);
      // Keep the last known values for display, but fail closed until a retry
      // succeeds. A failed refresh must not look like all modules were disabled.
      setError("Could not load module settings. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModuleStates();
  }, [loadModuleStates]);

  const isModuleEnabled = (moduleId: string): boolean => {
    if (incompatibleModules.includes(moduleId)) return false;
    if (loading || error) return false;
    if (isAlwaysEnabledModule(moduleId)) return moduleStates[moduleId] === true;
    // If global disabled, everything is off
    if (globalDisabled) return false;
    return moduleStates[moduleId] ?? false;
  };

  const setModuleEnabled = async (moduleId: string, enabled: boolean) => {
    const previousEnabled = moduleStates[moduleId] ?? false;
    // Optimistic update
    setModuleStates((prev) => ({ ...prev, [moduleId]: enabled }));

    try {
      const res = await fetch("/api/admin/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId, enabled }),
      });

      if (!res.ok) {
        throw new Error("Failed to update module");
      }
    } catch (error) {
      setModuleStates((prev) => ({ ...prev, [moduleId]: previousEnabled }));
      console.error("Failed to update module:", error);
      throw error;
    }
  };

  const setGlobalDisabled = async (disabled: boolean) => {
    // Optimistic update
    const prevState = globalDisabled;
    setGlobalDisabledState(disabled);

    try {
      const res = await fetch("/api/admin/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalDisabled: disabled }),
      });

      if (!res.ok) {
        throw new Error("Failed to update global setting");
      }
    } catch (error) {
      setGlobalDisabledState(prevState);
      console.error("Failed to update global setting:", error);
      throw error;
    }
  };

  const value: ModuleContextValue = {
    isModuleEnabled,
    moduleStates,
    getModule: getModuleDefinition,
    availableModules: AVAILABLE_MODULES,
    loading,
    error,
    setModuleEnabled,
    refresh: loadModuleStates,
    globalDisabled,
    incompatibleModules,
    setGlobalDisabled,
  };

  return (
    <ModuleContext.Provider value={value}>
      {children}
    </ModuleContext.Provider>
  );
}

// Hook to use modules
export function useModules() {
  const context = useContext(ModuleContext);
  if (!context) {
    throw new Error("useModules must be used within a ModuleProvider");
  }
  return context;
}

// Convenience hook for checking a single module
export function useModule(moduleId: string) {
  const { isModuleEnabled, getModule } = useModules();
  return {
    enabled: isModuleEnabled(moduleId),
    module: getModule(moduleId),
  };
}

// Non-throwing single-module gate. Returns false when rendered outside a
// ModuleProvider (e.g. isolated component tests), so callers that only need a
// boolean don't require the provider to be present.
export function useModuleEnabled(moduleId: string): boolean {
  const context = useContext(ModuleContext);
  return context ? context.isModuleEnabled(moduleId) : false;
}
