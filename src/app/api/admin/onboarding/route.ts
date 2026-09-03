import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import {
  getOnboardingStatus,
  setOnboardingItemCompletion,
} from "@/lib/onboarding/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.settings.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }

  try {
    return NextResponse.json(await getOnboardingStatus());
  } catch (error) {
    console.error("[Onboarding] Could not load status:", error);
    return NextResponse.json(
      { error: "Could not load onboarding status." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.settings.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }
  if (access.principal?.isDemo) {
    return NextResponse.json(
      { error: "Demo mode is read-only." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as { itemId?: unknown }).itemId !== "string" ||
    typeof (body as { complete?: unknown }).complete !== "boolean"
  ) {
    return NextResponse.json(
      { error: "itemId and complete are required." },
      { status: 400 }
    );
  }

  try {
    const status = await setOnboardingItemCompletion({
      itemId: (body as { itemId: string }).itemId,
      complete: (body as { complete: boolean }).complete,
      actorUserId: access.principal!.id,
    });
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof Error && error.message === "Unknown onboarding item.") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[Onboarding] Could not update status:", error);
    return NextResponse.json(
      { error: "Could not update onboarding status." },
      { status: 500 }
    );
  }
}
