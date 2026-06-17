import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
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
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const accessError = await assertSequencingDeliveryAccess(id, session.user);
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
