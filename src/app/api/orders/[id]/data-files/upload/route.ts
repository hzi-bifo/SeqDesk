import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { authorizeDataFiles, uploadDataFiles } from "@/lib/orders/data-files.server";
import { dataFilesErrorResponse } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await authorizeDataFiles(await getServerSession(authOptions), (await params).id, true);
    return NextResponse.json(await uploadDataFiles(access, request), { status: 201 });
  } catch (error) { return dataFilesErrorResponse(error); }
}
