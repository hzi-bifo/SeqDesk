// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("loads imports once without arming the refresh timer when polling is disabled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/workbench/importers") return jsonResponse({ importers: [] });
      if (url === "/api/workbench/imports") return jsonResponse({ jobs: [] });
      if (url === "/api/workbench/store") return jsonResponse({ items: [] });
      return jsonResponse({}, { status: 404 });
    });
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchImportsClient enablePolling={false} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(intervalSpy.mock.calls.filter(([, delay]) => delay === 5000)).toHaveLength(0);
  });

  it("previews and starts a real ENA accession import", async () => {
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
      if (url === "/api/workbench/imports" && init?.method === "POST") {
        return jsonResponse({ job: { id: "job-ena", status: "queued" } }, { status: 202 });
      }
      if (url === "/api/workbench/imports") return jsonResponse({ jobs: [] });
      if (url === "/api/workbench/store") return jsonResponse({ items: [] });
      if (url === "/api/workbench/importers/ena-fastq-accession/preview") {
        return jsonResponse({
          preview: {
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

    render(<WorkbenchImportsClient enablePolling={false} />);

    await screen.findByText("ENA FASTQ by accession");
    fireEvent.change(screen.getByPlaceholderText(/ERR…/i), {
      target: { value: "err164407" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview files/i }));

    expect(await screen.findByText("2 FASTQ file(s) selected")).toBeTruthy();
    expect(screen.getByText("ERR164407_1.fastq.gz")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download to workspace/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workbench/imports",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            providerId: "ena-fastq-accession",
            input: { accession: "ERR164407", maxFiles: 20 },
          }),
        })
      )
    );
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
      if (url === "/api/workbench/imports") {
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
    expect(screen.getByText(/downloading.*10%/)).toBeTruthy();
    expect(screen.getByText(/complete.*100%/)).toBeTruthy();
    expect(screen.getByText(/failed.*20%/)).toBeTruthy();
    expect(screen.getByText(/queued.*0%/)).toBeTruthy();
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
      if (url === "/api/workbench/imports") {
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
      if (url === "/api/workbench/imports") {
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
