import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ profile: vi.fn(), reconcile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/deployment-profile/server", () => ({ getServerDeploymentProfile: mocks.profile }));
vi.mock("./import-jobs", () => ({ reconcileWorkbenchImports: mocks.reconcile }));
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";
import { startWorkbenchImportWorker } from "./import-worker";
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("NODE_ENV", "production"); mocks.reconcile.mockClear(); });
afterEach(() => {
  const state = globalThis as typeof globalThis & { seqdeskImportWorker?: ReturnType<typeof setInterval> };
  if (state.seqdeskImportWorker) clearInterval(state.seqdeskImportWorker);
  delete state.seqdeskImportWorker; vi.useRealTimers(); vi.unstubAllEnvs();
});
it.each(["sequencing-center", "shared-lab", "research-workbench"] as const)("reconciles queued imports in %s without duplicate workers", async id => {
  mocks.profile.mockReturnValue(getDeploymentProfileDefinition(id));
  startWorkbenchImportWorker(); startWorkbenchImportWorker();
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15000);
  expect(mocks.reconcile).toHaveBeenCalledTimes(2);
});
