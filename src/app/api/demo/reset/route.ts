import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeDemoExperience } from "@/lib/demo/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const {
      authorizeDemoWorkspaceToken,
      createDemoSessionToken,
      getAuthSessionCookieName,
      getAuthSessionCookieOptions,
      getDemoCookieOptions,
      getDemoWorkspaceCookieName,
      resetDemoWorkspace,
    } = await import("@/lib/demo/server");
    const cookieStore = await cookies();
    const body = await request.json().catch(() => ({}));
    const explicitToken =
      typeof body.workspace === "string" ? body.workspace.trim() : "";
    const demoExperience = normalizeDemoExperience(body.demoExperience);
    const existingToken =
      explicitToken || cookieStore.get(getDemoWorkspaceCookieName())?.value;
    const result = await resetDemoWorkspace(existingToken, demoExperience);
    const user = await authorizeDemoWorkspaceToken(result.token, demoExperience);
    if (!user) {
      throw new Error("Failed to create demo session");
    }
    const sessionToken = await createDemoSessionToken(user);
    const response = NextResponse.json({
      created: result.created,
      expiresAt: result.expiresAt.toISOString(),
      workspaceId: result.workspaceId,
      demoExperience,
    });

    response.cookies.set(
      getDemoWorkspaceCookieName(),
      result.token,
      getDemoCookieOptions()
    );
    response.cookies.set(
      getAuthSessionCookieName(),
      sessionToken,
      getAuthSessionCookieOptions(result.expiresAt)
    );
    response.headers.set("Cache-Control", "no-store, max-age=0");

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to reset demo",
      },
      { status: 500 }
    );
  }
}
