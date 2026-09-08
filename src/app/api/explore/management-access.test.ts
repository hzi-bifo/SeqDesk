import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(), enabled: vi.fn(), build: vi.fn(), register: vi.fn(), save: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.enabled }));
vi.mock("@/lib/explore/environments", () => ({ buildEnvironment: mocks.build, registerExistingEnvironment: mocks.register, listEnvironments: vi.fn() }));
vi.mock("@/lib/explore/sandbox/host", () => ({ collectHostFacts: vi.fn() }));
vi.mock("@/lib/explore/sandbox/settings", () => ({ saveSandboxSettings: mocks.save, getSandboxSettings: vi.fn() }));

import { POST as environmentPost } from "./environments/route";
import { POST as sandboxPost } from "./sandbox/route";

describe("Explore system configuration authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockResolvedValue(true);
    mocks.build.mockResolvedValue({ started: true });
    mocks.save.mockResolvedValue({ mode: "required" });
  });

  it.each([
    ["ADMIN", "REQUESTER", true],
    ["MEMBER", "OPERATOR", false],
    ["MEMBER", "REQUESTER", false],
  ] as const)("uses system grants for %s/%s (allowed %s)", async (systemRole, facilityWorkflowRole, allowed) => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "u1", role: "FACILITY_ADMIN", systemRole, facilityWorkflowRole } });
    const env = await environmentPost(new NextRequest("http://localhost/api/explore/environments", {
      method: "POST", body: JSON.stringify({ name: "seqdesk-explore-python", action: "build" }),
    }));
    expect(env.status).toBe(allowed ? 202 : 403);
    const sandbox = await sandboxPost(new NextRequest("http://localhost/api/explore/sandbox", {
      method: "POST", body: JSON.stringify({ mode: "required" }),
    }));
    expect(sandbox.status).toBe(allowed ? 200 : 403);
    expect(mocks.build).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(mocks.save).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it("rejects a revoked administrator and a disabled module without configuration changes", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "u1", role: "FACILITY_ADMIN", authorizationValid: false } });
    const request = () => new NextRequest("http://localhost/api/explore/environments", { method: "POST", body: "{}" });
    expect((await environmentPost(request())).status).toBe(401);
    mocks.enabled.mockResolvedValue(false);
    expect((await environmentPost(request())).status).toBe(404);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
