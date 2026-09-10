// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InfrastructureOverviewPage from "./page";

vi.mock("@/components/admin/infrastructure/InfrastructureSetupStatus", () => ({
  InfrastructureSetupStatus: () => <div>Storage checks</div>,
}));
vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Storage and compute overview", () => {
  it("separates shared storage, pipeline execution and report analyses without applying settings", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<InfrastructureOverviewPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Storage & compute overview" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open data storage" }).getAttribute("href")).toBe("/admin/data-storage");
    expect(screen.getByRole("link", { name: "Configure pipeline execution" }).getAttribute("href")).toBe("/admin/pipeline-runtime");
    expect(screen.getByRole("link", { name: "Configure report analyses" }).getAttribute("href")).toBe("/admin/settings/analysis");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Load Example" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
