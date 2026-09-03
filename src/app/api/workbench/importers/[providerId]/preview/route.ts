import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "@/lib/auth";
import { getWorkbenchImporter } from "@/lib/workbench/importers/registry";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";

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
  const provider = getWorkbenchImporter(providerId);
  if (!provider) {
    return NextResponse.json({ error: "Workbench importer not found" }, { status: 404 });
  }

  const preflight = await provider.preflight();
  if (!preflight.ok) {
    return NextResponse.json({ error: preflight.message, details: preflight.details }, { status: 400 });
  }

  try {
    const body = await request.json();
    const input = provider.inputSchema.parse(body);
    const preview = await provider.preview(input);
    return NextResponse.json({ preview });
  } catch (error) {
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
