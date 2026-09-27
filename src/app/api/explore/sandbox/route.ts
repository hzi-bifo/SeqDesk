import { NextRequest, NextResponse } from "next/server";
import { canManageExplore } from "@/lib/explore/authorization";
import { collectHostFacts } from "@/lib/explore/sandbox/host";
import { getSandboxSettings, saveSandboxSettings } from "@/lib/explore/sandbox/settings";
import { effectiveStorageSettings, getStoredStorageSettings, saveStorageSettings, StorageSettingsError } from "@/lib/explore/storage-settings";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { ExploreRouteError, exploreErrorResponse, readJsonBody, requireExploreSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How analysis runs are confined on this host, and the settings that decide it. */
export async function GET() {
  try {
    const session = await requireExploreSession();
    const manage = canManageExplore(session);
    const [settings, facts] = await Promise.all([getSandboxSettings(), collectHostFacts()]);
    // Paths are for pipeline managers only; everyone else sees the isolation summary.
    const storage = manage ? await storageStatus() : null;
    return NextResponse.json({
      settings,
      host: {
        platform: facts.platform,
        tool: facts.toolName,
        toolPath: manage ? facts.tool : null,
        problem: facts.problem,
        limits: facts.limits ?? null,
      },
      ...(storage ? { storage } : {}),
    });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

async function storageStatus() {
  const [stored, effective, dataPath] = await Promise.all([getStoredStorageSettings(), effectiveStorageSettings(), getResolvedDataBasePath()]);
  return { stored, effective, dataBasePath: dataPath.dataBasePath, dataBasePathSource: dataPath.source };
}

/**
 * Save the isolation settings (the body) and, when present, `storage`
 * ({ exploreDir, pruneAfterDays }). Storage is validated first, so a bad
 * folder saves nothing.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    if (!canManageExplore(session)) throw new ExploreRouteError(403, "Pipeline management permission is required to configure analysis isolation");
    const body = await readJsonBody(request) as Record<string, unknown>;
    const { storage, ...sandbox } = body && typeof body === "object" ? body : {};
    if (storage !== undefined) {
      try {
        await saveStorageSettings(storage);
      } catch (error) {
        if (error instanceof StorageSettingsError) throw new ExploreRouteError(422, error.message);
        throw error;
      }
    }
    const settings = await saveSandboxSettings(sandbox);
    return NextResponse.json({ settings, storage: await storageStatus() });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
