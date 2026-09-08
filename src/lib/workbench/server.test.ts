import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerDeploymentProfile: vi.fn() }));
vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: mocks.getServerDeploymentProfile,
}));

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";
import { authorizeWorkbenchRequest } from "./server";

describe("authorizeWorkbenchRequest", () => {
  beforeEach(() => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("research-workbench")
    );
  });

  it("returns 401 for an anonymous caller", async () => {
    const access = authorizeWorkbenchRequest(null);
    expect(access.allowed).toBe(false);
    if (!access.allowed) expect(access.response.status).toBe(401);
  });

  it("allows Workbench members to import", () => {
    const access = authorizeWorkbenchRequest(
      { user: { id: "member-1", role: "RESEARCHER" } },
      "workbench.import"
    );
    expect(access).toMatchObject({ allowed: true, userId: "member-1" });
  });

  it("allows the shared import API in a lab preset without changing its owner", async () => {
    mocks.getServerDeploymentProfile.mockReturnValue(
      getDeploymentProfileDefinition("shared-lab")
    );
    const access = authorizeWorkbenchRequest({
      user: { id: "member-1", role: "RESEARCHER" },
    });
    expect(access).toMatchObject({ allowed: true, userId: "member-1" });
  });

  it("keeps server-tool installation administrator-only", async () => {
    const access = authorizeWorkbenchRequest(
      { user: { id: "member-1", role: "RESEARCHER" } },
      "system.pipelines.manage"
    );
    expect(access.allowed).toBe(false);
    if (!access.allowed) expect(access.response.status).toBe(403);
  });
});
