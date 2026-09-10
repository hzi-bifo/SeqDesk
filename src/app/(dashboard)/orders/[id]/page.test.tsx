// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React, { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  startVisiblePolling: vi.fn(),
  stopPolling: vi.fn(),
  router: {
    replace: vi.fn(),
    push: vi.fn(),
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: mocks.useSession,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/polling", () => ({ startVisiblePolling: mocks.startVisiblePolling }));

import OrderDetailPage from "./page";
import { DEFAULT_GROUPS, DEFAULT_SYSTEM_FIELDS, type FormFieldDefinition, type FormFieldGroup } from "@/types/form-config";
import type { SourceMetadataOrder } from "@/lib/orders/source-metadata";

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  } as Response;
}

const orderPayload = {
  id: "order-1",
  name: "Visible Results Order",
  status: "SUBMITTED",
  statusUpdatedAt: "2026-05-20T10:00:00.000Z",
  createdAt: "2026-05-20T09:00:00.000Z",
  numberOfSamples: 1,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  billingAddress: null,
  platform: null,
  instrumentModel: null,
  librarySelection: null,
  libraryStrategy: null,
  librarySource: null,
  customFields: null,
  sequencingFilesPublishedAt: null,
  sequencingFilesPublishedById: null,
  user: {
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    email: "user@example.com",
    department: null,
  },
  samples: [],
  statusNotes: [],
  _count: { samples: 0 },
};

const sequencingDeliveryPayload = {
  orderId: "order-1",
  orderName: "Visible Results Order",
  isPublished: true,
  publishedAt: "2026-05-21T10:00:00.000Z",
  publishedBy: null,
  dataBasePathConfigured: true,
  readFiles: [
    {
      id: "read-1:R1",
      kind: "read",
      label: "S1 R1",
      path: "reads/S1_R1.fastq",
      fileName: "S1_R1.fastq",
      sampleId: "sample-1",
      sampleCode: "S1",
      sampleTitle: "Sample One",
      size: 1000,
      checksum: null,
      readId: "read-1",
      readDirection: "R1",
      readCount: 42,
    },
  ],
  artifactFiles: [
    {
      id: "artifact-1",
      kind: "artifact",
      label: "customer-report.html",
      path: "reports/customer-report.html",
      fileName: "customer-report.html",
      sampleId: null,
      sampleCode: null,
      sampleTitle: null,
      size: 2000,
      checksum: null,
      artifactId: "artifact-1",
      stage: "qc",
      artifactType: "qc_report",
    },
  ],
  excluded: {
    missingCleanedReadFiles: 0,
    rawOrUnknownReadFiles: 1,
    missingCustomerArtifacts: 0,
    unsupportedCustomerArtifacts: 0,
    facilityArtifacts: 1,
  },
};

const publishedRun = {
  id: "run-1",
  runNumber: "RUN-2026-001",
  pipelineId: "simulate-reads",
  pipelineName: "Simulate Reads",
  status: "completed",
  runFolder: "/runs/run-1",
  results: null,
  resultFiles: [
    {
      id: "artifact-1",
      name: "Combined Report",
      path: "/runs/run-1/output/combined.html",
      type: "report",
      outputId: "combined_report_html",
      source: "artifact",
      size: 1234,
      previewable: true,
    },
  ],
  primaryResultFile: {
    id: "artifact-1",
    name: "Combined Report",
    path: "/runs/run-1/output/combined.html",
    type: "report",
    outputId: "combined_report_html",
    source: "artifact",
    size: 1234,
    previewable: true,
  },
  resultFilesOmittedCount: 0,
  resultFilesOmittedSampleFileCount: 0,
  createdAt: "2026-05-20T10:00:00.000Z",
  completedAt: "2026-05-20T10:30:00.000Z",
  selectedFinal: {
    selectedAt: "2026-05-20T10:35:00.000Z",
  },
};

