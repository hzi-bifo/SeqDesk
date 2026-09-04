import { NextRequest, NextResponse } from "next/server";
import { isFacilityAdminSession } from "@/lib/explore/authorization";
import { buildEnvironment, listEnvironments, registerExistingEnvironment } from "@/lib/explore/environments";
import { ExploreRouteError, exploreErrorResponse, readJsonBody, requireExploreSession, requireString } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireExploreSession();
    return NextResponse.json({ environments: await listEnvironments() });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

/** Build or register an environment. Facility admins only: it runs conda on the server. */
export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    if (!isFacilityAdminSession(session)) throw new ExploreRouteError(403, "Only facility admins manage environments");
    const body = await readJsonBody(request);
    const name = requireString(body.name, "name", 120);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new ExploreRouteError(400, "Invalid environment name");
    const action = body.action === "register" ? "register" : "build";
    if (action === "register") {
      const prefixPath = requireString(body.prefixPath, "prefixPath", 1000);
      await registerExistingEnvironment(name, prefixPath);
      return NextResponse.json({ ok: true, message: `Registered ${name}` });
    }
    const result = await buildEnvironment(name);
    return NextResponse.json(result, { status: result.started ? 202 : 409 });
  } catch (error) {
    if (error instanceof Error && !(error instanceof ExploreRouteError) && /No python|specification/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return exploreErrorResponse(error);
  }
}
