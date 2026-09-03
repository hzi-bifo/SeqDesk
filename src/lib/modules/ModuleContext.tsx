"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
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

  // Load module states from API
  const loadModuleStates = async () => {
    try {
      const res = await fetch("/api/modules");
      if (res.ok) {
        const data = await res.json();
        setModuleStates(
          data.modules && typeof data.modules === "object" ? data.modules : {}
        );
        setIncompatibleModules(
          Array.isArray(data.incompatibleModules)
            ? data.incompatibleModules.filter(
                (moduleId: unknown): moduleId is string =>
                  typeof moduleId === "string"
              )
            : []
        );
        setGlobalDisabledState(data.globalDisabled || false);
      }
    } catch (error) {
      console.error("Failed to load module states:", error);
      // Without a server-resolved profile, fail closed rather than exposing
      // facility defaults in a Workbench installation.
      setModuleStates({});
      setIncompatibleModules([]);
      setGlobalDisabledState(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModuleStates();
  }, []);

  const isModuleEnabled = (moduleId: string): boolean => {
    if (incompatibleModules.includes(moduleId)) return false;
    if (loading) return false;
    if (isAlwaysEnabledModule(moduleId)) return moduleStates[moduleId] === true;
    // If global disabled, everything is off
    if (globalDisabled) return false;
    return moduleStates[moduleId] ?? false;
  };

  const setModuleEnabled = async (moduleId: string, enabled: boolean) => {
    // Optimistic update
    setModuleStates((prev) => ({ ...prev, [moduleId]: enabled }));

    try {
      const res = await fetch("/api/admin/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId, enabled }),
      });

      if (!res.ok) {
        // Revert on failure
        setModuleStates((prev) => ({ ...prev, [moduleId]: !enabled }));
        throw new Error("Failed to update module");
      }
    } catch (error) {
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
        // Revert on failure
        setGlobalDisabledState(prevState);
        throw new Error("Failed to update global setting");
      }
    } catch (error) {
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
