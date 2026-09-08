import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  listWorkbenchImporters,
  serializeWorkbenchImporter,
} from "@/lib/workbench/importers/registry";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";
import { requireRawReadImporter } from "@/lib/modules/input-modules.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session, "workbench.import");
  if (!access.allowed) return access.response;

  const importers = await Promise.all(
    listWorkbenchImporters().map(async (provider) => {
      try { await requireRawReadImporter(provider.id); } catch { return null; }
      const preflight = await provider.preflight();
      return serializeWorkbenchImporter(provider, preflight);
    })
  );

  return NextResponse.json({ importers: importers.filter(Boolean) });
}
