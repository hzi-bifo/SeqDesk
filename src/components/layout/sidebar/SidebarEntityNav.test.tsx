// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
  useOrderFormSteps: vi.fn(),
  useStudyFormSteps: vi.fn(),
  useOrderPipelines: vi.fn(),
  useStudyPipelines: vi.fn(),
  progressClassName: vi.fn(),
  progressLabel: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
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

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./useOrderFormSteps", () => ({
  useOrderFormSteps: mocks.useOrderFormSteps,
}));

vi.mock("./useStudyFormSteps", () => ({
  useStudyFormSteps: mocks.useStudyFormSteps,
}));

vi.mock("./useOrderPipelines", () => ({
  useOrderPipelines: mocks.useOrderPipelines,
}));

vi.mock("./useStudyPipelines", () => ({
  useStudyPipelines: mocks.useStudyPipelines,
}));

vi.mock("@/lib/orders/progress-status", () => ({
  getOrderProgressIndicatorClassName: mocks.progressClassName,
  getOrderProgressIndicatorLabel: mocks.progressLabel,
}));

import { SidebarEntityNav } from "./SidebarEntityNav";

describe("SidebarEntityNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mocks.usePathname.mockReturnValue("/orders/order-1/sequencing");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("view=discover"));
    mocks.useOrderFormSteps.mockReturnValue({
      steps: [
        { id: "_facility", label: "Facility", status: "complete" },
        { id: "samples", label: "Samples", status: "partial" },
        { id: "details", label: "Details", status: "complete" },
      ],
      facilitySections: [
        { id: "order-fields", label: "Order Fields", status: "complete" },
        { id: "sample-fields", label: "Sample Fields", status: "partial" },
      ],
    });
    mocks.useStudyFormSteps.mockReturnValue({
      overviewSections: [
        { id: "overview-a", label: "Overview A", status: "complete" },
      ],
      facilitySections: [
        { id: "facility-b", label: "Facility B", status: "partial" },
      ],
    });
    mocks.useOrderPipelines.mockReturnValue([
      { pipelineId: "fastq-checksum", name: "FASTQ Checksum", status: "complete" },
    ]);
    mocks.useStudyPipelines.mockReturnValue([
      { pipelineId: "mag", name: "MAG", status: "partial" },
    ]);
    mocks.progressClassName.mockImplementation((status: string) => `indicator-${status}`);
    mocks.progressLabel.mockImplementation((status: string) => `label-${status}`);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: {
          totalSamples: 2,
          readsLinkedSamples: 1,
        },
      }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("returns null outside entity routes when no entity is selected", () => {
    mocks.usePathname.mockReturnValue("/analysis");

    const { container } = render(
      <SidebarEntityNav
        entityContext={{ entityType: null, entityId: null, entityData: null }}
        collapsed={false}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders order navigation, nested subitems, and sequencing association fetch state", async () => {
    render(
      <SidebarEntityNav
        entityContext={{
          entityType: "order",
          entityId: "order-1",
          entityData: { label: "Order 1" },
        }}
        collapsed={false}
        showAdminControls
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/orders/order-1/sequencing");
    });

    const overviewLinks = screen.getAllByRole("link", { name: /Overview/i });
    expect(
      overviewLinks.some((link) => link.getAttribute("href") === "/orders/order-1")
    ).toBe(true);
    expect(screen.getByText("Facility Fields")).toBeTruthy();
    expect(screen.getByText("Sequencing Data")).toBeTruthy();
    expect(screen.getByText("Analysis")).toBeTruthy();
    expect(screen.getByText("Samples")).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("Order Fields")).toBeTruthy();
    expect(screen.getByText("Sample Fields")).toBeTruthy();
    expect(screen.getByText("Associate")).toBeTruthy();
    expect(screen.getByText("FASTQ Checksum")).toBeTruthy();
  });

  it("renders study navigation and hides demo-only restricted items", () => {
    mocks.usePathname.mockReturnValue("/studies/study-1/facility");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("subsection=facility-b"));

    render(
      <SidebarEntityNav
        entityContext={{
          entityType: "study",
          entityId: "study-1",
          entityData: { label: "Study 1" },
        }}
        collapsed={false}
        isDemoUser
        showAdminControls
      />
    );

    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Facility Fields")).toBeTruthy();
    expect(screen.getByText("Sequencing Data")).toBeTruthy();
    expect(screen.getByText("Samples")).toBeTruthy();
    expect(screen.getByText("Overview A")).toBeTruthy();
    expect(screen.getByText("Facility B")).toBeTruthy();
    expect(screen.queryByText("Read Files")).toBeNull();
    expect(screen.queryByText("Analysis")).toBeNull();
    expect(screen.queryByText("Publishing")).toBeNull();
  });

  it("renders study sequencing subitems under a single parent", () => {
    mocks.usePathname.mockReturnValue("/studies/study-1");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("tab=reads"));

    render(
      <SidebarEntityNav
        entityContext={{
          entityType: "study",
          entityId: "study-1",
          entityData: { label: "Study 1" },
        }}
        collapsed={false}
        showAdminControls
      />
    );

    expect(screen.getByText("Sequencing Data")).toBeTruthy();
    expect(screen.getByText("Samples")).toBeTruthy();
    const readsLink = screen.getByRole("link", { name: /Read Files/i });
    expect(readsLink.getAttribute("href")).toBe("/studies/study-1?tab=reads");
  });

  it("renders study analysis pipeline subitems with progress dots", () => {
    mocks.usePathname.mockReturnValue("/studies/study-1");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("tab=pipelines&pipeline=mag"));

    render(
      <SidebarEntityNav
        entityContext={{
          entityType: "study",
          entityId: "study-1",
          entityData: { label: "Study 1" },
        }}
        collapsed={false}
        showAdminControls
      />
    );

    const pipelineLink = screen.getByRole("link", { name: /MAG/i });
    expect(pipelineLink.getAttribute("href")).toBe(
      "/studies/study-1?tab=pipelines&pipeline=mag#study-pipeline-mag"
    );
  });

  it("renders study publishing with ENA subitem", () => {
    mocks.usePathname.mockReturnValue("/studies/study-1");
    mocks.useSearchParams.mockReturnValue(
      new URLSearchParams("tab=publishing&publisher=ena")
    );

    render(
      <SidebarEntityNav
        entityContext={{
          entityType: "study",
          entityId: "study-1",
          entityData: { label: "Study 1" },
        }}
        collapsed={false}
        showAdminControls
      />
    );

    expect(screen.getByText("Publishing")).toBeTruthy();
    const enaLink = screen.getByRole("link", { name: /ENA/i });
    expect(enaLink.getAttribute("href")).toBe(
      "/studies/study-1?tab=publishing&publisher=ena"
    );
  });

  it("renders disabled order items when on an entity route without a selected entity", () => {
    mocks.usePathname.mockReturnValue("/orders");

    render(
      <SidebarEntityNav
        entityContext={{ entityType: null, entityId: null, entityData: null }}
        collapsed={false}
        showAdminControls
      />
    );

    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Facility Fields")).toBeTruthy();
    expect(screen.getByText("Sequencing Data")).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
