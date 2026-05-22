import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { startWorkbenchStoreInstall } from "@/lib/workbench/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json(
      { error: "Facility admin permissions are required for server tool setup." },
      { status: 403 }
    );
  }

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
