// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ modules: vi.fn(), swr: vi.fn(), refresh: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/modules", () => ({ useModules: mocks.modules }));
vi.mock("swr", () => ({ default: mocks.swr }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
import { AnalysisEnvironmentSettings } from "./AnalysisEnvironmentSettings";

describe("Report analysis settings", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.modules.mockReturnValue({ isModuleEnabled: () => true, loading: false, error: null, refresh: mocks.refresh }); mocks.swr.mockReturnValue({ data: { environments: [] }, mutate: mocks.retry }); });
  afterEach(cleanup);
  it("does not call disabled Explore APIs or present a broken settings form", () => {
    mocks.modules.mockReturnValue({ isModuleEnabled: () => false });
    render(<AnalysisEnvironmentSettings administration />);
    expect(screen.getByRole("heading", { name: "Reports module is disabled" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open analysis modules" }).getAttribute("href")).toBe("/admin/modules?category=analysis");
    expect(mocks.swr).not.toHaveBeenCalled();
  });
  it("does not confuse module loading failures with a disabled feature", () => {
    mocks.modules.mockReturnValue({ isModuleEnabled: () => false, error: "Offline", refresh: mocks.refresh });
    render(<AnalysisEnvironmentSettings administration />);
    fireEvent.click(screen.getByRole("button", { name: "Retry module status" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.swr).not.toHaveBeenCalled();
  });
  it("shows a placeholder while module availability is loading", () => {
    mocks.modules.mockReturnValue({ loading: true });
    render(<AnalysisEnvironmentSettings administration />);
    expect(screen.getByLabelText("Loading Reports module")).toBeTruthy();
    expect(mocks.swr).not.toHaveBeenCalled();
  });
  it("keeps settings navigation and independent retry for failed environments and sandbox", () => {
    mocks.swr.mockReturnValue({ error: new Error("Could not load"), mutate: mocks.retry });
    render(<AnalysisEnvironmentSettings administration />);
    expect(screen.getByRole("link", { name: "Application settings" }).getAttribute("href")).toBe("/admin/settings");
    fireEvent.click(screen.getByRole("button", { name: "Retry environments" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry isolation settings" }));
    expect(mocks.retry).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });
  it("retains the original Reports navigation outside administration", () => {
    mocks.swr.mockImplementation((url: string) => url.endsWith("environments") ? { data: { environments: [] } } : {});
    render(<AnalysisEnvironmentSettings />);
    expect(screen.getByRole("link", { name: "Reports" }).getAttribute("href")).toBe("/explore");
    expect(screen.getByRole("heading", { name: "Analysis environments" })).toBeTruthy();
  });
});
