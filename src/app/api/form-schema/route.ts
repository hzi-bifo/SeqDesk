import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadOrderFormSchema } from "@/lib/orders/order-form";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

// GET form schema for order creation (public to authenticated users)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const access = decideServerCapability(session, "orders.create");
    if (!access.allowed) {
      return authorizationErrorResponse(access);
    }

    const schema = await loadOrderFormSchema({
      isFacilityAdmin: decideServerCapability(session, "orders.process").allowed,
    });

    return NextResponse.json(schema);
  } catch (error) {
    console.error("Error fetching form schema:", error);
    return NextResponse.json(
      { error: "Failed to fetch form schema" },
      { status: 500 }
    );
  }
}
