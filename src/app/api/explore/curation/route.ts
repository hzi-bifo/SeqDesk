import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { deleteCurationList, listCurationLists, listCurationSeeds, upsertCurationList, type CurationEntry, type UpsertCurationListInput } from "@/lib/explore/curation";
import { ExploreRouteError, exploreErrorResponse, optionalString, readJsonBody, requireExploreSession, requireString } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "read");
    const [lists, seeds] = await Promise.all([listCurationLists(targetKey), listCurationSeeds()]);
    return NextResponse.json({ lists, seeds });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

function parseEntries(raw: unknown): CurationEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return { name: entry };
      if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
        const value = entry as { name: string; note?: unknown; refs?: unknown };
        return {
          name: value.name,
          note: typeof value.note === "string" ? value.note.slice(0, 2000) : undefined,
          refs: Array.isArray(value.refs) ? value.refs.filter((ref): ref is string => typeof ref === "string").slice(0, 20) : undefined,
        };
      }
      return null;
    })
    .filter((entry): entry is CurationEntry => Boolean(entry && entry.name.trim()));
}

/** Create or replace one list of the scope. */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const body = await readJsonBody(request);
    const targetKey = requireString(body.targetKey, "targetKey");
    await requireTargetAccess(session, targetKey, "write");
    const input: UpsertCurationListInput = {
      listId: requireString(body.listId, "listId", 64),
      label: requireString(body.label, "label", 120),
      role: body.role as UpsertCurationListInput["role"],
      site: optionalString(body.site, 80),
      tier: optionalString(body.tier, 40),
      color: optionalString(body.color, 7),
      entries: parseEntries(body.entries),
    };
    try {
      await upsertCurationList(targetKey, input);
    } catch (error) {
      throw new ExploreRouteError(400, error instanceof Error ? error.message : "Invalid list");
    }
    return NextResponse.json({ lists: await listCurationLists(targetKey) });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    const listId = request.nextUrl.searchParams.get("listId") ?? "";
    await requireTargetAccess(session, targetKey, "write");
    const deleted = await deleteCurationList(targetKey, listId);
    if (!deleted) throw new ExploreRouteError(404, "List not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
