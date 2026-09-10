// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarPipelineLink } from "./SidebarPipelineLink";
import type { EntityPipelineNavItem } from "./useEntityPipelines";

const pipeline: EntityPipelineNavItem = {
  pipelineId: "paired-qc",
  name: "Paired QC",
  category: "analysis",
  status: "complete",
  runIds: ["run-1"],
  compatibility: {
    status: "partial",
    totalSamples: 12,
    compatibleSamples: 8,
    summary: "8 of 12 samples have compatible inputs",
    reasons: [{ count: 4, reason: "Missing R2 file" }],
  },
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SidebarPipelineLink", () => {
  it("provides compatibility and run history in the accessible link name", () => {
    render(<SidebarPipelineLink pipeline={pipeline} href="/orders/order-1/sequencing?pipeline=paired-qc" active />);
    const link = screen.getByRole("link", { name: /Paired QC.*8 of 12.*4: Missing R2 file.*Pipeline completed/ });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("href")).toContain("pipeline=paired-qc");
    expect(link.querySelector("[data-compatibility=partial] span")?.className).toContain("w-1/2");
    expect(link.querySelector("[data-run-status=complete]")).toBeTruthy();
  });

  it("opens an explanatory tooltip when the link receives keyboard focus", async () => {
    render(<SidebarPipelineLink pipeline={pipeline} href="/pipelines" active={false} />);
    fireEvent.focus(screen.getByRole("link"));
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText("8 of 12 samples have compatible inputs")).toBeTruthy();
    expect(within(tooltip).getByText("4: Missing R2 file")).toBeTruthy();
    expect(within(tooltip).getByText("Pipeline completed")).toBeTruthy();
    fireEvent.blur(screen.getByRole("link"));
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it.each(["compatible", "partial", "incompatible", "unknown"] as const)("renders %s compatibility independently of a failed run", (status) => {
    render(<SidebarPipelineLink pipeline={{ ...pipeline, status: "failed", compatibility: { ...pipeline.compatibility, status } }} href="/pipelines" active={false} />);
    const link = screen.getByRole("link");
    expect(link.querySelector(`[data-compatibility=${status}]`)).toBeTruthy();
    expect(link.querySelector("[data-run-status=failed]")).toBeTruthy();
  });

  it("omits the run icon for pipelines that have never run", () => {
    render(<SidebarPipelineLink pipeline={{ ...pipeline, status: "empty" }} href="/pipelines" active={false} />);
    const link = screen.getByRole("link");
    expect(link.querySelector("[data-run-status]")).toBeNull();
    expect(link.getAttribute("aria-current")).toBeNull();
  });
});
