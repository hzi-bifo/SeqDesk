import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

// GET all departments (with user count)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const access = decideServerCapability(session, "system.facility.manage");
    if (!access.allowed) {
      return authorizationErrorResponse(access);
    }

    const departments = await db.department.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    return NextResponse.json(departments);
  } catch (error) {
    console.error("Error fetching departments:", error);
    return NextResponse.json(
      { error: "Failed to fetch departments" },
      { status: 500 }
    );
  }
}

// POST create new department
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const access = decideServerCapability(session, "system.facility.manage");
    if (!access.allowed) {
      return authorizationErrorResponse(access);
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || name.trim() === "") {
      return NextResponse.json(
        { error: "Department name is required" },
        { status: 400 }
      );
    }

    // Check if department already exists
    const existing = await db.department.findUnique({
      where: { name: name.trim() },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Department with this name already exists" },
        { status: 400 }
      );
    }

    const department = await db.department.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
      },
    });

    return NextResponse.json(department, { status: 201 });
  } catch (error) {
    console.error("Error creating department:", error);
    return NextResponse.json(
      { error: "Failed to create department" },
      { status: 500 }
    );
  }
}
