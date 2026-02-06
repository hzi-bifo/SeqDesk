import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : null;
    const parsedExpiresInDays = Number.parseInt(String(expiresInDays), 10);

    if (
      !Number.isInteger(parsedExpiresInDays) ||
      parsedExpiresInDays < 1 ||
      parsedExpiresInDays > 30
    ) {
      return NextResponse.json(
        { error: "expiresInDays must be an integer between 1 and 30" },
        { status: 400 }
      );
    }

    if (normalizedEmail && !EMAIL_PATTERN.test(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid invite email address" },
        { status: 400 }
      );
    }

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parsedExpiresInDays);

    let invite = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomBytes(4).toString("hex").toUpperCase();
      try {
        invite = await db.adminInvite.create({
          data: {
            code,
            email: normalizedEmail || null,
            expiresAt,
            createdById: session.user.id,
          },
          include: {
            createdBy: {
              select: { firstName: true, lastName: true },
            },
          },
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!invite) {
      return NextResponse.json(
        { error: "Failed to generate a unique invite code" },
        { status: 500 }
      );
    }

    return NextResponse.json(invite, { status: 201 });
  } catch (error) {
    console.error("Failed to create invite:", error);
    return NextResponse.json(
      { error: "Failed to create invite" },
      { status: 500 }
    );
  }
}
