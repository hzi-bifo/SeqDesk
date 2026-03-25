// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toggleHelpText = vi.fn();

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  signOut: vi.fn(),
  useHelpText: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));

vi.mock("next-auth/react", () => ({
  signOut: mocks.signOut,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/useHelpText", () => ({
  useHelpText: mocks.useHelpText,
}));

import { Footer } from "../Footer";
import { SidebarContext } from "../SidebarContext";
import { SidebarSupportNav } from "./SidebarSupportNav";
import { SidebarUserMenu } from "./SidebarUserMenu";

function sidebarValue(collapsed: boolean) {
  return {
    collapsed,
    setCollapsed: vi.fn(),
    toggle: vi.fn(),
    mobileOpen: false,
    setMobileOpen: vi.fn(),
  };
}

describe("sidebar shell quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T15:45:00.000Z"));
    window.history.pushState({}, "", "/");

    mocks.usePathname.mockReturnValue("/messages");
    mocks.signOut.mockResolvedValue(undefined);
    mocks.useHelpText.mockReturnValue({
      showHelpText: false,
      isLoaded: true,
      toggleHelpText,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders support nav in expanded and collapsed modes", () => {
    const { rerender, container } = render(
      <SidebarSupportNav collapsed={false} unreadMessages={12} />
    );

    const supportLink = screen.getByRole("link", { name: /Support/i });
    expect(screen.getByText("Help & Guide")).toBeTruthy();
    expect(screen.getByText("9+")).toBeTruthy();
    expect(supportLink.className).toContain("bg-secondary");

    mocks.usePathname.mockReturnValue("/help");
    rerender(<SidebarSupportNav collapsed unreadMessages={2} />);

    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("title")).toBe("Help");
    expect(screen.queryByText("Support")).toBeNull();
    expect(screen.queryByText("Help & Guide")).toBeNull();
  });

  it("opens the expanded user menu, closes on outside clicks, and signs out", async () => {
    render(
      <SidebarUserMenu
        collapsed={false}
        user={{
          name: "Ada Admin",
          email: "ada@example.test",
          role: "FACILITY_ADMIN",
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Ada Admin/i }));
    expect(screen.getByRole("link", { name: "Administration" }).getAttribute("href")).toBe(
      "/admin"
    );

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("link", { name: "Administration" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ada Admin/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });

    expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("renders collapsed demo user menu without admin link", () => {
    render(
      <SidebarUserMenu
        collapsed
        user={{
          name: "Demo User",
          role: "FACILITY_ADMIN",
          isDemo: true,
          demoExperience: "facility",
        }}
      />
    );

    fireEvent.click(screen.getByTitle("Demo User"));

    expect(screen.getByText("Facility Demo")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Administration" })).toBeNull();
    expect(screen.getByRole("link", { name: "Account Settings" }).getAttribute("href")).toBe(
      "/settings"
    );
  });

  it("renders footer layout, toggles help text, and reflects collapsed width", () => {
    const expandedValue = sidebarValue(false);
    const collapsedValue = sidebarValue(true);
    const expectedDate = new Date("2026-03-25T15:45:00.000Z").toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const expectedTime = new Date("2026-03-25T15:45:00.000Z").toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const { rerender, container } = render(
      <SidebarContext.Provider value={expandedValue}>
        <Footer />
      </SidebarContext.Provider>
    );

    expect(container.querySelector("footer")?.style.left).toBe("256px");
    expect(screen.getByRole("button", { name: /Help tips off/i })).toBeTruthy();
    expect(screen.getByText(expectedDate)).toBeTruthy();
    expect(screen.getByText(expectedTime)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Help tips off/i }));
    expect(toggleHelpText).toHaveBeenCalledTimes(1);

    rerender(
      <SidebarContext.Provider value={collapsedValue}>
        <Footer />
      </SidebarContext.Provider>
    );

    expect(container.querySelector("footer")?.style.left).toBe("64px");
  });
});
