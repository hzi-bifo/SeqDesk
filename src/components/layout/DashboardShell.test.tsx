// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
  useSidebar: vi.fn(),
  useSidebarEntity: vi.fn(),
  isEmbeddedFrame: vi.fn(),
  postDemoFrameMessage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
}));

vi.mock("./SidebarContext", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSidebar: mocks.useSidebar,
}));

vi.mock("@/lib/contexts/FieldHelpContext", () => ({
  FieldHelpProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./sidebar", () => ({
  Sidebar: ({ user, version }: { user: { name?: string | null }; version?: string }) => (
    <div data-testid="sidebar">
      {user.name ?? "unknown"}-{version ?? "none"}
    </div>
  ),
}));

vi.mock("@/components/admin/UpdateBanner", () => ({
  UpdateBanner: () => <div data-testid="update-banner">update-banner</div>,
}));

vi.mock("@/components/demo/DemoBanner", () => ({
  DemoBanner: ({
    embeddedMode,
    demoExperience,
  }: {
    embeddedMode: boolean;
    demoExperience: string;
  }) => (
    <div data-testid="demo-banner">
      {embeddedMode ? "embedded" : "standalone"}-{demoExperience}
    </div>
  ),
}));

vi.mock("./StudySelector", () => ({
  StudySelector: ({ currentStudyTitle }: { currentStudyTitle: string | null }) => (
    <div data-testid="study-selector">{currentStudyTitle ?? "no-study"}</div>
  ),
}));

vi.mock("./OrderSelector", () => ({
  OrderSelector: ({ currentOrderName }: { currentOrderName: string | null }) => (
    <div data-testid="order-selector">{currentOrderName ?? "no-order"}</div>
  ),
}));

vi.mock("./sidebar/useSidebarEntity", () => ({
  useSidebarEntity: mocks.useSidebarEntity,
}));

vi.mock("@/lib/demo/client", () => ({
  DEMO_READY_MESSAGE: "seqdesk-demo-ready",
  isEmbeddedFrame: mocks.isEmbeddedFrame,
  postDemoFrameMessage: mocks.postDemoFrameMessage,
}));

import { DashboardShell } from "./DashboardShell";

describe("DashboardShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    delete document.body.dataset.demoEmbedded;
    mocks.usePathname.mockReturnValue("/orders/order-1/sequencing");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
    mocks.useSidebar.mockReturnValue({
      collapsed: false,
      mobileOpen: false,
      setMobileOpen: vi.fn(),
    });
    mocks.useSidebarEntity.mockReturnValue({
      entityType: "order",
      entityId: "order-1",
      entityData: {
        label: "Order 42",
      },
    });
    mocks.isEmbeddedFrame.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    delete document.body.dataset.demoEmbedded;
  });

  it("renders the order selector and derived page title for order sequencing views", () => {
    render(
      <DashboardShell
        user={{ name: "Ada", role: "FACILITY_ADMIN", isDemo: false }}
        version="1.2.3"
      >
        <div>content</div>
      </DashboardShell>
    );

    expect(screen.getByTestId("sidebar").textContent).toContain("Ada-1.2.3");
    expect(screen.getByTestId("order-selector").textContent).toContain("Order 42");
    expect(screen.getByText("Sequencing Data")).toBeTruthy();
    expect(screen.getByTestId("update-banner")).toBeTruthy();
    expect(screen.queryByTestId("demo-banner")).toBeNull();
  });

  it("renders demo embedded mode and posts a ready message", () => {
    mocks.isEmbeddedFrame.mockReturnValue(true);

    render(
      <DashboardShell
        user={{ name: "Ada", role: "USER", isDemo: true, demoExperience: "facility" }}
      >
        <div>content</div>
      </DashboardShell>
    );

    expect(screen.getByTestId("demo-banner").textContent).toContain("embedded-facility");
    expect(screen.queryByTestId("update-banner")).toBeNull();
    expect(document.body.dataset.demoEmbedded).toBe("true");
    expect(mocks.postDemoFrameMessage).toHaveBeenCalledWith("seqdesk-demo-ready", {
      path: "/orders/order-1/sequencing",
    });
  });

  it("renders a mobile backdrop and closes it on click", () => {
    const setMobileOpen = vi.fn();
    mocks.useSidebar.mockReturnValue({
      collapsed: true,
      mobileOpen: true,
      setMobileOpen,
    });

    const { container } = render(
      <DashboardShell
        user={{ name: "Ada", role: "FACILITY_ADMIN", isDemo: false }}
      >
        <div>content</div>
      </DashboardShell>
    );

    const backdrop = container.querySelector(".fixed.inset-0");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as HTMLElement);
    expect(setMobileOpen).toHaveBeenCalledWith(false);
  });

  it("switches to the study selector and analysis title for study analysis routes", () => {
    mocks.usePathname.mockReturnValue("/studies/study-1");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("tab=pipelines"));
    mocks.useSidebarEntity.mockReturnValue({
      entityType: "study",
      entityId: "study-1",
      entityData: {
        label: "Study One",
      },
    });

    render(
      <DashboardShell
        user={{ name: "Ada", role: "FACILITY_ADMIN", isDemo: false }}
      >
        <div>content</div>
      </DashboardShell>
    );

    expect(screen.getByTestId("study-selector").textContent).toContain("Study One");
    expect(screen.getByText("Analysis")).toBeTruthy();
  });
});
