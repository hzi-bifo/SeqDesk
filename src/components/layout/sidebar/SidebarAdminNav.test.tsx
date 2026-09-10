// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentProfileProvider } from "@/components/deployment-profile/DeploymentProfileProvider";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

const mocks = vi.hoisted(() => ({ pathname: "/admin/settings", enabled: new Set<string>(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/lib/modules", () => ({ useModuleEnabled: (id: string) => mocks.enabled.has(id) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
import { SidebarAdminNav } from "./SidebarAdminNav";

const ready = { requiredMissing: [], recommendedMissing: [], missingItems: [], firstMissingHref: "/admin/data-compute" };
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const open = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("settings sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.pathname = "/admin/settings"; mocks.enabled = new Set();
    mocks.fetch.mockResolvedValue(response(ready)); vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("starts with the overview and checklist, not a form builder", () => {
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    expect(screen.getByRole("link", { name: "Settings overview" }).getAttribute("href")).toBe("/admin/settings");
    expect(screen.getByRole("link", { name: "Settings overview" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Setup checklist" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Metadata & forms" }).getAttribute("aria-expanded")).toBe("false");
  });
  it("keeps shared metadata accessible without the facility module", () => {
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    expect(screen.queryByRole("button", { name: "Facility sequencing" })).toBeNull();
    open("Metadata & forms");
    expect(screen.getByRole("link", { name: "Sequencing data fields" }).getAttribute("href")).toBe("/admin/form-builder");
    expect(screen.getByRole("link", { name: "Study fields" }).getAttribute("href")).toBe("/admin/study-form-builder");
    expect(screen.getByRole("link", { name: "MIxS checklists" })).toBeTruthy();
  });
  it("uses the configured dynamic study definition", () => {
    mocks.enabled.add("dynamic-studies"); mocks.pathname = "/admin/study-definitions";
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    expect(screen.getByRole("link", { name: "Study definitions" }).getAttribute("href")).toBe("/admin/study-definitions");
    expect(screen.queryByRole("link", { name: "Study fields" })).toBeNull();
  });
  it("shows instruments and run fields when sequencing management is enabled", () => {
    mocks.enabled.add("sequencing-management");
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    open("Facility sequencing");
    expect(screen.getByRole("link", { name: "Sequencers & kits" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sequencing run fields" }).getAttribute("href")).toBe("/admin/sequencing-run-form-builder");
    expect(screen.getByRole("link", { name: "MinKNOW integration" })).toBeTruthy();
  });
  it("retains navigation for an already-open facility settings URL", () => {
    mocks.pathname = "/admin/sequencing-tech";
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    expect(screen.getByRole("link", { name: "Sequencers & kits" }).getAttribute("aria-current")).toBe("page");
  });
  it("keeps one UI for the research preset without center-only accounts", () => {
    render(<DeploymentProfileProvider profile={getDeploymentProfileDefinition("research-workbench")}><SidebarAdminNav collapsed={false} unreadMessages={0} /></DeploymentProfileProvider>);
    open("Users & access"); open("Pipelines & analysis");
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Report analysis settings" }).getAttribute("href")).toBe("/admin/settings/analysis");
    expect(screen.queryByRole("link", { name: "Departments" })).toBeNull();
  });
  it("auto-opens the active section when navigating after a manual collapse", () => {
    mocks.pathname = "/admin/form-builder";
    const { rerender } = render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    open("Metadata & forms");
    expect(screen.queryByRole("link", { name: "Study fields" })).toBeNull();
    mocks.pathname = "/admin/study-form-builder";
    rerender(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    expect(screen.getByRole("link", { name: "Study fields" }).getAttribute("aria-current")).toBe("page");
  });
  it("does not incorrectly mark overview active on a nested settings page", () => {
    mocks.pathname = "/admin/settings/system";
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    expect(screen.getByRole("link", { name: "Settings overview" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "System & maintenance" }).getAttribute("aria-current")).toBe("page");
  });
  it("keeps unread support messages visible in the services group", () => {
    mocks.pathname = "/messages";
    render(<SidebarAdminNav collapsed={false} unreadMessages={12} />);
    expect(screen.getByRole("link", { name: /Support messages/ }).getAttribute("href")).toBe("/messages");
    expect(screen.getByText("9+")).toBeTruthy();
  });
  it("gives collapsed icons accessible names and preserves overview as a destination", () => {
    render(<SidebarAdminNav collapsed unreadMessages={0} />);
    expect(screen.getByRole("link", { name: "Settings overview" }).getAttribute("href")).toBe("/admin/settings");
    expect(screen.getByRole("link", { name: "Users & access" }).getAttribute("href")).toBe("/admin/users");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
  it("does not fetch readiness for demo accounts", () => {
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} isDemoUser />);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("links required gaps directly to the setting without nested interactive elements", async () => {
    mocks.fetch.mockResolvedValue(response({ ...ready, requiredMissing: ["Storage", "Runtime"], firstMissingHref: "/admin/data-storage", missingItems: [{ key: "dataPath", label: "Storage", href: "/admin/data-storage", severity: "required" }] }));
    const { container } = render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    const badge = await screen.findByRole("link", { name: "2 required infrastructure settings missing" });
    expect(badge.getAttribute("href")).toBe("/admin/data-storage");
    expect(badge.className).toContain("bg-red-100");
    expect(container.querySelector("a a, button a, a button")).toBeNull();
    const storage = screen.getByRole("button", { name: "Storage" });
    const users = screen.getByRole("button", { name: "Users & access" });
    expect(storage.parentElement?.classList.contains("relative")).toBe(true);
    expect(badge.parentElement).toBe(storage.parentElement);
    expect(badge.classList.contains("absolute")).toBe(true);
    expect(badge.classList.contains("right-9")).toBe(true);
    for (const button of [storage, users]) {
      expect(button.classList.contains("w-full")).toBe(true);
      expect(button.lastElementChild?.matches("svg.lucide-chevron-right")).toBe(true);
    }
    expect(storage.lastElementChild?.getAttribute("class")).toBe(users.lastElementChild?.getAttribute("class"));
    fireEvent.click(storage);
    expect(storage.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Data storage" })).toBeTruthy();
    fireEvent.click(storage);
    expect(storage.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Data storage" })).toBeNull();
  });
  it("distinguishes recommendations from missing required settings", async () => {
    mocks.fetch.mockResolvedValue(response({ ...ready, recommendedMissing: ["Weblog"] }));
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    const badge = await screen.findByRole("link", { name: "1 recommended infrastructure settings pending" });
    expect(badge.className).toContain("bg-amber-100");
  });
  it("keeps settings usable if readiness cannot be fetched", async () => {
    mocks.fetch.mockResolvedValue(response({}, false));
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/admin/infrastructure/readiness"));
    expect(screen.queryByRole("link", { name: /infrastructure settings/ })).toBeNull();
    open("Storage");
    expect(screen.getByRole("link", { name: "Data storage" })).toBeTruthy();
  });
});
