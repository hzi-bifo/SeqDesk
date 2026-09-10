import { describe, expect, it } from "vitest";
import { filterSettingsSections, getSettingsSections, isSettingsLinkActive } from "./catalog";

describe("settings catalog", () => {
  const sections = getSettingsSections({ dynamicStudiesEnabled: false, centerAccounts: true });
  it("keeps settings identities unique and uses local routes", () => {
    expect(new Set(sections.map(section => section.id)).size).toBe(sections.length);
    const links = sections.flatMap(section => section.links.filter(link => !link.overviewOnly));
    expect(new Set(links.map(link => link.href)).size).toBe(links.length);
    expect(links.every(link => link.href.startsWith("/"))).toBe(true);
  });
  it("keeps shared metadata outside facility-specific settings", () => {
    const metadata = sections.find(section => section.id === "metadata")!;
    expect(metadata.moduleId).toBeUndefined();
    expect(metadata.links.some(link => link.href === "/admin/form-builder")).toBe(true);
    expect(sections.find(section => section.id === "facility")?.moduleId).toBe("sequencing-management");
  });
  it("selects the configured study form without exposing center-only accounts elsewhere", () => {
    const other = getSettingsSections({ dynamicStudiesEnabled: true, centerAccounts: false });
    const links = other.flatMap(section => section.links);
    expect(links.some(link => link.href === "/admin/study-definitions")).toBe(true);
    expect(links.some(link => link.href === "/admin/study-form-builder")).toBe(false);
    expect(links.some(link => link.href === "/admin/departments")).toBe(false);
    expect(links.some(link => link.href === "/messages")).toBe(false);
  });
  it("searches plain-language descriptions and aliases", () => {
    expect(filterSettingsSections(sections, "  disk ").map(section => section.id)).toEqual(["storage"]);
    expect(filterSettingsSections(sections, "sandbox")[0].links[0].href).toBe("/admin/settings/analysis");
    expect(filterSettingsSections(sections, "cami")[0].id).toBe("modules");
    expect(filterSettingsSections(sections, "no-such-setting")).toEqual([]);
    expect(filterSettingsSections(sections, " ")).toBe(sections);
  });
  it("matches nested routes without marking unrelated prefix siblings active", () => {
    expect(isSettingsLinkActive("/admin/users/123", "/admin/users")).toBe(true);
    expect(isSettingsLinkActive("/admin/users-extra", "/admin/users")).toBe(false);
    expect(isSettingsLinkActive("/admin/modules", "/admin/modules?category=data-sources")).toBe(true);
  });
});
