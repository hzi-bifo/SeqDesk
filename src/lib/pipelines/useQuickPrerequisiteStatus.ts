"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  createFallbackQuickPrerequisiteStatus,
  getMemoryQuickPrerequisiteStatus,
  refreshQuickPrerequisiteStatus,
  readCachedQuickPrerequisiteStatus,
  type QuickPrerequisiteStatus,
} from "@/lib/pipelines/quick-prerequisite-status";

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useQuickPrerequisiteStatus() {
  const initialStatus = getMemoryQuickPrerequisiteStatus();
  const [systemReady, setSystemReady] = useState<QuickPrerequisiteStatus | null>(
    initialStatus
  );
  const [cacheResolved, setCacheResolved] = useState(initialStatus !== null);
  const [checkingSystem, setCheckingSystem] = useState(initialStatus === null);

  useBrowserLayoutEffect(() => {
    if (systemReady) {
      setCacheResolved(true);
      return;
    }

    const cached = readCachedQuickPrerequisiteStatus();
    if (cached) {
      setSystemReady(cached);
      setCheckingSystem(false);
    }

    setCacheResolved(true);
  }, [systemReady]);

  useEffect(() => {
    if (!cacheResolved || systemReady) {
      return;
    }

    let cancelled = false;

    setCheckingSystem(true);

    void refreshQuickPrerequisiteStatus()
      .then((nextStatus) => {
        if (!cancelled) {
          setSystemReady(nextStatus);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSystemReady(createFallbackQuickPrerequisiteStatus());
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingSystem(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheResolved, systemReady]);

  const refreshSystemReady = useCallback(async () => {
    setCheckingSystem(true);

    try {
      const nextStatus = await refreshQuickPrerequisiteStatus({ force: true });
      setSystemReady(nextStatus);
      return nextStatus;
    } catch {
      const fallback = systemReady ?? createFallbackQuickPrerequisiteStatus();
      if (!systemReady) {
        setSystemReady(fallback);
      }
      return fallback;
    } finally {
      setCheckingSystem(false);
    }
  }, [systemReady]);

  return {
    systemReady,
    checkingSystem,
    refreshSystemReady,
    initialCheckPending: checkingSystem && systemReady === null,
    systemBlocked: systemReady !== null && !systemReady.ready,
  };
}
