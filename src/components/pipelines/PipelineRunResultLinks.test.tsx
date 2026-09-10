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

  it("offers a separate download for the Nextflow execution report", () => {
    const report: PipelineRunResultFile = { ...primary, name: "Nextflow report", path: "/runs/run-1/report.html", source: "technical" };
    render(<PipelineRunResultLinks runId="run-1" status="completed" resultFiles={[report]} />);
    expect(screen.getByRole("link", { name: "Nextflow report", exact: true }).getAttribute("href")).toContain("/api/files/preview?");
    const download = screen.getByRole("link", { name: "Download Nextflow report" });
    expect(download.getAttribute("href")).toBe("/api/pipelines/runs/run-1/file?path=%2Fruns%2Frun-1%2Freport.html&download=1");
    expect(download.hasAttribute("download")).toBe(true);
  });

  it("keeps report previews but hides downloads in the demo", () => {
    render(<PipelineRunResultLinks runId="run-1" downloadsDisabled status="completed" resultFiles={[primary]} />);
    expect(screen.getByRole("link", { name: "Combined Report", exact: true })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Download/ })).toBeNull();
  });

  it("downloads additional reports and archives from More files", async () => {
    const table = { ...primary, id: "table", name: "Quality summary", path: "/runs/run-1/quality.tsv" };
    const archive = { ...primary, id: "zip", name: "FastQC archive", path: "/runs/run-1/fastqc.zip", previewable: false };
    render(<PipelineRunResultLinks runId="run-1" status="completed" resultFiles={[primary, table, archive]} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "More files" }), { key: "Enter" });
    for (const file of [table, archive]) {
      const download = await screen.findByRole("menuitem", { name: `Download ${file.name}` });
      expect(download.getAttribute("href")).toBe(`/api/pipelines/runs/run-1/file?path=${encodeURIComponent(file.path)}&download=1`);
      expect(download.hasAttribute("download")).toBe(true);
    }
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
