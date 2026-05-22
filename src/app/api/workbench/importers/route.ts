import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  listWorkbenchImporters,
  serializeWorkbenchImporter,
} from "@/lib/workbench/importers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const importers = await Promise.all(
    listWorkbenchImporters().map(async (provider) => {
      const preflight = await provider.preflight();
      return serializeWorkbenchImporter(provider, preflight);
    })
  );

  return NextResponse.json({ importers });
}
