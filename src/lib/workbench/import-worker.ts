import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { reconcileWorkbenchImports } from "./import-jobs";

const state = globalThis as typeof globalThis & { seqdeskImportWorker?: ReturnType<typeof setInterval> };

export function startWorkbenchImportWorker(): void {
  if (process.env.NODE_ENV === "test" || state.seqdeskImportWorker ||
      !getServerDeploymentProfile().modules.includes("data-imports")) return;
  let polling = false;
  const tick = async () => {
    if (polling) return;
    polling = true;
    try { await reconcileWorkbenchImports({ waitForJobs: false }); }
    catch { console.error("[workbench] Import reconciliation unavailable; retrying on the next poll."); }
    finally { polling = false; }
  };
  state.seqdeskImportWorker = setInterval(() => void tick(), 15_000);
  state.seqdeskImportWorker.unref();
  void tick();
}
