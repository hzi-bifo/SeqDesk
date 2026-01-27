import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";

// GET /api/admin/invites - List all invites
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const invites = await db.adminInvite.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: { firstName: true, lastName: true },
        },
        usedBy: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    return NextResponse.json(invites);
  } catch (error) {
    console.error("Failed to fetch invites:", error);
    return NextResponse.json(
      { error: "Failed to fetch invites" },
      { status: 500 }
    );
  }
}

// POST /api/admin/invites - Create a new invite
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { email, expiresInDays = 7 } = await request.json();

    // Generate a unique invite code (8 characters, alphanumeric)
    const code = randomBytes(4).toString("hex").toUpperCase();

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const invite = await db.adminInvite.create({
      data: {
        code,
        email: email || null,
        expiresAt,
        createdById: session.user.id,
      },
      include: {
        createdBy: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    return NextResponse.json(invite, { status: 201 });
  } catch (error) {
    console.error("Failed to create invite:", error);
    return NextResponse.json(
      { error: "Failed to create invite" },
      { status: 500 }
    );
  }
}
