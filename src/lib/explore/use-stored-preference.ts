"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();

function subscribe(key: string, callback: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(callback);
  listeners.set(key, set);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    set.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A browser-remembered preference that hydrates safely: the server snapshot
 * is the fallback, the client snapshot comes from localStorage after mount.
 */
export function useStoredPreference<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    (callback) => subscribe(key, callback),
    () => {
      const stored = read(key) as T | null;
      if (stored === null) return fallback;
      return allowed && !allowed.includes(stored) ? fallback : stored;
    },
    () => fallback
  );
  const setValue = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Storage may be unavailable; listeners still get the in-memory update.
      }
      for (const callback of listeners.get(key) ?? []) callback();
    },
    [key]
  );
  return [value, setValue];
}
