import { NextRequest, NextResponse } from "next/server";
import { canManageExplore } from "@/lib/explore/authorization";
import { collectHostFacts } from "@/lib/explore/sandbox/host";
import { getSandboxSettings, saveSandboxSettings } from "@/lib/explore/sandbox/settings";
import { ExploreRouteError, exploreErrorResponse, readJsonBody, requireExploreSession } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How analysis runs are confined on this host, and the settings that decide it. */
export async function GET() {
  try {
    const session = await requireExploreSession();
    const [settings, facts] = await Promise.all([getSandboxSettings(), collectHostFacts()]);
    return NextResponse.json({
      settings,
      host: {
        platform: facts.platform,
        tool: facts.toolName,
        toolPath: canManageExplore(session) ? facts.tool : null,
        problem: facts.problem,
      },
    });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    if (!canManageExplore(session)) throw new ExploreRouteError(403, "Pipeline management permission is required to configure analysis isolation");
    const body = await readJsonBody(request);
    const settings = await saveSandboxSettings(body);
    return NextResponse.json({ settings });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
