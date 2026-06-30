import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadOrderFormSchema } from "@/lib/orders/order-form";

// GET form schema for order creation (public to authenticated users)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const schema = await loadOrderFormSchema({
      isFacilityAdmin: session.user.role === "FACILITY_ADMIN",
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
