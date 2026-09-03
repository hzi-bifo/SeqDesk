import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { validateFeatureModuleCompatibility } from "@/lib/deployment-profile/compatibility";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { parseModulesConfig } from "@/lib/modules/form-integration";

// GET module configuration
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const access = decideServerCapability(session, "system.settings.manage");

    if (!access.allowed) {
      return authorizationErrorResponse(access);
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    const config = parseModulesConfig(
      settings?.modulesConfig ?? null,
      getServerDeploymentProfile()
    );

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
    const access = decideServerCapability(session, "system.settings.manage");

    if (!access.allowed) {
      return authorizationErrorResponse(access);
    }

    const body = await request.json();
    const { moduleId, enabled, globalDisabled } = body as {
      moduleId?: string;
      enabled?: boolean;
      globalDisabled?: boolean;
    };

    const deploymentProfile = getServerDeploymentProfile();
    if (moduleId && typeof enabled === "boolean") {
      const compatibilityErrors = validateFeatureModuleCompatibility(
        deploymentProfile,
        { [moduleId]: enabled }
      ).filter((issue) => issue.severity === "error");
      if (compatibilityErrors.length > 0) {
        return NextResponse.json(
          {
            error: compatibilityErrors[0].message,
            code: "PROFILE_MODULE_INCOMPATIBLE",
            issues: compatibilityErrors,
          },
          { status: 409 }
        );
      }
    }

    // Get current config
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    const config = parseModulesConfig(
      settings?.modulesConfig ?? null,
      deploymentProfile
    );

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
        modulesConfig: JSON.stringify({
          modules: config.modules,
          globalDisabled: config.globalDisabled,
        }),
      },
      create: {
        id: "singleton",
        modulesConfig: JSON.stringify({
          modules: config.modules,
          globalDisabled: config.globalDisabled,
        }),
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
