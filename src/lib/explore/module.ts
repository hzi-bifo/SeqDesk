import { db } from "@/lib/db";
import { isModuleEnabled, parseModulesConfig } from "@/lib/modules/form-integration";

export const EXPLORE_MODULE_ID = "explore";

/**
 * Server-side module check. Explore answers 404 everywhere when the module is
 * off, so the section behaves as if it did not exist.
 */
export async function isExploreModuleEnabled(): Promise<boolean> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { modulesConfig: true },
  });
  return isModuleEnabled(parseModulesConfig(settings?.modulesConfig ?? null), EXPLORE_MODULE_ID);
}
