import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketReferencesSupported } from "@/lib/tickets/reference-support";

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

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supportsReferences = await ticketReferencesSupported();
  if (!supportsReferences) {
    return NextResponse.json({
      enabled: false,
      orders: [],
      studies: [],
    });
  }

  const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

  let orderWhere = {};
  if (!isFacilityAdmin) {
    const departmentSharing = await isDepartmentSharingEnabled();
    if (departmentSharing) {
      const user = await db.user.findUnique({
        where: { id: session.user.id },
        select: { departmentId: true },
      });

      orderWhere = user?.departmentId
        ? { user: { departmentId: user.departmentId } }
        : { userId: session.user.id };
    } else {
      orderWhere = { userId: session.user.id };
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
      where: isFacilityAdmin ? {} : { userId: session.user.id },
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
