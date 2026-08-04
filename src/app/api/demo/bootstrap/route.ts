import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEMO_DATABASE_WAKING_CODE,
  DEMO_DATABASE_WAKING_MESSAGE,
  isRetryableDemoDatabaseError,
} from "@/lib/demo/bootstrap-errors";
import { normalizeDemoExperience } from "@/lib/demo/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const {
      authorizeDemoWorkspaceToken,
      bootstrapDemoWorkspace,
      createDemoSessionToken,
      getAuthSessionCookieName,
      getAuthSessionCookieOptions,
      getDemoCookieOptions,
      getDemoWorkspaceCookieName,
    } = await import("@/lib/demo/server");
    const cookieStore = await cookies();
    const body = await request.json().catch(() => ({}));
    const explicitToken =
      typeof body.workspace === "string" ? body.workspace.trim() : "";
    const demoExperience = normalizeDemoExperience(body.demoExperience);
    const existingToken =
      explicitToken || cookieStore.get(getDemoWorkspaceCookieName())?.value;
    let result = await bootstrapDemoWorkspace(existingToken, demoExperience);
    let user = await authorizeDemoWorkspaceToken(result.token, demoExperience);
    if (!user) {
      // A concurrent reset can leave a committed delete-to-seed gap after the
      // first bootstrap returned. Seed or reuse the eventual winner once, then
      // authorize that exact result.
      result = await bootstrapDemoWorkspace(result.token, demoExperience);
      user = await authorizeDemoWorkspaceToken(result.token, demoExperience);
    }
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
    console.error("[Demo Bootstrap] Failed:", error);

    if (isRetryableDemoDatabaseError(error)) {
      const response = NextResponse.json(
        {
          code: DEMO_DATABASE_WAKING_CODE,
          error: DEMO_DATABASE_WAKING_MESSAGE,
          retryable: true,
        },
        { status: 503 }
      );
      response.headers.set("Cache-Control", "no-store, max-age=0");
      response.headers.set("Retry-After", "2");
      return response;
    }

    return NextResponse.json(
      {
        code: "demo_bootstrap_failed",
        error: "Unable to start the demo right now. Please try again.",
      },
      { status: 500 }
    );
  }
}
