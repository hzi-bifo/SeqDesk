// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchImportsClient } from "./WorkbenchImportsClient";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function storeItem(status = "installed", extra: Record<string, unknown> = {}) {
  return {
    id: "ncbi-datasets-cli",
    label: "NCBI Datasets CLI",
    description: "Server-side NCBI datasets/dataformat tools used by reference genome importers.",
    category: "Import tools",
    kind: "tool",
    usedBy: ["ncbi-genomes-taxon"],
    commands: ["datasets", "dataformat", "unzip"],
    install: {
      method: "conda",
      packages: ["ncbi-datasets-cli", "unzip"],
      channels: ["conda-forge"],
      autoSetup: true,
    },
    status: {
      state: status,
      source: status === "installed" ? "managed" : undefined,
      message: status === "installed" ? "Installed by SeqDesk Store" : "Not installed",
      details: status === "installed" ? "Managed prefix: /data/workbench/tools/ncbi" : undefined,
    },
    installJob: null,
    ...extra,
  };
}

describe("WorkbenchImportsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows the SRA-themed loading preview and recovers visibly from lookup errors", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => input.toString().endsWith("/preview") ? pending : jsonResponse({ jobs: [], importers: [] })));
    render(<WorkbenchImportsClient source="sra" enablePolling={false} />);
    const preview = screen.getByRole("region", { name: "SRA file preview" });
    expect(screen.getByRole("heading", { name: "SRA / ENA import module" }).closest("header")?.className).toContain("bg-sky-50");
    expect(screen.getByRole("button", { name: "Import sequencing data" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Accession"), { target: { value: "ERR164407" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview files" }));
    expect(preview.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Looking up archive files…")).toBeTruthy();
    expect(preview.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
    await act(async () => resolve(jsonResponse({ error: "Internal lookup unavailable" }, { status: 503 })));
    expect(preview.getAttribute("aria-busy")).toBe("false");
    expect(screen.queryByText("Looking up archive files…")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Internal lookup unavailable");
    expect(screen.getByRole("button", { name: "Import sequencing data" }).hasAttribute("disabled")).toBe(true);
  });
  it.each(["cami", "sra"] as const)("does not show job history or an empty jobs panel when choosing %s", async source => {
    const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Controls" };
    const provider = source === "cami" ? "cami-benchmark" : "ena-fastq-accession";
    const api = vi.fn(async (input: RequestInfo | URL) => jsonResponse(input.toString().startsWith("/api/workbench/imports") ? { jobs: [
      { id: "completed-here", providerId: provider, status: "success", request: { collection }, phase: "past-result" },
      { id: "unrelated-running", providerId: provider, status: "running", request: { collection: { key: "other" } }, phase: "unrelated-transfer" },
      { id: "another-module", providerId: "different-module", status: "running", request: { collection }, phase: "other-module-transfer" },
      { id: "legacy-job", providerId: provider, status: "running", request: null, phase: "legacy-transfer" },
    ] } : { importers: [] }));
    vi.stubGlobal("fetch", api);
    render(<WorkbenchImportsClient source={source} collection={collection} enablePolling={false} />);
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/api/workbench/imports?collection=${collection.key}`, { cache: "no-store" }));
    expect(screen.queryByRole("heading", { name: "Import jobs" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Import progress" })).toBeNull();
    expect(screen.queryByText("No import jobs yet.")).toBeNull();
    expect(screen.queryByText(/unrelated-transfer|past-result|other-module-transfer|legacy-transfer/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Stop download|Cancel queued import/ })).toBeNull();
  });
  it.each(["cami", "sra"] as const)("recovers only active progress for the selected %s module and collection", async source => {
    const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Controls" };
    let status = "running";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => jsonResponse(input.toString().startsWith("/api/workbench/imports") ? { jobs: [{
      id: "active-here", providerId: source === "cami" ? "cami-benchmark" : "ena-fastq-accession", status, phase: "downloading current selection", progress: 42,
      request: { collection }, createdAt: "2026-09-07T12:00:00Z", updatedAt: "2026-09-07T12:00:00Z",
    }] } : { importers: [] })));
    const view = render(<WorkbenchImportsClient source={source} collection={collection} enablePolling={false} />);
    expect(await screen.findByRole("heading", { name: "Import progress" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Processing" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Import jobs" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop download" })).toBeTruthy();
    status = "success";
    view.rerender(<WorkbenchImportsClient source={source} collection={collection} />);
    expect((await screen.findAllByText("success")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Import progress" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop download|Cancel queued import/ })).toBeNull();
    view.rerender(<WorkbenchImportsClient source={source} collection={{ ...collection, key: "different-collection" }} enablePolling={false} />);
    expect(screen.queryByRole("heading", { name: "Import progress" })).toBeNull();
  });

  it.each([
    ["cami", "running"], ["cami", "queued"], ["sra", "running"], ["sra", "queued"],
  ] as const)("confirms cancellation of the exact %s %s job from its progress panel", async (source, status) => {
    const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Controls" };
    const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse({ success: true });
      return jsonResponse(input.toString().startsWith("/api/workbench/imports") ? { jobs: [{
        id: "selected-job", providerId: source === "cami" ? "cami-benchmark" : "ena-fastq-accession", status,
        phase: status === "running" ? "Downloading · 16.2%" : "queued", request: { collection },
        createdAt: "2026-09-09T12:46:00Z", updatedAt: "2026-09-09T12:46:00Z",
      }] } : { importers: [] });
    });
    vi.stubGlobal("fetch", api);
    render(<WorkbenchImportsClient source={source} collection={collection} enablePolling={false} />);
    const panel = within(await screen.findByRole("region", { name: "Import progress" }));
    const action = status === "running" ? "Stop download" : "Cancel queued import";
    fireEvent.click(panel.getByRole("button", { name: action }));
    expect(panel.getByText(/Partial files will be removed/)).toBeTruthy();
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    fireEvent.click(panel.getByRole("button", { name: status === "running" ? "Keep downloading" : "Keep queued" }));
    expect(panel.queryByRole("button", { name: "Confirm cancellation" })).toBeNull();
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    fireEvent.click(panel.getByRole("button", { name: action }));
    fireEvent.click(panel.getByRole("button", { name: "Confirm cancellation" }));
    await panel.findByText(status === "running" ? "Stopping…" : "Cancellation requested");
    expect(api.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([
      ["/api/workbench/imports/selected-job/cancel", { method: "POST" }],
    ]);
    expect(panel.queryByRole("button", { name: action })).toBeNull();
  });

  it("does not offer another stop or claim normal downloading when a recovered job is cancelling", async () => {
    const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Controls" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => jsonResponse(input.toString().startsWith("/api/workbench/imports") ? { jobs: [{
      id: "stopping-job", providerId: "cami-benchmark", status: "running", phase: "cancelling", request: { collection },
      createdAt: "2026-09-09T12:46:00Z", updatedAt: "2026-09-09T12:46:00Z",
    }] } : { importers: [] })));
    render(<WorkbenchImportsClient source="cami" collection={collection} enablePolling={false} />);
    const panel = within(await screen.findByRole("region", { name: "Import progress" }));
    expect(panel.getByText("Stopping…")).toBeTruthy();
    expect(panel.getByText("Cancellation requested. Waiting for the worker to stop.")).toBeTruthy();
    expect(panel.queryByText("Import continues in the background")).toBeNull();
    expect(panel.queryByRole("button")).toBeNull();
  });

  it("loads imports once without arming the refresh timer when polling is disabled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/workbench/importers") return jsonResponse({ importers: [] });
      if (url.startsWith("/api/workbench/imports")) return jsonResponse({ jobs: [] });
      if (url === "/api/workbench/store") return jsonResponse({ items: [] });
      return jsonResponse({}, { status: 404 });
    });
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchImportsClient enablePolling={false} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(intervalSpy.mock.calls.filter(([, delay]) => delay === 5000)).toHaveLength(0);
  });
  it("shows the named sequencing-data result without a bogus study link", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => jsonResponse(input.toString().startsWith("/api/workbench/imports") ? { jobs: [{
      id: "local-completed", providerId: "ena-fastq-accession", status: "success", phase: "complete", progress: 100, error: null, resultDatasetId: "local-dataset",
      createdAt: "2026-09-07T12:00:00Z", updatedAt: "2026-09-07T12:00:00Z",
      scientificRecords: { orderId: "local-data", orderTitle: "Public marine controls", sampleId: "local-sample", sampleTitle: "Sample", studyId: null, studyTitle: null },
    }] } : { importers: [] })));
    render(<WorkbenchImportsClient source="jobs" enablePolling={false} />);
    expect((await screen.findByRole("link", { name: "Public marine controls — open sequencing data" })).getAttribute("href")).toBe("/orders/local-data");
    expect(screen.getByRole("link", { name: "Link samples to a study later" }).getAttribute("href")).toBe("/studies");
    expect(screen.queryByRole("link", { name: /open study/ })).toBeNull();
  });

  it("sends the named collection with preview and start requests to the SeqDesk API", async () => {
    const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Public controls" };
    let started = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/workbench/importers") {
        return jsonResponse({
          importers: [
            {
              id: "ena-fastq-accession",
              label: "ENA FASTQ by accession",
              description: "Download public FASTQ files.",
              category: "Public sequencing reads",
              preflight: { ok: true },
            },
          ],
        });
      }
      if (url.startsWith("/api/workbench/imports") && init?.method === "POST") {
        started = true;
        return jsonResponse({ job: { id: "job-ena", status: "queued" } }, { status: 202 });
      }
      if (url.startsWith("/api/workbench/imports")) return jsonResponse({ jobs: started ? [{
        id: "job-ena", providerId: "ena-fastq-accession", status: "success", phase: "complete", progress: 100, request: { collection },
        createdAt: "2026-09-07T12:00:00Z", updatedAt: "2026-09-07T12:00:00Z",
        scientificRecords: { orderId: "new-import", orderTitle: collection.name, sampleId: "sample", studyId: null, studyTitle: null },
      }] : [] });
      if (url === "/api/workbench/store") return jsonResponse({ items: [] });
      if (url === "/api/workbench/importers/ena-fastq-accession/preview") {
        return jsonResponse({
          preview: {
            fingerprint: "internal-preview-fingerprint",
            summary: {
              label: "ENA FASTQ ERR164407",
              totalFound: 2,
              selectedCount: 2,
              capped: false,
              cap: 20,
              hardMax: 100,
            },
            files: [
              {
                runAccession: "ERR164407",
                scientificName: "Escherichia coli",
                libraryLayout: "PAIRED",
                filename: "ERR164407_1.fastq.gz",
                bytes: 1024,
              },
              {
                runAccession: "ERR164407",
                scientificName: "Escherichia coli",
                libraryLayout: "PAIRED",
                filename: "ERR164407_2.fastq.gz",
                bytes: 1024,
              },
            ],
          },
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchImportsClient source="sra" enablePolling={false} collection={collection} />);

    await screen.findByText("SRA / ENA import module");
    expect(screen.queryByRole("heading", { name: "Import progress" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/ERR…/i), {
      target: { value: "err164407" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview files/i }));

    expect(await screen.findByText("2 FASTQ file(s) selected")).toBeTruthy();
    expect(screen.getByText("ERR164407_1.fastq.gz")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Import sequencing data/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workbench/imports",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            providerId: "ena-fastq-accession",
            input: { accession: "ERR164407", maxFiles: 20, collection },
            previewFingerprint: "internal-preview-fingerprint",
          }),
        })
      )
    );
    expect(await screen.findByRole("link", { name: "Public controls — open sequencing data" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Import progress" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Import jobs" })).toBeNull();
  });

  it("keeps imports empty by default, then opens installed Reference genomes from the Store", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/workbench/importers") {
        return jsonResponse({
          importers: [
            {
              id: "ncbi-genomes-taxon",
              label: "NCBI Genomes by Taxon",
              description: "Preview and import capped NCBI genome FASTA packages for a taxon.",
              category: "Reference genomes",
              preflight: { ok: true },
            },
          ],
        });
      }
      if (url.startsWith("/api/workbench/imports")) {
        return jsonResponse({
          jobs: [
            {
              id: "job-1",
              providerId: "ncbi-genomes-taxon",
              status: "running",
              phase: "downloading",
              progress: 10,
              error: null,
              resultDatasetId: null,
              createdAt: "2026-05-20T10:00:00.000Z",
              updatedAt: "2026-05-20T10:00:00.000Z",
            },
            {
              id: "job-2",
              providerId: "ncbi-genomes-taxon",
              status: "success",
              phase: "complete",
              progress: 100,
              error: null,
              resultDatasetId: "dataset-1",
              createdAt: "2026-05-20T10:01:00.000Z",
              updatedAt: "2026-05-20T10:01:00.000Z",
            },
            {
              id: "job-3",
              providerId: "ncbi-genomes-taxon",
              status: "error",
              phase: "failed",
              progress: 20,
              error: "NCBI request failed",
              resultDatasetId: null,
              createdAt: "2026-05-20T10:02:00.000Z",
              updatedAt: "2026-05-20T10:02:00.000Z",
            },
            {
              id: "job-4",
              providerId: "ncbi-genomes-taxon",
              status: "queued",
              phase: "queued",
              progress: 0,
              error: null,
              resultDatasetId: null,
              createdAt: "2026-05-20T10:03:00.000Z",
              updatedAt: "2026-05-20T10:03:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/workbench/store") {
        return jsonResponse({ items: [storeItem("installed")] });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchImportsClient />);

    expect(await screen.findByText("ENA FASTQ by accession")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Preview files/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Store$/i }));
    expect(await screen.findByRole("button", { name: /Open importer/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open importer/i }));

    expect(await screen.findByText("NCBI Genomes by Taxon")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Preview$/i }).hasAttribute("disabled")).toBe(
      false
    );
    expect(screen.getByText("Import jobs")).toBeTruthy();
    expect(screen.getByText("downloading")).toBeTruthy();
    expect(screen.getByText("Ready — files validated")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getAllByText("queued").length).toBeGreaterThan(0);
    expect(screen.getByText("NCBI request failed")).toBeTruthy();
  });

  it("shows setup state in the Store without exposing the importer form", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/workbench/importers") {
        return jsonResponse({
          importers: [
            {
              id: "ncbi-genomes-taxon",
              label: "NCBI Genomes by Taxon",
              description: "Preview and import capped NCBI genome FASTA packages for a taxon.",
              category: "Reference genomes",
              preflight: {
                ok: false,
                message: "NCBI Datasets CLI is not installed",
                details: "Install the `datasets` command on the SeqDesk server.",
              },
            },
          ],
        });
      }
      if (url.startsWith("/api/workbench/imports")) {
        return jsonResponse({ jobs: [] });
      }
      if (url === "/api/workbench/store") {
        return jsonResponse({
          items: [
            storeItem("setup-needed", {
              status: {
                state: "setup-needed",
                message: "Conda is required for managed setup",
                details: "Configure Conda in Admin > Pipeline Runtime.",
              },
            }),
          ],
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchImportsClient />);

    expect(await screen.findByText("ENA FASTQ by accession")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Store$/i }));

    expect((await screen.findAllByText("Setup needed")).length).toBeGreaterThan(0);
    expect(screen.getByText("Conda is required for managed setup")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Setup needed/i }).hasAttribute("disabled")).toBe(
      true
    );
    expect(screen.queryByRole("button", { name: /^Preview$/i })).toBeNull();
  });

  it("starts Store installation for Reference genomes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/workbench/importers") {
        return jsonResponse({
          importers: [
            {
              id: "ncbi-genomes-taxon",
              label: "NCBI Genomes by Taxon",
              description: "Preview and import capped NCBI genome FASTA packages for a taxon.",
              category: "Reference genomes",
              preflight: { ok: false },
            },
          ],
        });
      }
      if (url.startsWith("/api/workbench/imports")) {
        return jsonResponse({ jobs: [] });
      }
      if (url === "/api/workbench/store") {
        return jsonResponse({ items: [storeItem("missing")] });
      }
      if (url === "/api/workbench/store/ncbi-datasets-cli/install" && init?.method === "POST") {
        return jsonResponse(
          {
            job: {
              itemId: "ncbi-datasets-cli",
              state: "running",
              startedAt: "2026-05-20T10:00:00.000Z",
            },
          },
          { status: 202 }
        );
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchImportsClient />);

    expect(await screen.findByText("ENA FASTQ by accession")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Store$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Install$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workbench/store/ncbi-datasets-cli/install", {
        method: "POST",
      })
    );
  });
});
