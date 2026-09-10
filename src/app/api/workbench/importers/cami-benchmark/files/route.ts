import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";
import { requireRawReadImporter } from "@/lib/modules/input-modules.server";
import { camiFilesQuerySchema } from "@/lib/workbench/cami-sample-types";
import { getCamiSampleFileInfo } from "@/lib/workbench/cami-file-info.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = authorizeWorkbenchRequest(await getServerSession(authOptions), "workbench.import");
  if (!access.allowed) return access.response;
  try { await requireRawReadImporter("cami-benchmark"); }
  catch { return NextResponse.json({ error: "Input module is disabled or unsupported" }, { status: 403 }); }
  const query = camiFilesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Invalid CAMI dataset or technology" }, { status: 400 });
  try {
    return NextResponse.json({ files: await getCamiSampleFileInfo(query.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not check CAMI file sizes" }, { status: 502 });
  }
}
