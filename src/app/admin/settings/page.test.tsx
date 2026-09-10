// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ swr: vi.fn(), modules: vi.fn(), refresh: vi.fn(), mutate: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.swr }));
vi.mock("@/lib/modules", () => ({ useModules: mocks.modules }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
import SettingsOverviewPage from "./page";

const setup = { completedCount: 2, totalCount: 5, items: [{ id: "verify-storage", requirement: "required", completionMode: "automatic", complete: false, label: "Verify managed storage", href: "/admin/data-storage", automaticCheck: { status: "unverified" } }] };
const moduleState = (enabled: string[] = ["import-cami", "explore"]) => ({ isModuleEnabled: (id: string) => enabled.includes(id), availableModules: [{ id: "import-cami" }, { id: "explore" }, { id: "sequencing-management" }], loading: false, error: null, refresh: mocks.refresh, globalDisabled: false });

describe("Settings overview", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.swr.mockReturnValue({ data: setup, mutate: mocks.mutate }); mocks.modules.mockReturnValue(moduleState()); });
  afterEach(cleanup);
  it("leads with practical settings rather than diagnostics", () => {
    render(<SettingsOverviewPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Application settings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Not checked yet: Verify managed storage/ }).getAttribute("href")).toBe("/admin/onboarding");
    expect(screen.getByRole("link", { name: /System & maintenance/ }).getAttribute("href")).toBe("/admin/settings/system");
    expect(screen.getByRole("link", { name: "My account" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByText("2 of 3 modules enabled")).toBeTruthy();
  });
  it("keeps shared metadata editable when facility sequencing is disabled", () => {
    render(<SettingsOverviewPage />);
    const facility = screen.getByRole("region", { name: "Facility sequencing" });
    expect(within(facility).getByText("Module disabled")).toBeTruthy();
    expect(within(facility).queryByRole("link", { name: /Sequencers/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Sequencing data fields/ })).toBeTruthy();
  });
  it("shows facility settings when the module is enabled", () => {
    mocks.modules.mockReturnValue(moduleState(["sequencing-management"]));
    render(<SettingsOverviewPage />);
    expect(screen.getByRole("link", { name: /Sequencers & kits/ }).getAttribute("href")).toBe("/admin/sequencing-tech");
    expect(screen.getByText("Module disabled · enable it in Modules to configure analyses")).toBeTruthy();
  });
  it("filters settings by meaning, with a clear no-match state", () => {
    render(<SettingsOverviewPage />);
    const search = screen.getByRole("textbox", { name: "Find a setting" });
    expect(search.parentElement?.classList.contains("w-full")).toBe(true);
    expect(search.parentElement?.className).not.toContain("max-w-");
    fireEvent.change(search, { target: { value: "sandbox" } });
    expect(screen.getByRole("link", { name: /Report analysis settings/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Metadata & forms" })).toBeNull();
    fireEvent.change(search, { target: { value: "nothing-matches" } });
    expect(screen.getByRole("status").textContent).toContain("No matching settings");
    fireEvent.click(screen.getByRole("button", { name: "Clear settings search" }));
    expect(screen.getByRole("heading", { name: "Metadata & forms" })).toBeTruthy();
  });
  it("shows loading placeholders, not misleading completion or disabled states", () => {
    mocks.swr.mockReturnValue({ isLoading: true });
    mocks.modules.mockReturnValue({ ...moduleState(), loading: true });
    render(<SettingsOverviewPage />);
    expect(screen.getByLabelText("Loading setup status")).toBeTruthy();
    expect(screen.getByLabelText("Loading modules")).toBeTruthy();
    expect(screen.queryByText("Module disabled")).toBeNull();
  });
  it("allows independent retry without presenting failed checks as ready", () => {
    mocks.swr.mockReturnValue({ error: new Error("Offline"), mutate: mocks.mutate });
    mocks.modules.mockReturnValue({ ...moduleState(), error: "Offline" });
    render(<SettingsOverviewPage />);
    fireEvent.click(screen.getByRole("button", { name: "Retry setup status" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry modules" }));
    expect(mocks.mutate).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Required checks are complete/)).toBeNull();
    expect(screen.getByRole("link", { name: /Data storage Shared/ })).toBeTruthy();
  });
  it("does not run checks or change settings on opening", () => {
    render(<SettingsOverviewPage />);
    expect(mocks.swr.mock.calls[0][0]).toBe("/api/admin/onboarding");
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("distinguishes a failed readiness check from a check that has not run", () => {
    mocks.swr.mockReturnValue({ data: { ...setup, items: [{ ...setup.items[0], automaticCheck: { status: "needs-attention" } }] }, mutate: mocks.mutate });
    render(<SettingsOverviewPage />);
    expect(screen.getByRole("link", { name: /Needs attention: Verify managed storage/ }).getAttribute("href")).toBe("/admin/onboarding");
    expect(screen.queryByText(/Not checked yet/)).toBeNull();
  });
});
