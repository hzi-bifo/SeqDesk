// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(cleanup);
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
    expect(screen.queryByRole("button", { name: "More files" })).toBeNull();
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

    const more = screen.getByRole("button", { name: "More files" });
    expect(more.textContent).toBe("More files");
    fireEvent.keyDown(more, { key: "Enter" });

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

  it("explains omitted files without a misleading zero-files button", async () => {
    render(<PipelineRunResultLinks status="completed" resultFiles={[primary]} omittedCount={2} omittedSampleFileCount={4} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "More files" }), { key: "Enter" });
    expect(await screen.findByText(/2 additional run files omitted/)).toBeTruthy();
    expect(screen.getByText(/4 per-sample files kept in sample previews/)).toBeTruthy();
    expect(screen.queryByText(/0 additional/)).toBeNull();
  });

  it("opens More files without triggering its parent run row, and keeps non-previewable files non-clickable", async () => {
    const parentClick = vi.fn();
    const archive: PipelineRunResultFile = { ...primary, id: "archive", name: "Analysis archive", path: "/runs/run-1/output/archive.tar.gz", previewable: false };
    render(<div onClick={parentClick}><PipelineRunResultLinks status="completed" resultFiles={[primary, archive]} /></div>);
    const more = screen.getByRole("button", { name: "More files" });
    fireEvent.click(more);
    expect(parentClick).not.toHaveBeenCalled();
    fireEvent.keyDown(more, { key: "Enter" });
    const menuItem = await screen.findByRole("menuitem", { name: /Analysis archive/ });
    expect(menuItem.getAttribute("aria-disabled")).toBe("true");
    expect(menuItem.closest("a")).toBeNull();
  });
});
