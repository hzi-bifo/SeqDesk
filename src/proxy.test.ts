import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { proxy } from "./proxy";

function request(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

describe("runtime app surface proxy", () => {
  afterEach(() => {
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
  });

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
});
