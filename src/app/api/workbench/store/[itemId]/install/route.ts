import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startWorkbenchStoreInstall } from "@/lib/workbench/store";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session, "system.pipelines.manage");
  if (!access.allowed) return access.response;

  try {
    const { itemId } = await params;
    const job = await startWorkbenchStoreInstall(itemId);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start Workbench Store install" },
      { status: 400 }
    );
  }
}
