import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseModulesConfig } from "@/lib/modules/form-integration";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    // Allow any authenticated user to read module states
    // (their forms are module-driven, so this is not admin-only)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    const config = parseModulesConfig(settings?.modulesConfig ?? null);
    return NextResponse.json(config);
  } catch (error) {
    console.error("Error fetching module config:", error);
    return NextResponse.json(
      { error: "Failed to fetch module configuration" },
      { status: 500 }
    );
  }
}
