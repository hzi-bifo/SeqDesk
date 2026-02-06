import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";

interface ModulesConfig {
  modules: Record<string, boolean>;
  globalDisabled: boolean;
}

function parseModulesConfig(configString: string | null): ModulesConfig {
  if (!configString) {
    return { modules: { ...DEFAULT_MODULE_STATES }, globalDisabled: false };
  }

  try {
    const parsed = JSON.parse(configString);
    // Handle old format (just module states) vs new format (with globalDisabled)
    if (typeof parsed.modules === "object") {
      return {
        modules: { ...DEFAULT_MODULE_STATES, ...parsed.modules },
        globalDisabled: parsed.globalDisabled ?? false,
      };
    }
    // Old format - just module states directly
    return {
      modules: { ...DEFAULT_MODULE_STATES, ...parsed },
      globalDisabled: false,
    };
  } catch {
    return { modules: { ...DEFAULT_MODULE_STATES }, globalDisabled: false };
  }
}

// GET module configuration
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    // Allow any authenticated user to read module states
    // (they need to know which features are available)
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

// PUT update module configuration (admin only)
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { moduleId, enabled, globalDisabled } = body as {
      moduleId?: string;
      enabled?: boolean;
      globalDisabled?: boolean;
    };

    // Get current config
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    const config = parseModulesConfig(settings?.modulesConfig ?? null);

    // Handle global disabled update
    if (typeof globalDisabled === "boolean") {
      config.globalDisabled = globalDisabled;
    }

    // Handle individual module update
    if (moduleId && typeof enabled === "boolean") {
      config.modules[moduleId] = enabled;
    }

    // Save to database
    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: {
        modulesConfig: JSON.stringify(config),
      },
      create: {
        id: "singleton",
        modulesConfig: JSON.stringify(config),
      },
    });

    return NextResponse.json(config);
  } catch (error) {
    console.error("Error updating module config:", error);
    return NextResponse.json(
      { error: "Failed to update module configuration" },
      { status: 500 }
    );
  }
}
