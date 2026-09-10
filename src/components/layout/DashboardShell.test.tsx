// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  useSidebar: vi.fn(),
  useSidebarEntity: vi.fn(),
  isEmbeddedFrame: vi.fn(),
  postDemoFrameMessage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: mocks.useRouter,
  useSearchParams: mocks.useSearchParams,
}));

vi.mock("./SidebarContext", () => ({
  SIDEBAR_COLLAPSED_WIDTH: 64,
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSidebar: mocks.useSidebar,
}));

vi.mock("@/lib/contexts/FieldHelpContext", () => ({
  FieldHelpProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./Footer", () => ({
  Footer: () => <footer data-testid="footer" />,
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
import { DEPLOYMENT_PROFILES } from "@/lib/deployment-profile";

const sequencingCenterProfile = DEPLOYMENT_PROFILES["sequencing-center"];
const workbenchProfile = DEPLOYMENT_PROFILES["research-workbench"];

describe("DashboardShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    delete document.body.dataset.demoEmbedded;
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
    mocks.usePathname.mockReturnValue("/orders/order-1/sequencing");
    mocks.useRouter.mockReturnValue({
      replace: vi.fn(),
    });
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
    mocks.useSidebar.mockReturnValue({
      collapsed: false,
      mobileOpen: false,
      setMobileOpen: vi.fn(),
      sidebarWidth: 312,
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
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
  });

  it("renders the order selector and derived page title for order sequencing views", () => {
    render(
      <DashboardShell
        user={{ name: "Ada", role: "FACILITY_ADMIN", isDemo: false }}
        version="1.2.3"
        deploymentProfile={sequencingCenterProfile}
      >
        <div>content</div>
      </DashboardShell>
    );

    expect(screen.getByTestId("sidebar").textContent).toContain("Ada-1.2.3");
    expect(screen.getByTestId("order-selector").textContent).toContain("Order 42");
    expect(screen.getByText("Files / Facility processing")).toBeTruthy();
    expect(screen.getByTestId("update-banner")).toBeTruthy();
    expect(screen.queryByTestId("demo-banner")).toBeNull();
    expect(
      screen.getByText("content").closest("main")?.parentElement?.style.getPropertyValue("--sidebar-offset")
    ).toBe("312px");
    expect(screen.getByText("content").closest("main")?.parentElement?.className).toContain(
      "pb-[calc(var(--seqdesk-footer-height,2.5rem)+2rem)]"
    );
  });

  it.each([
    ["samples-files", "", "Files"],
    ["files", "", "Files"],
    ["sequencing", "view=discover", "Files / Facility file association"],
    ["sequencing", "view=stream", "Files / Live sequencer"],
    ["sequencing", "view=analysis", "Pipelines"],
    ["sequencing", "pipeline=fastq-checksum", "Pipelines"],
  ])("derives the title for %s?%s", (subview, query, title) => {
    mocks.usePathname.mockReturnValue(`/orders/order-1/${subview}`);
    mocks.useSearchParams.mockReturnValue(new URLSearchParams(query));
    render(<DashboardShell user={{ name: "Ada" }} deploymentProfile={sequencingCenterProfile}><div>content</div></DashboardShell>);
    expect(screen.getByText(title)).toBeTruthy();
  });

  it.each(["/explore/reports/report-1", "/explore/reports/report-1/"])("keeps the full-height report sidebar flush with the footer at %s", pathname => {
    mocks.usePathname.mockReturnValue(pathname);
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("mode=edit&view=page"));
    render(<DashboardShell user={{ name: "Ada" }} deploymentProfile={sequencingCenterProfile}><div>report content</div></DashboardShell>);
    const shell = screen.getByText("report content").closest("main")!.parentElement!;
    expect(shell.classList.contains("pb-[var(--seqdesk-footer-height,2.5rem)]")).toBe(true);
    expect(shell.classList.contains("pb-[calc(var(--seqdesk-footer-height,2.5rem)+2rem)]")).toBe(false);
    expect(screen.getByTestId("footer")).toBeTruthy();
  });

  it.each(["/explore", "/orders", "/studies"])("preserves normal page spacing outside the report workspace at %s", pathname => {
    mocks.usePathname.mockReturnValue(pathname);
    render(<DashboardShell user={{ name: "Ada" }} deploymentProfile={sequencingCenterProfile}><div>page content</div></DashboardShell>);
    const shell = screen.getByText("page content").closest("main")!.parentElement!;
    expect(shell.classList.contains("pb-[calc(var(--seqdesk-footer-height,2.5rem)+2rem)]")).toBe(true);
  });

  it("keeps repository imports in the Files context", () => {
    mocks.usePathname.mockReturnValue("/orders/import");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("orderId=order-1&source=sra"));
    render(<DashboardShell user={{ name: "Ada" }} deploymentProfile={sequencingCenterProfile}><div>content</div></DashboardShell>);
    expect(screen.getByText("Files / Import data with SeqDesk")).toBeTruthy();
    expect(screen.getByTestId("order-selector").textContent).toContain("Order 42");
  });

  it("renders demo embedded mode and posts a ready message", () => {
    mocks.isEmbeddedFrame.mockReturnValue(true);

    render(
      <DashboardShell
        user={{ name: "Ada", role: "USER", isDemo: true, demoExperience: "facility" }}
        deploymentProfile={sequencingCenterProfile}
      >
        <div>content</div>
      </DashboardShell>
    );

    // Demo banner is hidden in embedded mode (landing page handles reset externally)
    expect(screen.queryByTestId("demo-banner")).toBeNull();
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
      sidebarWidth: 312,
    });

    const { container } = render(
      <DashboardShell
        user={{ name: "Ada", role: "FACILITY_ADMIN", isDemo: false }}
        deploymentProfile={sequencingCenterProfile}
      >
        <div>content</div>
      </DashboardShell>
    );

    const backdrop = container.querySelector(".fixed.inset-0");
    expect(backdrop).not.toBeNull();
    expect(
      screen.getByText("content").closest("main")?.parentElement?.style.getPropertyValue("--sidebar-offset")
    ).toBe("64px");
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
        deploymentProfile={sequencingCenterProfile}
      >
        <div>content</div>
      </DashboardShell>
    );

    expect(screen.getByTestId("study-selector").textContent).toContain("Study One");
    expect(screen.getByText("Analysis")).toBeTruthy();
  });

  it("renders Workbench pages without the lab entity selector", () => {
    mocks.usePathname.mockReturnValue("/workbench/data");

    render(
      <DashboardShell
        user={{ name: "Ada", role: "FACILITY_ADMIN", isDemo: false }}
        deploymentProfile={workbenchProfile}
      >
        <div>content</div>
      </DashboardShell>
    );

    expect(screen.queryByText("Workbench Canvas")).toBeNull();
    expect(screen.queryByTestId("order-selector")).toBeNull();
    expect(screen.queryByTestId("study-selector")).toBeNull();
  });

  it("keeps sequencing routes and the shared selector in the research preset", () => {
    const replace = vi.fn();
    mocks.useRouter.mockReturnValue({ replace });
    mocks.usePathname.mockReturnValue("/orders");

    render(
      <DashboardShell
        user={{ name: "Ada", role: "FACILITY_ADMIN", isDemo: false }}
        deploymentProfile={workbenchProfile}
      >
        <div>content</div>
      </DashboardShell>
    );

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("update-banner")).toBeTruthy();
    expect(screen.getByTestId("order-selector")).toBeTruthy();
    expect(screen.queryByTestId("study-selector")).toBeNull();
  });
});
