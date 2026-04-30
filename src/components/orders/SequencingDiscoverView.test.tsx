// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    message: mocks.toastMessage,
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { SequencingDiscoverView } from "./SequencingDiscoverView";

const storageFiles = [
  {
    relativePath: "run-a/SAMPLE_A_R1.fastq.gz",
    filename: "SAMPLE_A_R1.fastq.gz",
    size: 1_048_576,
    modifiedAt: "2026-04-01T10:00:00.000Z",
  },
  {
    relativePath: "run-a/SAMPLE_A_R2.fastq.gz",
    filename: "SAMPLE_A_R2.fastq.gz",
    size: 1_048_576,
    modifiedAt: "2026-04-01T10:01:00.000Z",
  },
  {
    relativePath: "shared/OTHER_R1.fastq.gz",
    filename: "OTHER_R1.fastq.gz",
    size: 512,
    modifiedAt: "2026-03-30T10:00:00.000Z",
    assignedTo: {
      sampleId: "OTHER",
      orderId: "order-other",
      orderName: "Other order",
      role: "R1",
    },
  },
];

const discoveryResults = [
  {
    sampleId: "SAMPLE_A",
    suggestion: {
      status: "exact",
      read1: storageFiles[0],
      read2: storageFiles[1],
      alternatives: [],
    },
  },
  {
    sampleId: "SAMPLE_B",
    suggestion: {
      status: "none",
      read1: null,
      read2: null,
      alternatives: [],
    },
  },
];

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

describe("SequencingDiscoverView", () => {
  const fetchMock = vi.fn();
  const onDataChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/browse")) {
        return Promise.resolve(jsonResponse({ files: storageFiles }));
      }
      if (url.includes("/discover")) {
        expect(init?.method).toBe("POST");
        return Promise.resolve(
          jsonResponse({
            results: discoveryResults,
            scannedFiles: 3,
            summary: { exactMatches: 1 },
          })
        );
      }
      if (url.includes("/sequencing/reads")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("discovers, links, manually assigns, filters, and unlinks read files", async () => {
    render(
      <SequencingDiscoverView
        orderId="order-1"
        canManage
        dataBasePathConfigured
        onDataChanged={onDataChanged}
        samples={[
          {
            id: "sample-a",
            sampleId: "SAMPLE_A",
            sampleAlias: "Alpha",
            read: {
              id: "read-a",
              file1: "run-a/SAMPLE_A_R1.fastq.gz",
              file2: null,
            },
          },
          {
            id: "sample-b",
            sampleId: "SAMPLE_B",
            sampleAlias: null,
            read: null,
          },
        ] as any}
      />
    );

    expect(await screen.findByText("Storage Files")).toBeTruthy();
    expect((await screen.findAllByText("SAMPLE_A_R1.fastq.gz")).length).toBeGreaterThan(1);
    expect(screen.getByText("3 files")).toBeTruthy();
    expect(screen.getByText("2.0 MB total")).toBeTruthy();
    expect(screen.getByText("1 paired-end sample")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Auto-Discover/i }));

    expect(await screen.findByText("Discovery Results")).toBeTruthy();
    expect(screen.getByText("1 exact, 0 partial, 1 no match")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalledTimes(1);
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Linked reads for SAMPLE_A");

    fireEvent.click(screen.getByTitle("Unlink R1"));
    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Unlinked R1 for SAMPLE_A");
    });

    const selectButtons = screen.getAllByRole("button", { name: /Select file/i });
    fireEvent.click(selectButtons[1]);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Select R1 for SAMPLE_B")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /SAMPLE_A_R2.fastq.gz/i }).at(-1)!);

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Assigned R1 for SAMPLE_B");
    });

    fireEvent.change(screen.getByPlaceholderText("Filter files..."), {
      target: { value: "does-not-exist" },
    });
    expect(screen.getByText("No files match your search.")).toBeTruthy();

    const readAssignments = fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/sequencing/reads"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(readAssignments).toContainEqual({
      assignments: [
        {
          sampleId: "sample-a",
          read1: "run-a/SAMPLE_A_R1.fastq.gz",
          read2: "run-a/SAMPLE_A_R2.fastq.gz",
        },
      ],
    });
    expect(readAssignments).toContainEqual({
      assignments: [{ sampleId: "sample-a", read1: null, read2: null }],
    });
    expect(readAssignments).toContainEqual({
      assignments: [
        {
          sampleId: "sample-b",
          read1: "run-a/SAMPLE_A_R2.fastq.gz",
          read2: null,
        },
      ],
    });
  });
});
