import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEPLOYMENT_PROFILES } from "@/lib/deployment-profile";

const mocks = vi.hoisted(() => ({
  profileId: "sequencing-center" as
    | "sequencing-center"
    | "shared-lab"
    | "research-workbench",
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: () => DEPLOYMENT_PROFILES[mocks.profileId],
}));

import DashboardLandingPage from "./page";

describe("dashboard landing route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileId = "sequencing-center";
  });

  it.each([
    ["sequencing-center", "/orders"],
    ["shared-lab", "/orders"],
    ["research-workbench", "/workbench/data"],
  ] as const)("redirects %s to its configured landing route", (profileId, route) => {
    mocks.profileId = profileId;

    expect(() => DashboardLandingPage()).toThrow(`REDIRECT:${route}`);
    expect(mocks.redirect).toHaveBeenCalledWith(route);
  });
});
