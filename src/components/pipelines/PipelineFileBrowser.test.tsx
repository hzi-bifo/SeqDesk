// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineFileBrowser } from "./PipelineFileBrowser";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({
    children,
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className} data-slot="dialog-content" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({
    children,
    className,
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
  ),
  DialogTitle: ({
    children,
    className,
  }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className={className}>{children}</h2>
  ),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => (
    <button type="button" data-value={value}>
      {children}
    </button>
  ),
  SelectTrigger: ({
    children,
    className,
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
  ),
  SelectValue: () => <span />,
}));

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

describe("PipelineFileBrowser", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps long CSV previews inside a viewport-bounded dialog", async () => {
    const longReadPath =
      "/net/broker/devphil/seqdesk_data/fixtures/dev/gemma-nanopore-metaxpath-5sample/reads/S10.nanofilt.porechop.subset5000.fastq";
    const csvPreview = [
      "sample,long_reads,sequencer,group",
      `S10,${longReadPath},Nanopore,cmp44jnk800011ynbxrhxwcwv`,
    ].join("\n");
    const fetchMock = vi.fn(async () => jsonResponse({ content: csvPreview, truncated: false }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PipelineFileBrowser
        inputFiles={[]}
        outputFiles={[
          {
            id: "samplesheet",
            name: "samplesheet.csv",
            path: "/net/broker/devphil/pipeline/METAXPATH-20260520-001/samplesheet.csv",
            type: "samplesheet",
            size: 848,
          },
        ]}
        runId="run-1"
        runFolder="/net/broker/devphil/pipeline/METAXPATH-20260520-001"
      />
    );

    fireEvent.click(screen.getByText("samplesheet.csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const dialog = screen.getByTestId("pipeline-file-preview-dialog");
    expect(dialog.className).toContain("max-h-[90vh]");
    expect(dialog.className).toContain("w-[min(96vw,80rem)]");
    expect(dialog.className).toContain("overflow-hidden");

    const previewPane = screen.getByTestId("pipeline-file-preview-pane");
    expect(previewPane.className).toContain("max-h-[60vh]");
    expect(previewPane.className).toContain("max-w-full");
    expect(previewPane.className).toContain("overflow-auto");

    const delimitedPreview = await screen.findByTestId("pipeline-delimited-preview");
    expect(delimitedPreview.className).toContain("max-w-full");
    expect(delimitedPreview.className).toContain("overflow-auto");

    const longPathCell = screen.getByText(longReadPath).closest("td");
    expect(longPathCell?.className).toContain("max-w-[18rem]");
    expect(longPathCell?.className).toContain("break-all");
    expect(longPathCell?.className).toContain("whitespace-normal");
  });

  it("renders PDF inline previews with an unsandboxed object", () => {
    const pdfPath =
      "/net/broker/devphil/pipeline/METAXPATH-20260520-001/output/run_20260520/final/flye/metaxpath.combined_report.simple.dotplot.pdf";
    const expectedUrl = `/api/pipelines/runs/run-1/file?path=${encodeURIComponent(pdfPath)}&inline=1`;

    render(
      <PipelineFileBrowser
        inputFiles={[]}
        outputFiles={[
          {
            id: "dotplot",
            name: "metaxpath.combined_report.simple.dotplot.pdf",
            path: pdfPath,
            type: "report",
            size: 8600,
          },
        ]}
        runId="run-1"
        runFolder="/net/broker/devphil/pipeline/METAXPATH-20260520-001"
      />
    );

    fireEvent.click(screen.getByText("metaxpath.combined_report.simple.dotplot.pdf"));

    const pdfPreview = screen.getByTestId("pipeline-pdf-preview");
    expect(pdfPreview.tagName).toBe("OBJECT");
    expect(pdfPreview.getAttribute("type")).toBe("application/pdf");
    expect(pdfPreview.getAttribute("data")).toBe(expectedUrl);
    expect(screen.queryByTestId("pipeline-html-preview")).toBeNull();
  });

  it("keeps HTML inline previews in a sandboxed iframe", () => {
    const htmlPath =
      "/net/broker/devphil/pipeline/METAXPATH-20260520-001/report.html";
    const expectedUrl = `/api/pipelines/runs/run-1/file?path=${encodeURIComponent(htmlPath)}&inline=1`;

    render(
      <PipelineFileBrowser
        inputFiles={[]}
        outputFiles={[
          {
            id: "report",
            name: "report.html",
            path: htmlPath,
            type: "report",
            size: 2048,
          },
        ]}
        runId="run-1"
        runFolder="/net/broker/devphil/pipeline/METAXPATH-20260520-001"
      />
    );

    fireEvent.click(screen.getByText("report.html"));

    const htmlPreview = screen.getByTestId("pipeline-html-preview");
    expect(htmlPreview.tagName).toBe("IFRAME");
    expect(htmlPreview.getAttribute("src")).toBe(expectedUrl);
    expect(htmlPreview.getAttribute("sandbox")).toBe("allow-downloads allow-popups");
    expect(screen.queryByTestId("pipeline-pdf-preview")).toBeNull();
  });
});
