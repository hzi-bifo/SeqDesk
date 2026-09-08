import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { siteSettings: { findUnique: mocks.settings } } }));
vi.mock("@/lib/deployment-profile/server", () => ({ getServerDeploymentProfile: mocks.profile }));
import { inputModuleEnabled, requireRawReadImporter } from "./input-modules.server";
describe("coexisting raw input modules", () => {
  beforeEach(() => { mocks.profile.mockReturnValue(getDeploymentProfileDefinition("sequencing-center")); mocks.settings.mockResolvedValue(null); });
  it.each(["sequencing-center", "shared-lab", "research-workbench"] as const)("permits raw import defaults in %s without changing ownership", async id => {
    mocks.profile.mockReturnValue(getDeploymentProfileDefinition(id));
    await expect(requireRawReadImporter("cami-benchmark")).resolves.toBeUndefined();
    await expect(requireRawReadImporter("ena-fastq-accession")).resolves.toBeUndefined();
    expect(await inputModuleEnabled("sequencing-management")).toBe(id !== "research-workbench");
  });
  it("enforces individual and global switches on the server", async () => {
    mocks.settings.mockResolvedValue({ modulesConfig: JSON.stringify({ modules: { "import-cami": false } }) });
    await expect(requireRawReadImporter("cami-benchmark")).rejects.toThrow("disabled");
    await expect(requireRawReadImporter("ena-fastq-accession")).resolves.toBeUndefined();
    mocks.settings.mockResolvedValue({ modulesConfig: JSON.stringify({ globalDisabled: true }) });
    await expect(requireRawReadImporter("ena-fastq-accession")).rejects.toThrow("disabled");
  });
  it("rejects reference genomes and arbitrary providers", async () => {
    await expect(requireRawReadImporter("ncbi-genomes-taxon")).rejects.toThrow("unsupported");
    await expect(requireRawReadImporter("anything")).rejects.toThrow("unsupported");
  });
});
