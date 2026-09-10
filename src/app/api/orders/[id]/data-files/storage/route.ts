import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { authorizeDataFiles, listDataFilesStorage } from "@/lib/orders/data-files.server";
import { dataFilesErrorResponse } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await authorizeDataFiles(await getServerSession(authOptions), (await params).id, true);
    const query = new URL(request.url).searchParams;
    return NextResponse.json(await listDataFilesStorage(access, query.get("path") ?? undefined, query.get("search") ?? ""));
  } catch (error) { return dataFilesErrorResponse(error); }
}
