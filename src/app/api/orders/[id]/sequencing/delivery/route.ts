import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import {
  assertSequencingDeliveryAccess,
  buildOrderSequencingDeliverySummary,
} from "@/lib/sequencing/delivery";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!isActiveSession(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = getServerDeploymentProfile();
    const operationalAccess = decideCapability(
      session,
      "sequencing.files.manage",
      profile
    );
    const requesterAccess = decideCapability(session, "orders.read", profile);
    const accessGrant = operationalAccess.allowed
      ? operationalAccess.grant
      : requesterAccess.grant;
    if (!accessGrant) {
      const status = requesterAccess.status;
      return NextResponse.json(
        {
          error:
            status === 404
              ? "Not found"
              : status === 401
                ? "Unauthorized"
                : "Forbidden",
        },
        { status }
      );
    }

    const { id } = await params;
    const accessError = await assertSequencingDeliveryAccess(id, session.user, {
      accessScope:
        accessGrant.scope === "installation" ? "installation" : "own",
    });
    if (accessError) {
      return NextResponse.json(accessError.body, { status: accessError.status });
    }

    const delivery = await buildOrderSequencingDeliverySummary(id);
    return NextResponse.json({ delivery });
  } catch (error) {
    if (error instanceof Error && error.message === "Sequencing Order not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("[Order Sequencing Delivery] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load sequencing delivery" },
      { status: 500 }
    );
  }
}
