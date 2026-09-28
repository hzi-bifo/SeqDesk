import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "@/lib/auth";
import { getWorkbenchImporter } from "@/lib/workbench/importers/registry";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";
import { importPreviewFingerprint } from "@/lib/workbench/import-preview-fingerprint";
import { requireRawReadImporter } from "@/lib/modules/input-modules.server";
import { assertMayImport, DataSourcesError, importLimits } from "@/lib/workbench/data-sources";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session, "workbench.import");
  if (!access.allowed) return access.response;

  const { providerId } = await params;
  try { await requireRawReadImporter(providerId); }
  catch { return NextResponse.json({ error: "Input module is disabled or unsupported" }, { status: 403 }); }
  const provider = getWorkbenchImporter(providerId);
  if (!provider) {
    return NextResponse.json({ error: "Workbench importer not found" }, { status: 404 });
  }

  try { await assertMayImport(provider.id, decideCapability(session, "system.settings.manage", getServerDeploymentProfile()).allowed); }
  catch (error) { if (error instanceof DataSourcesError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  const preflight = await provider.preflight();
  if (!preflight.ok && !preflight.previewOnly) {
    return NextResponse.json({ error: preflight.message, details: preflight.details }, { status: 400 });
  }

  try {
    const body = await request.json();
    const input = provider.inputSchema.parse(body);
    const preview = await provider.preview(input);
    const limits = await importLimits(providerId, preview, { phase: "preview" });
    return NextResponse.json({ preview: { ...preview, fingerprint: importPreviewFingerprint(providerId, input, preview), limits } });
  } catch (error) {
    if (error instanceof DataSourcesError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid importer input", issues: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to preview Workbench import" },
      { status: 500 }
    );
  }
}
