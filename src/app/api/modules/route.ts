import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";

interface ModulesConfig {
  modules: Record<string, boolean>;
  globalDisabled: boolean;
}

function parseModulesConfig(configString: string | null): ModulesConfig {
  if (!configString) {
    return { modules: DEFAULT_MODULE_STATES, globalDisabled: false };
  }

  try {
    const parsed = JSON.parse(configString);
    if (typeof parsed.modules === "object") {
      return {
        modules: { ...DEFAULT_MODULE_STATES, ...parsed.modules },
        globalDisabled: parsed.globalDisabled ?? false,
      };
    }

    return {
      modules: { ...DEFAULT_MODULE_STATES, ...parsed },
      globalDisabled: false,
    };
  } catch {
    return { modules: DEFAULT_MODULE_STATES, globalDisabled: false };
  }
}

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
