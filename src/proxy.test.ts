import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "./proxy";
import { clearConfigCache } from "@/lib/config/loader";

function request(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

describe("runtime app surface proxy", () => {
  const clearProfileEnvironment = () => {
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.SEQDESK_DEPLOYMENT_PROFILE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
    clearConfigCache();
  };

  beforeEach(() => {
    clearProfileEnvironment();
  });

  afterEach(clearProfileEnvironment);

  it("blocks Workbench APIs in the default Lab app surface", async () => {
    const response = proxy(request("/api/workbench/imports"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("allows Workbench APIs in Workbench mode", () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    const response = proxy(request("/api/workbench/imports"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects Lab dashboard routes in Workbench mode", () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    const response = proxy(request("/orders/order-1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/workbench/data");
  });

  it("returns 404 for sequencing-domain APIs in Workbench", async () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    for (const path of [
      "/api/orders",
      "/api/studies/study-1",
      "/api/samples/sample-1",
      "/api/files",
      "/api/sidebar/counts",
      "/api/admin/form-config",
      "/api/admin/settings/ena",
    ]) {
      const response = proxy(request(path));
      expect(response.status, path).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });

  it("redirects sequencing-only administrator pages in Workbench", () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    const response = proxy(request("/admin/sequencing-tech"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/workbench/data");
  });

  it("keeps sequencing APIs available in Sequencing Center", () => {
    const response = proxy(request("/api/orders"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("hides center-only support and department routes in Shared Lab", async () => {
    process.env.SEQDESK_DEPLOYMENT_PROFILE = "shared-lab";
    clearConfigCache();

    const support = proxy(request("/messages"));
    expect(support.status).toBe(307);
    expect(support.headers.get("location")).toBe("http://localhost/orders");

    const departments = proxy(request("/api/admin/departments"));
    expect(departments.status).toBe(404);
    expect(await departments.json()).toEqual({ error: "Not found" });
  });

  it("keeps administrator settings available in Workbench mode", () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    const response = proxy(request("/admin/settings"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
