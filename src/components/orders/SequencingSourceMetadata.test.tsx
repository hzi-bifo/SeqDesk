// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SequencingSourceMetadata } from "./SequencingSourceMetadata";

afterEach(cleanup);

describe("SequencingSourceMetadata", () => {
  it("explains an empty collection without inventing a source", () => {
    render(<SequencingSourceMetadata order={{ id: "collection", dataOrigin: "import", samples: [] }} />);
    expect(screen.getByText(/No data source recorded yet/)).toBeTruthy();
    expect(screen.queryByText("CAMI benchmark reads")).toBeNull();
    expect(screen.getByRole("link", { name: "View files and import progress" }).getAttribute("href")).toBe("/orders/collection/samples-files");
  });

  it("keeps pending metadata distinct and updates when imported records arrive", () => {
    const { rerender } = render(<SequencingSourceMetadata order={{ id: "collection", dataOrigin: "import", samples: [], sourceImports: [{
      id: "job", providerId: "cami-benchmark", status: "running", sourceKey: "cami2-marine", title: "CAMI II Marine", createdAt: "2026-09-08T10:00:00Z", metadata: {},
    }] }} />);
    expect(screen.getByText("1 import pending")).toBeTruthy();
    expect(screen.queryByText(/1 sample ·/)).toBeNull();
    rerender(<SequencingSourceMetadata order={{ id: "collection", dataOrigin: "import", samples: [{
      id: "sample", sampleId: "sample_0", reads: [{ id: "read", file1: "R1.fastq.gz", file2: "R2.fastq.gz", pipelineSources: JSON.stringify({ sourceType: "cami-benchmark", dataset: "cami2-marine", synthetic: true }) }],
    }] }} />);
    expect(screen.queryByText("1 import pending")).toBeNull();
    expect(screen.getByText("1 sample · 1 read set")).toBeTruthy();
    expect(screen.getByText("Processing unknown")).toBeTruthy();
    expect(screen.getByText("Synthetic benchmark")).toBeTruthy();
  });

  it("shows original metadata on demand as escaped text, with safe external links", async () => {
    render(<SequencingSourceMetadata order={{ id: "collection", dataOrigin: "import", samples: [{
      id: "sample", sampleId: "sample_0", reads: [{ id: "read", file1: "reads.fastq", pipelineSources: JSON.stringify({
        sourceType: "cami-benchmark", dataset: "cami2-marine", sourcePage: "https://cami-challenge.org/datasets/marine/",
        citation: "javascript:alert(1)", customSourceField: "<script>untrusted()</script>",
      }) }],
    }] }} />);
    expect(screen.getByRole("link", { name: "Source dataset" }).getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("link", { name: "Citation" })).toBeNull();
    const details = screen.getByText("Sample provenance (1)").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const original = await screen.findByText("Original source metadata");
    original.closest("details")!.open = true;
    fireEvent(original.closest("details")!, new Event("toggle"));
    await waitFor(() => expect(document.querySelector("pre")?.textContent).toContain("<script>untrusted()</script>"));
    expect(document.querySelector("script")).toBeNull();
  });

  it("identifies the facility path without calling it a downloaded import", () => {
    render(<SequencingSourceMetadata order={{ id: "facility", dataOrigin: "facility", samples: [] }} />);
    expect(screen.getByRole("heading", { name: "Facility sequencing" })).toBeTruthy();
    expect(screen.getByText("Facility module")).toBeTruthy();
    expect(screen.queryByText("Import module")).toBeNull();
  });
});
