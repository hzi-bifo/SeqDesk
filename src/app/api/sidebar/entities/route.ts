import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/sidebar/entities - Get recent orders and studies for the entity switcher
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    const userId = session.user.id;

    const url = new URL(request.url);
    const search = url.searchParams.get("q")?.toLowerCase() || "";

    // Fetch recent orders
    const orders = await db.order.findMany({
      where: {
        ...(isFacilityAdmin ? {} : { userId }),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { orderNumber: { contains: search } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        name: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });

    // Fetch recent studies
    const studies = await db.study.findMany({
      where: {
        ...(isFacilityAdmin ? {} : { userId }),
        ...(search
          ? {
              OR: [
                { title: { contains: search } },
                { alias: { contains: search } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        alias: true,
        submitted: true,
        readyForSubmission: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      orders: orders.map((o) => ({
        id: o.id,
        label: o.name || o.orderNumber,
        sublabel: o.orderNumber,
        status: o.status,
      })),
      studies: studies.map((s) => ({
        id: s.id,
        label: s.title,
        sublabel: s.alias || "",
        status: s.submitted ? "PUBLISHED" : s.readyForSubmission ? "READY" : "DRAFT",
      })),
    });
  } catch (error) {
    console.error("Error fetching sidebar entities:", error);
    return NextResponse.json(
      { error: "Failed to fetch entities" },
      { status: 500 }
    );
  }
}
