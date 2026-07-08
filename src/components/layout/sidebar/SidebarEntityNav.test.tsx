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
      { pipelineId: "fastq-checksum", name: "FASTQ Checksum", status: "complete", runIds: ["run-1"] },
    ]);
    mocks.useStudyPipelines.mockReturnValue([
      { pipelineId: "mag", name: "MAG", category: "analysis", status: "active", runIds: ["run-1"] },
    ]);
    mocks.progressClassName.mockImplementation((status: string) => {
      if (status === "complete") return "bg-[#00BD7D]";
      if (status === "partial") return "bg-amber-400";
      return "bg-slate-400";
    });
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
    const detailsLink = screen.getByRole("link", { name: /Details/i });
    expect(detailsLink.getAttribute("href")).toBe("/orders/order-1/edit?step=details");
    expect(screen.getByText("Order Fields")).toBeTruthy();
    expect(screen.getByText("Sample Fields")).toBeTruthy();
    expect(screen.getByText("Associate")).toBeTruthy();
    expect(screen.getByText("FASTQ Checksum")).toBeTruthy();
    const pipelineLink = screen.getByRole("link", { name: /FASTQ Checksum/i });
    const pipelineDot = pipelineLink.querySelector("span[aria-hidden='true']");
    expect(pipelineDot?.className).toContain("bg-[#00BD7D]");
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
    const overviewSectionLink = screen.getByRole("link", { name: /Overview A/i });
    expect(overviewSectionLink.getAttribute("href")).toBe("/studies/study-1/edit?section=overview-a");
    expect(screen.getByText("Facility B")).toBeTruthy();
    expect(screen.queryByText("Read Files")).toBeNull();
    // Analysis (study pipelines tab) is now shown to the facility-admin demo so
    // the seeded, published MAG run + its MultiQC are reachable from the study.
    expect(screen.getByText("Analysis")).toBeTruthy();
    // Publishing is shown to demo users too, as a view-only showcase — the
    // registration view is reachable but the submit actions are disabled.
    expect(screen.getByText("Publishing")).toBeTruthy();
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

  it("marks study read files green only when every sample has linked reads", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        samples: [
          { reads: [{ file1: "reads/sample-a.fastq", file2: null }] },
          { reads: [{ file1: "reads/sample-b.fastq", file2: null }] },
        ],
      }),
    });
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

    const readsLink = screen.getByRole("link", { name: /Read Files/i });
    const readsDot = readsLink.querySelector("span[aria-hidden='true']");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/studies/study-1");
      expect(readsDot?.className).toContain("bg-[#00BD7D]");
    });
  });

  it("marks study read files amber when only some samples have reads", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        samples: [
          { reads: [{ file1: "reads/sample-a.fastq", file2: null }] },
          { reads: [] },
        ],
      }),
    });
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

    const readsLink = screen.getByRole("link", { name: /Read Files/i });
    const readsDot = readsLink.querySelector("span[aria-hidden='true']");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/studies/study-1");
      expect(readsDot?.className).toContain("bg-amber-400");
    });
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
      "/studies/study-1?tab=pipelines&pipeline=mag"
    );
    const pipelineDot = pipelineLink.querySelector("span[aria-hidden='true']");
    expect(pipelineDot?.className).toContain("bg-blue-500");
  });

  it("marks study analysis and the selected pipeline active on analysis detail pages", () => {
    mocks.usePathname.mockReturnValue("/analysis/run-1");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("studyId=study-1&pipeline=mag"));

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

    const analysisLink = screen.getByRole("link", { name: /^Analysis$/i });
    expect(analysisLink.className).toContain("font-medium");

    const pipelineLink = screen.getByRole("link", { name: /MAG/i });
    expect(pipelineLink.className).toContain("font-medium");
  });

  it("infers the selected study pipeline on analysis detail pages without a pipeline query param", () => {
    mocks.usePathname.mockReturnValue("/analysis/run-1");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("studyId=study-1"));

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

    const analysisLink = screen.getByRole("link", { name: /^Analysis$/i });
    expect(analysisLink.className).toContain("font-medium");

    const pipelineLink = screen.getByRole("link", { name: /MAG/i });
    expect(pipelineLink.className).toContain("font-medium");
  });

  it("does not infer a study pipeline when the analysis run is not in the sidebar run list", () => {
    mocks.usePathname.mockReturnValue("/analysis/other-run");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("studyId=study-1"));

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

    const analysisLink = screen.getByRole("link", { name: /^Analysis$/i });
    expect(analysisLink.className).toContain("font-medium");

    const pipelineLink = screen.getByRole("link", { name: /MAG/i });
    expect(pipelineLink.className).not.toContain("font-medium");
  });

  it("marks order analysis and the selected pipeline active on analysis detail pages", () => {
    mocks.usePathname.mockReturnValue("/analysis/run-1");
    mocks.useSearchParams.mockReturnValue(
      new URLSearchParams("orderId=order-1&pipeline=fastq-checksum")
    );

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

    const analysisLink = screen.getByRole("link", { name: /^Analysis$/i });
    expect(analysisLink.className).toContain("font-medium");

    const pipelineLink = screen.getByRole("link", { name: /FASTQ Checksum/i });
    expect(pipelineLink.className).toContain("font-medium");
  });

  it("infers the selected order pipeline on analysis detail pages without a pipeline query param", () => {
    mocks.usePathname.mockReturnValue("/analysis/run-1");
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("orderId=order-1"));

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

    const analysisLink = screen.getByRole("link", { name: /^Analysis$/i });
    expect(analysisLink.className).toContain("font-medium");

    const pipelineLink = screen.getByRole("link", { name: /FASTQ Checksum/i });
    expect(pipelineLink.className).toContain("font-medium");
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
          entityData: { label: "Study 1", sublabel: "STD-001", status: "READY" },
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
    const enaDot = enaLink.querySelector("span[aria-hidden='true']");
    expect(enaDot?.className).toContain("bg-slate-300");
    expect(enaDot?.className).not.toContain("bg-[#00BD7D]");
  });

  it("marks the ENA publishing subitem green only after registration", () => {
    mocks.usePathname.mockReturnValue("/studies/study-1");
    mocks.useSearchParams.mockReturnValue(
      new URLSearchParams("tab=publishing&publisher=ena")
    );

    render(
      <SidebarEntityNav
        entityContext={{
          entityType: "study",
          entityId: "study-1",
          entityData: { label: "Study 1", sublabel: "STD-001", status: "PUBLISHED" },
        }}
        collapsed={false}
        showAdminControls
      />
    );

    const enaLink = screen.getByRole("link", { name: /ENA/i });
    const enaDot = enaLink.querySelector("span[aria-hidden='true']");
    expect(enaDot?.className).toContain("bg-[#00BD7D]");
  });

  it("hides entity navigation on collection routes without a selected entity", () => {
    mocks.usePathname.mockReturnValue("/orders");

    const { container } = render(
      <SidebarEntityNav
        entityContext={{ entityType: null, entityId: null, entityData: null }}
        collapsed={false}
        showAdminControls
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
