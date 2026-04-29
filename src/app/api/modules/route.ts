import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseModulesConfig } from "@/lib/modules/form-integration";

export async function GET() {
  try {
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
