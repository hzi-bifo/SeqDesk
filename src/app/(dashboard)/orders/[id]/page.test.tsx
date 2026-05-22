// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
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

import OrderDetailPage from "./page";

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
  let currentOrderPayload: any;

  beforeEach(() => {
    vi.clearAllMocks();
    currentOrderPayload = orderPayload;
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
      if (url === "/api/orders/order-1") {
        return Promise.resolve(jsonResponse(currentOrderPayload));
      }
      if (url === "/api/form-schema") {
        return Promise.resolve(
          jsonResponse({
            fields: [],
            groups: [],
            perSampleFields: [],
            enabledMixsChecklists: [],
          })
        );
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
