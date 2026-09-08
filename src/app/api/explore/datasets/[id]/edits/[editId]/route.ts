import { NextRequest, NextResponse } from "next/server";
import { revokeEdit } from "@/lib/explore/edits";
import { ExploreRouteError, exploreErrorResponse, loadAccessibleDataset, requireExploreSession } from "../../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; editId: string }> };

/** Revoking an edit keeps it in the audit trail but stops applying it. */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id, editId } = await context.params;
    await loadAccessibleDataset(session, id, "write");
    const revoked = await revokeEdit(editId, id, session.user.id);
    if (!revoked) throw new ExploreRouteError(404, "Edit not found or already revoked");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
