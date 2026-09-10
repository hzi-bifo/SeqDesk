import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { addDataFilesReadSet, authorizeDataFiles, DataFilesError, getDataFilesInventory } from "@/lib/orders/data-files.server";
import { dataFilesErrorResponse } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await authorizeDataFiles(await getServerSession(authOptions), (await params).id);
    return NextResponse.json(await getDataFilesInventory(access));
  } catch (error) { return dataFilesErrorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await authorizeDataFiles(await getServerSession(authOptions), (await params).id, true);
    let input: unknown;
    try { input = await request.json(); } catch { throw new DataFilesError(400, "Invalid file association request"); }
    return NextResponse.json(await addDataFilesReadSet(access, input, "local_files", request.signal), { status: 201 });
  } catch (error) { return dataFilesErrorResponse(error); }
}