describe("OrderDetailPage published analysis results", () => {
  const fetchMock = vi.fn();
  let currentOrderPayload: Omit<
    typeof orderPayload,
    "sequencingFilesPublishedAt" | "sequencingFilesPublishedById" | "samples"
  > & {
    dataOrigin?: string;
    sourceImports?: SourceMetadataOrder["sourceImports"];
    samples: SourceMetadataOrder["samples"];
    sequencingFilesPublishedAt: string | null;
    sequencingFilesPublishedById: string | null;
  };
  let formSchema: {
    fields: FormFieldDefinition[];
    groups: FormFieldGroup[];
    perSampleFields: FormFieldDefinition[];
    enabledMixsChecklists: string[];
  };

  function useMetadataSchema() {
    formSchema = {
      fields: DEFAULT_SYSTEM_FIELDS.filter((field) => ["name", "numberOfSamples"].includes(field.name)),
      groups: DEFAULT_GROUPS,
      perSampleFields: [],
      enabledMixsChecklists: [],
    };
  }

  async function renderMetadataPage() {
    await act(async () => {
      render(
        <Suspense fallback={<div>Loading</div>}>
          <OrderDetailPage params={Promise.resolve({ id: "order-1" })} />
        </Suspense>
      );
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startVisiblePolling.mockReturnValue(mocks.stopPolling);
    currentOrderPayload = orderPayload;
    formSchema = { fields: [], groups: [], perSampleFields: [], enabledMixsChecklists: [] };
    mocks.useSession.mockReturnValue({
      status: "authenticated",
      data: {
        user: {
          id: "user-1",
          role: "RESEARCHER",
          isDemo: false,
        },
      },
    });
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/orders/order-1?includeSources=true") {
        return Promise.resolve(jsonResponse(currentOrderPayload));
      }
      if (url === "/api/form-schema") {
        return Promise.resolve(jsonResponse(formSchema));
      }
      if (url === "/api/pipelines/runs?orderId=order-1&publishedOnly=true&limit=50") {
        return Promise.resolve(jsonResponse({ runs: [publishedRun], total: 1 }));
      }
      if (url === "/api/orders/order-1/sequencing/delivery") {
        return Promise.resolve(jsonResponse({ delivery: sequencingDeliveryPayload }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(["facility", "import"])("uses shared metadata labels for %s data and retains zero samples", async (dataOrigin) => {
    useMetadataSchema();
    currentOrderPayload = { ...orderPayload, dataOrigin, status: "DRAFT", numberOfSamples: 0 };
    await renderMetadataPage();

    expect(await screen.findByRole("heading", { name: "Sequencing data details" })).toBeTruthy();
    expect(screen.getByText("Sequencing data name")).toBeTruthy();
    const sampleCountRow = screen.getByText("Number of Samples").parentElement!;
    expect(within(sampleCountRow).getByText("0")).toBeTruthy();
    expect(screen.queryByText("Sequencing Order Details")).toBeNull();
    expect(screen.queryByText("Sequencing Order Name")).toBeNull();
    expect(screen.getByRole("link", { name: "Sequencing data details Edit" }).getAttribute("href")).toBe(
      "/orders/order-1/edit?step=group_details"
    );
    if (dataOrigin === "import") {
      expect(screen.getByRole("link", { name: "View files and import progress" }).getAttribute("href")).toBe(
        "/orders/order-1/samples-files"
      );
    }
  });

  it("retains custom form labels on the metadata page", async () => {
    useMetadataSchema();
    formSchema.groups = formSchema.groups.map((group) => group.id === "group_details" ? { ...group, name: "Lab project information" } : group);
    formSchema.fields = formSchema.fields.map((field) => field.systemKey === "name" ? { ...field, label: "Batch name" } : field);
    currentOrderPayload = { ...orderPayload, dataOrigin: "import", status: "DRAFT" };
    await renderMetadataPage();

    expect(await screen.findByRole("heading", { name: "Lab project information" })).toBeTruthy();
    expect(screen.getByText("Batch name")).toBeTruthy();
  });

  it("describes draft deletion as sequencing data without requiring typed confirmation", async () => {
    useMetadataSchema();
    currentOrderPayload = { ...orderPayload, dataOrigin: "import", status: "DRAFT" };
    await renderMetadataPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Delete sequencing data" });
    expect(within(dialog).getByText("Are you sure you want to delete this sequencing data entry? This cannot be undone.")).toBeTruthy();
    expect(within(dialog).queryByPlaceholderText("Type DELETE to confirm")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Delete sequencing data" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
  });

  it("does not call completed imports submitted and preserves the DELETE safeguard", async () => {
    useMetadataSchema();
    currentOrderPayload = { ...orderPayload, dataOrigin: "import", status: "COMPLETED" };
    mocks.useSession.mockReturnValue({
      status: "authenticated",
      data: { user: { id: "user-1", role: "FACILITY_ADMIN", systemRole: "ADMIN" } },
    });
    await renderMetadataPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Delete sequencing data" });
    expect(dialog.textContent).not.toMatch(/submitted|sequencing order/i);
    expect(within(dialog).getByText(/no longer a draft \(status: COMPLETED\)/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Delete sequencing data" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
  });

  it("does not expose non-draft deletion to a member", async () => {
    useMetadataSchema();
    currentOrderPayload = { ...orderPayload, dataOrigin: "import", status: "COMPLETED" };
    await renderMetadataPage();
    expect(await screen.findByRole("heading", { name: "Sequencing data details" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Delete sequencing data" })).toBeNull();
  });

  it("refreshes source metadata during an import and stops polling after publication", async () => {
    useMetadataSchema();
    currentOrderPayload = { ...orderPayload, dataOrigin: "import", sourceImports: [{
      id: "job", providerId: "cami-benchmark", sourceKey: "cami2-marine", status: "running", title: "CAMI II Marine", createdAt: "2026-09-08T10:00:00Z", metadata: {},
    }] };
    await renderMetadataPage();
    expect(await screen.findByText("1 import pending")).toBeTruthy();
    expect(mocks.startVisiblePolling).toHaveBeenCalledWith(expect.any(Function), 10000);
    currentOrderPayload = { ...currentOrderPayload, sourceImports: [], _count: { samples: 1 }, samples: [{
      id: "sample", sampleId: "sample_0", reads: [{ id: "reads", file1: "R1.fastq.gz", file2: "R2.fastq.gz", pipelineSources: JSON.stringify({
        sourceType: "cami-benchmark", dataset: "cami2-marine", sampleMetadata: { environment: "marine seafloor (simulated)" },
      }) }],
    }] };
    await act(async () => { mocks.startVisiblePolling.mock.calls[0][0](); });
    expect(await screen.findByText("1 sample · 1 read set")).toBeTruthy();
    expect(screen.getByText("marine seafloor (simulated)")).toBeTruthy();
    expect(screen.queryByText("1 import pending")).toBeNull();
    expect(mocks.stopPolling).toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/orders/order-1?includeSources=true")).toHaveLength(2);
  });

  it("shows published pipeline outputs to the order owner", async () => {
    await act(async () => {
      render(
        <Suspense fallback={<div>Loading</div>}>
          <OrderDetailPage params={Promise.resolve({ id: "order-1" })} />
        </Suspense>
      );
    });

    expect(await screen.findByText("Analysis results")).toBeTruthy();
    expect(screen.getByText("Simulate Reads")).toBeTruthy();
    expect(screen.getByText("Visible to you")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Combined Report/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Download/i }).getAttribute("href")).toBe(
      "/api/pipelines/runs/run-1/file?path=%2Fruns%2Frun-1%2Foutput%2Fcombined.html&download=1"
    );
    expect(screen.getByRole("link", { name: /Inspect files/i }).getAttribute("href")).toBe(
      "/analysis/run-1?orderId=order-1&pipeline=simulate-reads"
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/pipelines/runs?orderId=order-1&publishedOnly=true&limit=50"
      );
    });
  });

  it("shows published sequencing files with gated inspect and download links", async () => {
    currentOrderPayload = {
      ...orderPayload,
      sequencingFilesPublishedAt: "2026-05-21T10:00:00.000Z",
      sequencingFilesPublishedById: "admin-1",
    };

    await act(async () => {
      render(
        <Suspense fallback={<div>Loading</div>}>
          <OrderDetailPage params={Promise.resolve({ id: "order-1" })} />
        </Suspense>
      );
    });

    expect(await screen.findByText("Sequencing files")).toBeTruthy();
    expect(screen.getByText("S1_R1.fastq")).toBeTruthy();
    expect(screen.getByText("customer-report.html")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Inspect$/i }).getAttribute("href")).toBe(
      "/api/files/preview?path=reports%2Fcustomer-report.html"
    );

    const downloadLinks = screen.getAllByRole("link", { name: /^Download$/i });
    expect(downloadLinks.map((link) => link.getAttribute("href"))).toContain(
      "/api/files/download?path=reads%2FS1_R1.fastq"
    );
    expect(downloadLinks.map((link) => link.getAttribute("href"))).toContain(
      "/api/files/download?path=reports%2Fcustomer-report.html"
    );
  });
});
