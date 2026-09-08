import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";
import { isExploreModuleEnabled } from "./module";

const mocks = vi.hoisted(() => ({ settings: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { siteSettings: { findUnique: mocks.settings } } }));
vi.mock("@/lib/deployment-profile/server", () => ({ getServerDeploymentProfile: mocks.profile }));

describe("Reports module in the unified application", () => {
  beforeEach(() => {
    mocks.settings.mockResolvedValue(null);
    mocks.profile.mockReturnValue(getDeploymentProfileDefinition("sequencing-center"));
  });
  it.each(["sequencing-center", "shared-lab", "research-workbench"] as const)("is registered and enabled by default for %s", async id => {
    mocks.profile.mockReturnValue(getDeploymentProfileDefinition(id));
    expect(await isExploreModuleEnabled()).toBe(true);
  });
  it("respects explicit disablement and the global module switch", async () => {
    mocks.settings.mockResolvedValue({ modulesConfig: JSON.stringify({ modules: { explore: false } }) });
    expect(await isExploreModuleEnabled()).toBe(false);
    mocks.settings.mockResolvedValue({ modulesConfig: JSON.stringify({ modules: { explore: true }, globalDisabled: true }) });
    expect(await isExploreModuleEnabled()).toBe(false);
  });
  it("does not enable Reports when the analysis domain is unavailable", async () => {
    mocks.profile.mockReturnValue({ ...getDeploymentProfileDefinition("sequencing-center"), domains: ["core"] });
    expect(await isExploreModuleEnabled()).toBe(false);
  });
});
