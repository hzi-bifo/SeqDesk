export interface QuickPrerequisiteStatus {
  ready: boolean;
  summary: string;
  checkedAt: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEY = "seqdesk:quick-prerequisite-status:v1";

let memoryCache: QuickPrerequisiteStatus | null = null;
let inflightRequest: Promise<QuickPrerequisiteStatus> | null = null;

function getSessionStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage;
}

export function createFallbackQuickPrerequisiteStatus(
  summary = "Could not check system"
): QuickPrerequisiteStatus {
  return {
    ready: false,
    summary,
    checkedAt: Date.now(),
  };
}

export function normalizeQuickPrerequisiteStatus(
  value: unknown,
  checkedAt = Date.now()
): QuickPrerequisiteStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    ready?: unknown;
    summary?: unknown;
    checkedAt?: unknown;
  };

  if (typeof candidate.ready !== "boolean") {
    return null;
  }

  if (typeof candidate.summary !== "string" || !candidate.summary.trim()) {
    return null;
  }

  return {
    ready: candidate.ready,
    summary: candidate.summary.trim(),
    checkedAt:
      typeof candidate.checkedAt === "number" && Number.isFinite(candidate.checkedAt)
        ? candidate.checkedAt
        : checkedAt,
  };
}

export function getMemoryQuickPrerequisiteStatus(): QuickPrerequisiteStatus | null {
  return memoryCache;
}

export function readCachedQuickPrerequisiteStatus(
  storage: StorageLike | null = getSessionStorage()
): QuickPrerequisiteStatus | null {
  if (memoryCache) {
    return memoryCache;
  }

  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = normalizeQuickPrerequisiteStatus(JSON.parse(raw));
    if (!parsed) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }

    memoryCache = parsed;
    return parsed;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function writeCachedQuickPrerequisiteStatus(
  status: QuickPrerequisiteStatus,
  storage: StorageLike | null = getSessionStorage()
): void {
  memoryCache = status;

  if (!storage) {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch {
    // Ignore storage write failures and keep the in-memory cache.
  }
}

export function clearQuickPrerequisiteStatusCache(
  storage: StorageLike | null = getSessionStorage()
): void {
  memoryCache = null;
  inflightRequest = null;

  if (!storage) {
    return;
  }

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export async function refreshQuickPrerequisiteStatus({
  force = false,
  storage = getSessionStorage(),
  fetchImpl = fetch,
}: {
  force?: boolean;
  storage?: StorageLike | null;
  fetchImpl?: typeof fetch;
} = {}): Promise<QuickPrerequisiteStatus> {
  if (!force) {
    const cached = readCachedQuickPrerequisiteStatus(storage);
    if (cached) {
      return cached;
    }
  }

  if (inflightRequest) {
    return inflightRequest;
  }

  inflightRequest = (async () => {
    const response = await fetchImpl(
      "/api/admin/settings/pipelines/check-prerequisites?quick=true"
    );

    if (!response.ok) {
      throw new Error("Could not check system");
    }

    const payload = normalizeQuickPrerequisiteStatus(await response.json());
    if (!payload) {
      throw new Error("Could not check system");
    }

    writeCachedQuickPrerequisiteStatus(payload, storage);
    return payload;
  })();

  try {
    return await inflightRequest;
  } finally {
    inflightRequest = null;
  }
}
