import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listWorkbenchStoreItems } from "@/lib/workbench/store";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session);
  if (!access.allowed) return access.response;

  try {
    return NextResponse.json({ items: await listWorkbenchStoreItems() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Workbench Store" },
      { status: 500 }
    );
  }
}
