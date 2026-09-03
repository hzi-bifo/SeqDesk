import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { getOnboardingStatus } from "@/lib/onboarding/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isActiveSession(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getOnboardingStatus();
    return NextResponse.json({
      required: status.required,
      complete: status.complete,
      profile: status.profile,
      completedCount: status.completedCount,
      totalCount: status.totalCount,
      requiredCompletedCount: status.requiredCompletedCount,
      requiredTotalCount: status.requiredTotalCount,
    });
  } catch (error) {
    console.error("[Onboarding] Could not load member-visible status:", error);
    return NextResponse.json(
      { error: "Could not load onboarding status." },
      { status: 500 }
    );
  }
}
