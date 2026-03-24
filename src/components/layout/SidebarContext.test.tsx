// @vitest-environment jsdom

import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider, useSidebar } from "./SidebarContext";

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe("SidebarContext", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    setWindowWidth(1280);
  });

  it("hydrates collapsed state from localStorage and persists toggles", async () => {
    localStorage.setItem("sidebar-collapsed", "true");

    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider>{children}</SidebarProvider>,
    });

    await waitFor(() => {
      expect(result.current.collapsed).toBe(true);
    });

    act(() => {
      result.current.toggle();
    });

    await waitFor(() => {
      expect(localStorage.getItem("sidebar-collapsed")).toBe("false");
    });

    act(() => {
      result.current.setMobileOpen(true);
    });
    expect(result.current.mobileOpen).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(result.current.mobileOpen).toBe(false);
    });
  });

  it("uses embedded mode width defaults without persisting state", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    localStorage.setItem("sidebar-collapsed", "false");
    setWindowWidth(1000);

    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider embeddedMode>{children}</SidebarProvider>,
    });

    await waitFor(() => {
      expect(result.current.collapsed).toBe(true);
    });

    act(() => {
      setWindowWidth(1300);
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(result.current.collapsed).toBe(false);
    });

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("sidebar-collapsed")).toBe("false");
  });

  it("throws when useSidebar is used outside the provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useSidebar())).toThrow(
      "useSidebar must be used within a SidebarProvider"
    );

    consoleError.mockRestore();
  });
});
