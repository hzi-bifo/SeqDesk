// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PipelineRunResultLinks } from "./PipelineRunResultLinks";
import type { PipelineRunResultFile } from "@/lib/pipelines/result-files";

const primary: PipelineRunResultFile = {
  id: "report-1",
  name: "Combined Report",
  path: "/runs/run-1/output/combined.html",
  type: "report",
  outputId: "combined_report_html",
  source: "artifact",
  size: 1234,
  previewable: true,
};

describe("PipelineRunResultLinks", () => {
  it("shows the primary report link for completed runs", () => {
    render(
      <PipelineRunResultLinks
        status="completed"
        resultFiles={[primary]}
        primaryResultFile={primary}
      />
    );

    const link = screen.getByRole("link", { name: /combined report/i });
    expect(link.getAttribute("href")).toBe(
      "/api/files/preview?path=%2Fruns%2Frun-1%2Foutput%2Fcombined.html"
    );
  });

  it("keeps failed or running rows empty", () => {
    render(
      <PipelineRunResultLinks
        status="running"
        resultFiles={[primary]}
        primaryResultFile={primary}
      />
    );

    expect(screen.getByText("-")).toBeTruthy();
  });

  it("opens a files menu for additional result files", async () => {
    const dotplot: PipelineRunResultFile = {
      id: "dotplot-1",
      name: "Dotplot",
      path: "/runs/run-1/output/dotplot.pdf",
      type: "report",
      outputId: "dotplots",
      source: "artifact",
      size: 2048,
      previewable: true,
    };

    render(
      <PipelineRunResultLinks
        status="completed"
        resultFiles={[primary, dotplot]}
        primaryResultFile={primary}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /additional result files/i }));

    const link = (await screen.findByText("Dotplot")).closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/api/files/preview?path=%2Fruns%2Frun-1%2Foutput%2Fdotplot.pdf"
    );
  });

  it("explains omitted per-sample files without adding run-table links", () => {
    render(
      <PipelineRunResultLinks
        status="completed"
        resultFiles={[]}
        primaryResultFile={null}
        omittedSampleFileCount={24}
      />
    );

    expect(screen.getByText("Per-sample outputs")).toBeTruthy();
  });
});
