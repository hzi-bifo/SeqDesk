// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toggleHelpText = vi.fn();

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  signOut: vi.fn(),
  useHelpText: vi.fn(),
  useSidebarEntity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: mocks.useRouter,
  useSearchParams: mocks.useSearchParams,
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

vi.mock("@/lib/contexts/FieldHelpContext", () => ({
  useFieldHelp: () => ({ focusedField: null }),
}));

vi.mock("./useSidebarEntity", () => ({
  useSidebarEntity: mocks.useSidebarEntity,
}));

import { Footer } from "../Footer";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SidebarContext,
} from "../SidebarContext";
import { Sidebar } from "./Sidebar";
import { SidebarSupportNav } from "./SidebarSupportNav";
import { SidebarUserMenu } from "./SidebarUserMenu";

function sidebarValue(collapsed: boolean, sidebarWidth = SIDEBAR_DEFAULT_WIDTH) {
  return {
    collapsed,
    setCollapsed: vi.fn(),
    toggle: vi.fn(),
    mobileOpen: false,
    setMobileOpen: vi.fn(),
    sidebarWidth,
    setSidebarWidth: vi.fn(),
  };
}

describe("sidebar shell quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T15:45:00.000Z"));
    window.history.pushState({}, "", "/");
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;

    mocks.usePathname.mockReturnValue("/messages");
    mocks.useRouter.mockReturnValue({ push: vi.fn() });
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
    mocks.signOut.mockResolvedValue(undefined);
    mocks.useHelpText.mockReturnValue({
      showHelpText: false,
      isLoaded: true,
      toggleHelpText,
    });
    mocks.useSidebarEntity.mockReturnValue({
      entityType: null,
      entityId: null,
      entityData: null,
      isLoading: false,
      currentSubPage: "overview",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
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
    const expandedValue = sidebarValue(false, 312);
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

    const footer = container.querySelector("footer");
    expect(footer?.className).toContain("left-0");
    expect(footer?.className).toContain("right-0");
    expect(footer?.className).toContain("md:left-[var(--seqdesk-sidebar-offset)]");
    expect(footer?.style.getPropertyValue("--seqdesk-sidebar-offset")).toBe("312px");
    expect(footer?.style.right).toBe("var(--entity-notes-sidebar-offset, 0px)");
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

    expect(footer?.style.getPropertyValue("--seqdesk-sidebar-offset")).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`);
  });

  it("renders the resize handle only for the expanded sidebar", () => {
    mocks.usePathname.mockReturnValue("/workbench/data");
    const expandedValue = sidebarValue(false, 300);
    const collapsedValue = sidebarValue(true, 300);

    const { rerender, container } = render(
      <SidebarContext.Provider value={expandedValue}>
        <Sidebar user={{ name: "Ada Admin", role: "FACILITY_ADMIN" }} />
      </SidebarContext.Provider>
    );

    expect(container.querySelector("aside")?.style.width).toBe("300px");
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(expandedValue.setSidebarWidth).toHaveBeenCalledWith(316);

    rerender(
      <SidebarContext.Provider value={collapsedValue}>
        <Sidebar user={{ name: "Ada Admin", role: "FACILITY_ADMIN" }} />
      </SidebarContext.Provider>
    );

    expect(container.querySelector("aside")?.style.width).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`);
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
  });

  it("does not show Workbench navigation in Lab mode", () => {
    mocks.usePathname.mockReturnValue("/orders");

    render(
      <SidebarContext.Provider value={sidebarValue(false, 300)}>
        <Sidebar user={{ name: "Ada Admin", role: "FACILITY_ADMIN" }} />
      </SidebarContext.Provider>
    );

    expect(screen.queryByText("Private Workbench")).toBeNull();
    expect(screen.queryByRole("link", { name: /Workbench/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Canvas/i })).toBeNull();
  });

  it("hides lab and admin navigation in Workbench app mode", () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";
    mocks.usePathname.mockReturnValue("/orders");

    render(
      <SidebarContext.Provider value={sidebarValue(false, 300)}>
        <Sidebar user={{ name: "Ada Admin", role: "FACILITY_ADMIN" }} />
      </SidebarContext.Provider>
    );

    expect(screen.getByText("Private Workbench")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Canvas/i }).getAttribute("href")).toBe(
      "/workbench/data"
    );
    expect(screen.queryByRole("link", { name: /Lab/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Application Settings/i })).toBeNull();
  });
});
