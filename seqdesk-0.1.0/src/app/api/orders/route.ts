import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Generate order number: ORD-YYYYMMDD-XXXX
async function generateOrderNumber(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `ORD-${dateStr}-`;

  // Find the highest order number for today
  const lastOrder = await db.order.findFirst({
    where: {
      orderNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      orderNumber: "desc",
    },
    select: {
      orderNumber: true,
    },
  });

  let sequence = 1;
  if (lastOrder) {
    const lastSequence = parseInt(lastOrder.orderNumber.slice(-4), 10);
    sequence = lastSequence + 1;
  }

  return `${prefix}${sequence.toString().padStart(4, "0")}`;
}

// Helper to check if department sharing is enabled
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

// GET all orders for the current user (or all orders for facility admin)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    // Build the where clause based on role and settings
    let whereClause = {};
    let sharingMode: "personal" | "department" | "all" = "personal";

    if (isFacilityAdmin) {
      // Admins see all orders
      whereClause = {};
      sharingMode = "all";
    } else {
      // Check if department sharing is enabled
      const departmentSharing = await isDepartmentSharingEnabled();

      if (departmentSharing) {
        // Get user's department
        const user = await db.user.findUnique({
          where: { id: session.user.id },
          select: { departmentId: true },
        });

        if (user?.departmentId) {
          // Show orders from users in the same department
          whereClause = {
            user: {
              departmentId: user.departmentId,
            },
          };
          sharingMode = "department";
        } else {
          // User has no department, show only their orders
          whereClause = { userId: session.user.id };
          sharingMode = "personal";
        }
      } else {
        // Department sharing disabled, show only user's orders
        whereClause = { userId: session.user.id };
        sharingMode = "personal";
      }
    }

    const orders = await db.order.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            department: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        _count: {
          select: { samples: true },
        },
      },
    });

    return NextResponse.json({
      orders,
      sharingMode,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}

// POST create new order
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      platform,
      instrumentModel,
      librarySelection,
      libraryStrategy,
      librarySource,
      numberOfSamples,
      customFields,
    } = body;

    // Generate unique order number
    const orderNumber = await generateOrderNumber();

    // Get user profile for contact info
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        institution: true,
      },
    });

    const order = await db.order.create({
      data: {
        orderNumber,
        name: name?.trim() || null,
        numberOfSamples: numberOfSamples ? parseInt(numberOfSamples, 10) : null,
        // Contact info from user profile
        contactName: user ? `${user.firstName} ${user.lastName}` : null,
        contactEmail: user?.email || null,
        contactPhone: null,
        billingAddress: user?.institution || null,
        platform: platform || null,
        instrumentModel: instrumentModel?.trim() || null,
        librarySelection: librarySelection || null,
        libraryStrategy: libraryStrategy || null,
        librarySource: librarySource || null,
        // Custom fields from form builder
        customFields: customFields ? JSON.stringify(customFields) : null,
        userId: session.user.id,
        status: "DRAFT",
      },
    });

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}
