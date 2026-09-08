import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { parseModulesConfig } from "./form-integration";
import { importModuleCatalog } from "./import-catalog";

export const RAW_READ_MODULES = Object.fromEntries(importModuleCatalog.map(module => [module.providerId, module.id]));
export async function isFacilityDataContainer(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { dataOrigin: true } });
  return Boolean(order && order.dataOrigin === "facility");
}
export async function inputModuleEnabled(moduleId: string) {
  const settings = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { modulesConfig: true } });
  const config = parseModulesConfig(settings?.modulesConfig ?? null, getServerDeploymentProfile());
  return !config.globalDisabled && config.modules[moduleId] === true;
}
export async function requireRawReadImporter(providerId: string) {
  const moduleId = RAW_READ_MODULES[providerId as keyof typeof RAW_READ_MODULES];
  if (!moduleId || !await inputModuleEnabled(moduleId)) throw new Error("This raw-read input module is disabled or unsupported");
}
