import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const moduleEnabled = vi.hoisted(() => vi.fn());
const facilityContainer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/modules/input-modules.server", () => ({ inputModuleEnabled: moduleEnabled, isFacilityDataContainer: facilityContainer }));
import { proxy } from "./proxy";
import { clearConfigCache } from "@/lib/config/loader";

describe("shared application proxy", () => {
  const reset = () => {
    for (const key of ["SEQDESK_APP_SURFACE", "SEQDESK_DEPLOYMENT_PROFILE", "NEXT_PUBLIC_SEQDESK_APP_SURFACE", "NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY"]) delete process.env[key];
    clearConfigCache();
  };
  beforeEach(() => { reset(); moduleEnabled.mockReset().mockResolvedValue(true); facilityContainer.mockReset().mockResolvedValue(true); });
  afterEach(reset);
  it.each(["sequencing-center", "shared-lab", "research-workbench"])("keeps the same UI and scientific APIs in %s", async preset => {
    process.env.SEQDESK_DEPLOYMENT_PROFILE = preset;
    for (const path of ["/orders", "/orders/import", "/studies", "/api/workbench/imports", "/api/orders", "/api/samples", "/api/files", "/admin/settings", "/admin/sequencing-tech"]) {
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });
  it("supports the legacy workbench alias without redirecting shared pages", async () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";
    expect((await proxy(new NextRequest("http://localhost/orders/data-1"))).status).toBe(200);
  });
  it.each(["/api/orders/data-1/sequencing/reads", "/api/sequencing-runs", "/api/admin/minknow/connect"])("blocks facility writes when its module is disabled: %s", async path => {
    moduleEnabled.mockResolvedValue(false);
    expect((await proxy(new NextRequest(`http://localhost${path}`, { method: "POST" }))).status).toBe(403);
    expect(moduleEnabled).toHaveBeenCalledWith("sequencing-management");
    expect((await proxy(new NextRequest(`http://localhost${path}`))).status).toBe(200);
  });
  it("does not re-enable the legacy higher-level uploader", async () => {
    expect((await proxy(new NextRequest("http://localhost/api/workbench/uploads", { method: "POST" }))).status).toBe(403);
  });
  it("does not treat imported data as a facility run even when the module is enabled", async () => {
    facilityContainer.mockResolvedValue(false);
    expect((await proxy(new NextRequest("http://localhost/api/orders/imported-data/sequencing/reads", { method: "POST" }))).status).toBe(403);
  });
  it("preserves the legacy department policy independently of UI", async () => {
    process.env.SEQDESK_DEPLOYMENT_PROFILE = "shared-lab";
    expect((await proxy(new NextRequest("http://localhost/api/admin/departments"))).status).toBe(404);
  });
});
