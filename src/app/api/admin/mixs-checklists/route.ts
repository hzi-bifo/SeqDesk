import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { MixsChecklist, MixsConfig, MixsField } from "@/types/mixs-checklist";
import {
  getActiveMixsConfig,
  saveActiveMixsConfig,
  snapshotMixsConfig,
  getDefaultMixsSyncUrl,
  normalizeSyncUrl,
  resolveSyncUrl,
  loadBaselineConfig,
} from "@/lib/mixs/config";

// ---------------------------------------------------------------------------
// Remote registry fetch + parsing helpers.
// ---------------------------------------------------------------------------

interface RemotePayload {
  version: number;
  lastUpdated?: string;
  checklists: MixsChecklist[];
}

const normalizeRemotePayload = (raw: unknown): RemotePayload => {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    version: parseInt(String(obj.version ?? 0), 10) || 0,
    lastUpdated:
      typeof obj.lastUpdated === "string" ? obj.lastUpdated : undefined,
    checklists: Array.isArray(obj.checklists)
      ? (obj.checklists as MixsChecklist[])
      : [],
  };
};

const fetchRemoteRegistry = async (syncUrl: string): Promise<RemotePayload> => {
  const response = await fetch(syncUrl, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Registry returned ${response.status}`);
  }

  const remoteData = await response.json();
  const payload =
    remoteData?.config && typeof remoteData.config === "object"
      ? remoteData.config
      : remoteData;
  return normalizeRemotePayload(payload);
};

// ---------------------------------------------------------------------------
// Diff helpers (keyed by accession).
// ---------------------------------------------------------------------------

interface ChangedEntry {
  accession: string;
  name: string;
  newFields: string[];
  removedFields: string[];
  newlyRequired: string[];
}

interface MixsDiff {
  added: { accession: string; name: string }[];
  removed: { accession: string; name: string }[];
  changed: ChangedEntry[];
}

const byAccession = (checklists: MixsChecklist[]) =>
  new Map(checklists.map((c) => [c.accession, c]));

const requiredFieldNames = (fields: MixsField[]): Set<string> =>
  new Set(fields.filter((f) => f.required).map((f) => f.name));

const fieldNames = (fields: MixsField[]): Set<string> =>
  new Set(fields.map((f) => f.name));

const diffChecklist = (
  current: MixsChecklist,
  remote: MixsChecklist
): ChangedEntry | null => {
  const currentNames = fieldNames(current.fields ?? []);
  const remoteNames = fieldNames(remote.fields ?? []);
  const currentRequired = requiredFieldNames(current.fields ?? []);
  const remoteRequired = requiredFieldNames(remote.fields ?? []);

  const newFields = [...remoteNames].filter((n) => !currentNames.has(n));
  const removedFields = [...currentNames].filter((n) => !remoteNames.has(n));
  // Newly required: required in remote, but was optional or absent in current.
  const newlyRequired = [...remoteRequired].filter(
    (n) => !currentRequired.has(n)
  );

  if (
    newFields.length === 0 &&
    removedFields.length === 0 &&
    newlyRequired.length === 0
  ) {
    return null;
  }

  return {
    accession: remote.accession,
    name: remote.name,
    newFields,
    removedFields,
    newlyRequired,
  };
};

const computeDiff = (
  current: MixsConfig,
  remoteChecklists: MixsChecklist[]
): MixsDiff => {
  const activeCurrent = (current.checklists ?? []).filter((c) => !c.deprecated);
  const currentMap = byAccession(activeCurrent);
  const remoteMap = byAccession(remoteChecklists);

  const added = remoteChecklists
    .filter((c) => !currentMap.has(c.accession))
    .map((c) => ({ accession: c.accession, name: c.name }));

  const removed = activeCurrent
    .filter((c) => !remoteMap.has(c.accession))
    .map((c) => ({ accession: c.accession, name: c.name }));

  const changed: ChangedEntry[] = [];
  for (const remote of remoteChecklists) {
    const currentItem = currentMap.get(remote.accession);
    if (!currentItem) continue;
    const entry = diffChecklist(currentItem, remote);
    if (entry) changed.push(entry);
  }

  return { added, removed, changed };
};

// ---------------------------------------------------------------------------
// Non-destructive merge (keyed by accession).
// ---------------------------------------------------------------------------

const mergeChecklists = (
  current: MixsConfig,
  remoteChecklists: MixsChecklist[]
): { checklists: MixsChecklist[]; deprecated: MixsChecklist[] } => {
  const currentActive = (current.checklists ?? []).filter((c) => !c.deprecated);
  const currentMap = byAccession(currentActive);
  const remoteAccessions = new Set(remoteChecklists.map((c) => c.accession));

  const merged: MixsChecklist[] = [];
  for (const remote of remoteChecklists) {
    const local = currentMap.get(remote.accession);
    if (local?.localOverrides) {
      // Protect local edits: keep the local checklist verbatim.
      merged.push(local);
      continue;
    }
    if (local) {
      // Preserve admin's availability choice across the update.
      merged.push({
        ...remote,
        available: local.available ?? remote.available,
      });
      continue;
    }
    merged.push(remote);
  }

  // Removed upstream: retain current active checklists not in remote as deprecated.
  const removedUpstream: MixsChecklist[] = currentActive
    .filter((c) => !remoteAccessions.has(c.accession))
    .map((c) => ({ ...c, deprecated: true }));

  // Merge with any pre-existing deprecated list (dedupe by accession).
  const deprecatedMap = new Map<string, MixsChecklist>();
  for (const item of current.deprecated ?? []) {
    // If the accession reappears upstream, it is no longer deprecated.
    if (remoteAccessions.has(item.accession)) continue;
    deprecatedMap.set(item.accession, { ...item, deprecated: true });
  }
  for (const item of removedUpstream) {
    deprecatedMap.set(item.accession, item);
  }

  return { checklists: merged, deprecated: [...deprecatedMap.values()] };
};

const summarizeUpdate = (
  remoteVersion: number,
  diff: MixsDiff
): string => {
  const parts: string[] = [];
  if (diff.added.length) {
    parts.push(
      `${diff.added.length} new checklist${diff.added.length === 1 ? "" : "s"}`
    );
  }
  if (diff.removed.length) {
    parts.push(
      `${diff.removed.length} deprecated`
    );
  }
  if (diff.changed.length) {
    parts.push(`${diff.changed.length} changed`);
  }
  const detail = parts.length ? ` (${parts.join(", ")})` : "";
  return `Update available: v${remoteVersion}${detail}.`;
};

// ---------------------------------------------------------------------------
// GET — active config for any authenticated session.
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const active = await getActiveMixsConfig(db);
    const config: MixsConfig = {
      ...active,
      syncUrl: resolveSyncUrl(active),
    };

    return NextResponse.json({ config });
  } catch (error) {
    console.error("Error fetching MIxS checklists config:", error);
    return NextResponse.json(
      { error: "Failed to fetch config" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — admin hand-edit of the active config.
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { config } = body as { config: MixsConfig };

    if (!config) {
      return NextResponse.json({ error: "Config is required" }, { status: 400 });
    }

    if (!Array.isArray(config.checklists)) {
      return NextResponse.json(
        { error: "Checklists must be an array" },
        { status: 400 }
      );
    }

    const normalizedSyncUrl = normalizeSyncUrl(config.syncUrl);
    if (config.syncUrl && !normalizedSyncUrl) {
      return NextResponse.json(
        { error: "syncUrl must be a valid http(s) URL" },
        { status: 400 }
      );
    }

    const updatedConfig: MixsConfig = {
      ...config,
      deprecated: Array.isArray(config.deprecated) ? config.deprecated : [],
      syncUrl: normalizedSyncUrl || getDefaultMixsSyncUrl(),
      version: config.version ?? 1,
    };

    await saveActiveMixsConfig(db, updatedConfig);

    return NextResponse.json({ config: updatedConfig });
  } catch (error) {
    console.error("Error updating MIxS checklists config:", error);
    return NextResponse.json(
      { error: "Failed to update config" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — reset / check-updates / apply.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, syncUrl } = body as { action: string; syncUrl?: string };

    if (syncUrl && !normalizeSyncUrl(syncUrl)) {
      return NextResponse.json(
        { error: "syncUrl must be a valid http(s) URL" },
        { status: 400 }
      );
    }

    if (action === "reset") {
      const currentConfig = await getActiveMixsConfig(db);
      const effectiveSyncUrl = resolveSyncUrl(currentConfig, syncUrl);
      const baseline = loadBaselineConfig();
      const config: MixsConfig = { ...baseline, syncUrl: effectiveSyncUrl };

      await saveActiveMixsConfig(db, config);

      return NextResponse.json({
        config,
        message: "Reset to baseline checklists",
      });
    }

    if (action === "check-updates") {
      try {
        const currentConfig = await getActiveMixsConfig(db);
        const effectiveSyncUrl = resolveSyncUrl(currentConfig, syncUrl);
        const remote = await fetchRemoteRegistry(effectiveSyncUrl);

        const currentVersion = currentConfig.version || 0;
        const remoteVersion = remote.version || 0;
        const diff = computeDiff(currentConfig, remote.checklists);

        const hasUpdates =
          remoteVersion > currentVersion ||
          diff.added.length > 0 ||
          diff.removed.length > 0 ||
          diff.changed.length > 0;

        return NextResponse.json({
          hasUpdates,
          remoteVersion,
          currentVersion,
          added: diff.added,
          removed: diff.removed,
          changed: diff.changed,
          message: hasUpdates
            ? summarizeUpdate(remoteVersion, diff)
            : "Your MIxS checklists are up to date.",
        });
      } catch (error) {
        console.error("Error checking for MIxS updates:", error);
        return NextResponse.json({
          hasUpdates: false,
          error: true,
          message:
            "Failed to check for updates. Verify the registry sync URL is accessible.",
        });
      }
    }

    if (action === "apply") {
      try {
        const currentConfig = await getActiveMixsConfig(db);
        const effectiveSyncUrl = resolveSyncUrl(currentConfig, syncUrl);
        const remote = await fetchRemoteRegistry(effectiveSyncUrl);

        // Snapshot the OUTGOING config before applying the update.
        await snapshotMixsConfig(db, currentConfig);

        const { checklists, deprecated } = mergeChecklists(
          currentConfig,
          remote.checklists
        );

        const newConfig: MixsConfig = {
          version: remote.version,
          lastUpdated: remote.lastUpdated,
          lastSyncedAt: new Date().toISOString(),
          syncUrl: effectiveSyncUrl,
          checklists,
          deprecated,
        };

        await saveActiveMixsConfig(db, newConfig);

        return NextResponse.json({
          applied: true,
          config: newConfig,
          message: `Updated to version ${remote.version}.`,
        });
      } catch (error) {
        console.error("Error applying MIxS update:", error);
        return NextResponse.json({
          applied: false,
          error: true,
          message:
            "Failed to apply update. Verify the registry sync URL is accessible.",
        });
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error in MIxS checklists action:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
