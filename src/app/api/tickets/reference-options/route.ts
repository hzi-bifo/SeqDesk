import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoFacilityWorkspaceUserIds } from "@/lib/demo/server";
import { ticketReferencesSupported } from "@/lib/tickets/reference-support";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

async function isDepartmentSharingEnabled(): Promise<boolean> {
  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    if (!settings?.extraSettings) return false;
    const extra = JSON.parse(settings.extraSettings);
    return extra.departmentSharing === true;
  } catch {
    return false;
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "support.tickets.use");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }
  const userId = access.principal!.id;

  const supportsReferences = await ticketReferencesSupported();
  if (!supportsReferences) {
    return NextResponse.json({
      enabled: false,
      orders: [],
      studies: [],
    });
  }

  const canReadAllOrders = decideServerCapability(
    session,
    "orders.read_all"
  ).allowed;
  const canReadAllStudies = decideServerCapability(
    session,
    "studies.read_all"
  ).allowed;
  const demoWsUserIds = await getDemoFacilityWorkspaceUserIds(session);

  let orderWhere: Prisma.OrderWhereInput = demoWsUserIds
    ? { userId: { in: demoWsUserIds } }
    : {};
  if (!canReadAllOrders) {
    const departmentSharing = await isDepartmentSharingEnabled();
    if (departmentSharing) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { departmentId: true },
      });

      orderWhere = user?.departmentId
        ? { user: { departmentId: user.departmentId } }
        : { userId };
    } else {
      orderWhere = { userId };
    }
  }

  const [orders, studies] = await Promise.all([
    db.order.findMany({
      where: orderWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        name: true,
      },
    }),
    db.study.findMany({
      where: canReadAllStudies ? (demoWsUserIds ? { userId: { in: demoWsUserIds } } : {}) : { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
      },
    }),
  ]);

  return NextResponse.json({
    enabled: true,
    orders,
    studies,
  });
}
