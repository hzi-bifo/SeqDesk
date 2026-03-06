import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  bootstrapDemoWorkspace,
  createDemoSessionToken,
  getAuthSessionCookieName,
  getAuthSessionCookieOptions,
  authorizeDemoWorkspaceToken,
  getDemoCookieOptions,
  getDemoWorkspaceCookieName,
} from "@/lib/demo/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  try {
    const cookieStore = await cookies();
    const existingToken = cookieStore.get(getDemoWorkspaceCookieName())?.value;
    const result = await bootstrapDemoWorkspace(existingToken);
    const user = await authorizeDemoWorkspaceToken(result.token);
    if (!user) {
      throw new Error("Failed to create demo session");
    }
    const sessionToken = await createDemoSessionToken(user);
    const response = NextResponse.json({
      created: result.created,
      expiresAt: result.expiresAt.toISOString(),
      workspaceId: result.workspaceId,
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
        error:
          error instanceof Error ? error.message : "Failed to bootstrap demo",
      },
      { status: 500 }
    );
  }
}
