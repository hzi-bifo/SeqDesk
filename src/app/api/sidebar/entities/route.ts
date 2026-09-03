import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoFacilityWorkspaceUserIds } from "@/lib/demo/server";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

// GET /api/sidebar/entities - Get recent orders and studies for the entity switcher
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const ordersAccess = decideServerCapability(session, "orders.read");
  if (!ordersAccess.allowed) {
    return authorizationErrorResponse(ordersAccess);
  }

  try {
    const userId = ordersAccess.principal!.id;
    const canReadAllOrders = decideServerCapability(
      session,
      "orders.read_all"
    ).allowed;
    const canReadAllStudies = decideServerCapability(
      session,
      "studies.read_all"
    ).allowed;
    const demoWsUserIds = await getDemoFacilityWorkspaceUserIds(session);

    const url = new URL(request.url);
    const search = url.searchParams.get("q")?.toLowerCase() || "";

    // Fetch recent orders
    const orders = await db.order.findMany({
      where: {
        ...(canReadAllOrders ? (demoWsUserIds ? { userId: { in: demoWsUserIds } } : {}) : { userId }),
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
        ...(canReadAllStudies ? (demoWsUserIds ? { userId: { in: demoWsUserIds } } : {}) : { userId }),
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
