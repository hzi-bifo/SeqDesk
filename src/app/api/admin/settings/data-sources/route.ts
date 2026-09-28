import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { requireRawReadImporter } from "@/lib/modules/input-modules.server";
import { getWorkbenchImporter } from "@/lib/workbench/importers/registry";
import {
  applySettingsChange, DATA_SOURCES, DataSourcesError, dataSourcesHistory, dataSourcesStatus, parseSettingsChange, sourceById, testSources,
} from "@/lib/workbench/data-sources";

/**
 * Data sources for SeqDesk administrators (the same settings the web app's Settings › Data sources changes):
 * GET the status and the history, PUT limits / on-off / who can import, POST { source? } to test.
 */
async function authorize() {
  const session = await getServerSession(authOptions);
  const decision = decideCapability(session, "system.settings.manage", getServerDeploymentProfile());
  if (decision.allowed) return { session, denied: null };
  return { session, denied: NextResponse.json({ error: decision.status === 401 ? "Unauthorized" : decision.status === 404 ? "Not found" : "Forbidden" }, { status: decision.status }) };
}
const actor = (session: unknown) => {
  const user = (session as { user?: { name?: string | null; email?: string | null; id?: string } } | null)?.user;
  return user?.name || user?.email || user?.id || "an admin";
};

export async function GET() {
  const { denied } = await authorize();
  if (denied) return denied;
  const status = await dataSourcesStatus({
    moduleEnabled: async (id) => { try { await requireRawReadImporter(id); return true; } catch { return false; } },
    preflight: async (id) => (await getWorkbenchImporter(id)?.preflight()) ?? null,
  }, true);
  return NextResponse.json({ ...status, history: await dataSourcesHistory(50) });
}

export async function PUT(request: Request) {
  const { session, denied } = await authorize();
  if (denied) return denied;
  try {
    await applySettingsChange(parseSettingsChange(await request.json().catch(() => null)), actor(session));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof DataSourcesError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The data source settings could not be saved." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { session, denied } = await authorize();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { source?: unknown } | null;
  const one = typeof body?.source === "string" ? body.source : null;
  if (one && !sourceById(one)) return NextResponse.json({ error: `There is no data source called ${one}.` }, { status: 404 });
  return NextResponse.json({ results: await testSources(one ? [one] : DATA_SOURCES.map((s) => s.id), actor(session)) });
}
