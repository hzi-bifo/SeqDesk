import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { getDatasetRecord } from "@/lib/explore/datasets";
import { parseSchema } from "@/lib/explore/schema";
import { exploreErrorResponse, ExploreRouteError, requireExploreSession } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const MAX_VALUES = 200;

/** Distinct values of one column with their row counts, most frequent first; the basis of a page filter. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireExploreSession();
    const { id } = await context.params;
    const dataset = await getDatasetRecord(id);
    if (!dataset) throw new ExploreRouteError(404, "Not found");
    await requireTargetAccess(session, dataset.targetKey, "read");
    const column = request.nextUrl.searchParams.get("column") ?? "";
    const current = dataset.versions.find((version) => version.id === dataset.currentVersionId) ?? dataset.versions[0] ?? null;
    const schema = parseSchema(current?.schema);
    if (!current || !schema.columns.some((entry) => entry.key === column)) throw new ExploreRouteError(400, "Unknown column");
    const values = await db.$queryRaw<Array<{ value: string | null; count: bigint }>>(
      Prisma.sql`SELECT data->>${column} AS value, COUNT(*) AS count FROM "ExploreDatasetRow" WHERE "versionId" = ${current.id} GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT ${MAX_VALUES + 1}`
    );
    return NextResponse.json({
      column,
      values: values.slice(0, MAX_VALUES).map((entry) => ({ value: entry.value ?? "(missing)", count: Number(entry.count) })),
      truncated: values.length > MAX_VALUES,
    });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
