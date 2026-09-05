import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exploreErrorResponse, optionalString, readJsonBody, requireExploreSession, requireString } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explore projects: scopes of their own for tables that belong to no study or
 * sequencing order. A project is owned by whoever created it; facility admins
 * see them all.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    const body = await readJsonBody(request);
    const project = await db.exploreProject.create({
      data: {
        name: requireString(body.name, "name"),
        description: optionalString(body.description, 1000),
        ownerId: session.user.id,
      },
    });
    return NextResponse.json({ project: { id: project.id, name: project.name, description: project.description, targetKey: `project:${project.id}` } }, { status: 201 });
  } catch (error) {
    return exploreErrorResponse(error);
  }
}
