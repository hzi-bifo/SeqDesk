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
});
