import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { DataSourcesError, readDataSourcesSettings, secretStates, setSecret } from "@/lib/workbench/data-sources";

/**
 * The Dryad API account (client id and secret) the Dryad connector downloads with. Stored encrypted in the site
 * settings like the NCBI key; never returned, only whether one is set, where it comes from, and who changed it.
 */
async function authorize() {
  const session = await getServerSession(authOptions);
  const decision = decideCapability(session, "system.settings.manage", getServerDeploymentProfile());
  if (decision.allowed) return { session, denied: null };
  return { session, denied: NextResponse.json({ error: decision.status === 401 ? "Unauthorized" : decision.status === 404 ? "Not found" : "Forbidden" }, { status: decision.status }) };
}

async function state() {
  const s = (await secretStates(await readDataSourcesSettings()))["dryad-account"];
  return { hasAccount: s.set, source: s.source, changedBy: s.changedBy ?? null, changedAt: s.changedAt ?? null };
}

// GET /api/admin/settings/dryad — whether an account is set (never the id or secret)
export async function GET() {
  const { denied } = await authorize();
  if (denied) return denied;
  return NextResponse.json(await state());
}

// PUT /api/admin/settings/dryad — { clientId, clientSecret } sets it; both "" remove the stored one
export async function PUT(request: Request) {
  const { session, denied } = await authorize();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { clientId?: unknown; clientSecret?: unknown } | null;
  if (!body || typeof body.clientId !== "string" || typeof body.clientSecret !== "string") {
    return NextResponse.json({ error: "Send clientId and clientSecret (both empty remove the stored account)." }, { status: 400 });
  }
  const user = (session as { user?: { name?: string | null; email?: string | null; id?: string } } | null)?.user;
  try {
    await setSecret("dryad-account", { clientId: body.clientId, clientSecret: body.clientSecret }, user?.name || user?.email || user?.id || "an admin");
    return NextResponse.json(await state());
  } catch (error) {
    // Never log the request: it carries the secret.
    if (error instanceof DataSourcesError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The Dryad settings could not be saved." }, { status: 500 });
  }
}
