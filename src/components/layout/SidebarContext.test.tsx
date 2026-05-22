// @vitest-environment jsdom

import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SidebarProvider,
  useSidebar,
} from "./SidebarContext";

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

  it("hydrates and persists the expanded sidebar width", async () => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "312.4");

    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider>{children}</SidebarProvider>,
    });

    await waitFor(() => {
      expect(result.current.sidebarWidth).toBe(312);
    });

    act(() => {
      result.current.setSidebarWidth(340);
    });

    await waitFor(() => {
      expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("340");
    });
  });

  it("clamps sidebar width updates to the configured limits", async () => {
    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider>{children}</SidebarProvider>,
    });

    await waitFor(() => {
      expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_DEFAULT_WIDTH));
    });

    act(() => {
      result.current.setSidebarWidth(SIDEBAR_MIN_WIDTH - 100);
    });
    expect(result.current.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);

    act(() => {
      result.current.setSidebarWidth((current) => current + 1000);
    });
    expect(result.current.sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("uses embedded mode width defaults without persisting state", async () => {
    localStorage.setItem("sidebar-collapsed", "false");
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "340");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    setWindowWidth(1000);

    const { result } = renderHook(() => useSidebar(), {
      wrapper: ({ children }) => <SidebarProvider embeddedMode>{children}</SidebarProvider>,
    });

    await waitFor(() => {
      expect(result.current.collapsed).toBe(true);
    });
    expect(result.current.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);

    act(() => {
      result.current.setSidebarWidth(320);
      setWindowWidth(1300);
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(result.current.collapsed).toBe(false);
    });

    expect(result.current.sidebarWidth).toBe(320);
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem("sidebar-collapsed")).toBe("false");
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("340");
  });

  it("throws when useSidebar is used outside the provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useSidebar())).toThrow(
      "useSidebar must be used within a SidebarProvider"
    );

    consoleError.mockRestore();
  });
});
