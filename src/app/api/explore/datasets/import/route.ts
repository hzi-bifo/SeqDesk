import { NextRequest, NextResponse } from "next/server";
import { importDatasetFromForm, isImportInputError } from "@/lib/explore/dataset-import";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import an XLSX, CSV or TSV file as an external dataset. Fields and the
 * `?preview=1` behaviour are documented on importDatasetFromForm.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    if (session.user.isDemo) throw new ExploreRouteError(403, "Imports are disabled in the public demo.");
    const form = await request.formData();
    const result = await importDatasetFromForm(session, form, request.nextUrl.searchParams.get("preview") === "1");
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (isImportInputError(error)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    return exploreErrorResponse(error);
  }
}
