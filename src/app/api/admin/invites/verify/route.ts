import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/admin/invites/verify - Verify an invite code
export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { valid: false, error: "Invite code is required" },
        { status: 400 }
      );
    }

    const invite = await db.adminInvite.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!invite) {
      return NextResponse.json(
        { valid: false, error: "Invalid invite code" },
        { status: 404 }
      );
    }

    if (invite.usedAt) {
      return NextResponse.json(
        { valid: false, error: "This invite has already been used" },
        { status: 400 }
      );
    }

    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { valid: false, error: "This invite has expired" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      valid: true,
      email: invite.email, // May be null (unrestricted) or a specific email
    });
  } catch (error) {
    console.error("Failed to verify invite:", error);
    return NextResponse.json(
      { valid: false, error: "Failed to verify invite" },
      { status: 500 }
    );
  }
}
