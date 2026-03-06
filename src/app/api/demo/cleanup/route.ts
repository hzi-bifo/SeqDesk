import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredDemoWorkspaces } from "@/lib/demo/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.CRON_SECRET || process.env.DEMO_CLEANUP_SECRET;

  if (!configuredSecret && process.env.NODE_ENV !== "production") {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${configuredSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await cleanupExpiredDemoWorkspaces();
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to clean up demo workspaces",
      },
      { status: 500 }
    );
  }
}
