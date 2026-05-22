// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: mocks.useSession,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/notifications/client", () => ({
  notifyPanel: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("@/components/orders/FastqcMetricBadges", () => ({
  FastqcMetricBadges: () => null,
}));

vi.mock("@/components/orders/OrderPipelineView", () => ({
  OrderPipelineView: () => <div>Order pipeline view</div>,
}));

vi.mock("@/components/orders/SequencingDiscoverView", () => ({
  SequencingDiscoverView: () => <div>Sequencing discover view</div>,
}));

vi.mock("@/components/orders/SequencingStreamView", () => ({
  SequencingStreamView: () => <div>Sequencing stream view</div>,
}));

import OrderSequencingPage from "./page";

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  } as Response;
}

const orderArtifact = {
  id: "artifact-1",
  orderId: "order-1",
  sampleId: null,
  sequencingRunId: null,
  stage: "qc",
  artifactType: "qc_report",
  source: "manual",
  visibility: "facility",
  path: "reports/facility-report.html",
  originalName: "facility-report.html",
  size: 1234,
  checksum: null,
  mimeType: "text/html",
  metadata: null,
  createdAt: "2026-05-20T10:00:00.000Z",
  updatedAt: "2026-05-20T10:00:00.000Z",
};

const sequencingSummary = {
  orderId: "order-1",
  orderName: "Delivery Order",
  orderStatus: "SUBMITTED",
  canManage: true,
  dataBasePathConfigured: true,
  config: {
    allowedExtensions: [".fastq", ".fq.gz"],
    allowSingleEnd: true,
  },
  sequencingTechSelection: null,
  summary: {
    totalSamples: 0,
    readsLinkedSamples: 0,
    qcArtifactSamples: 0,
    missingChecksumSamples: 0,
    orderArtifactCount: 1,
    statusCounts: {
      WAITING: 0,
      PROCESSING: 0,
      SEQUENCED: 0,
      QC_REVIEW: 0,
      READY: 0,
      ISSUE: 0,
    },
  },
  samples: [],
  orderArtifacts: [orderArtifact],
};

const unpublishedDelivery = {
  orderId: "order-1",
  orderName: "Delivery Order",
  isPublished: false,
  publishedAt: null,
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
      sampleTitle: null,
      size: 1000,
      checksum: null,
      readId: "read-1",
      readDirection: "R1",
      readCount: 10,
    },
  ],
  artifactFiles: [],
  excluded: {
    missingCleanedReadFiles: 1,
    rawOrUnknownReadFiles: 2,
    missingCustomerArtifacts: 0,
    unsupportedCustomerArtifacts: 0,
    facilityArtifacts: 1,
  },
};

const publishedDelivery = {
  ...unpublishedDelivery,
  isPublished: true,
  publishedAt: "2026-05-22T10:00:00.000Z",
};

describe("OrderSequencingPage delivery controls", () => {
  const fetchMock = vi.fn();
  let currentDelivery: any;

  beforeEach(() => {
    vi.clearAllMocks();
    currentDelivery = unpublishedDelivery;
    mocks.useSession.mockReturnValue({
      status: "authenticated",
      data: {
        user: {
          id: "admin-1",
          role: "FACILITY_ADMIN",
          isDemo: false,
        },
      },
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/orders/order-1/sequencing") {
        return Promise.resolve(jsonResponse(sequencingSummary));
      }
      if (url === "/api/orders/order-1/sequencing/delivery" && method === "GET") {
        return Promise.resolve(jsonResponse({ delivery: currentDelivery }));
      }
      if (
        url === "/api/orders/order-1/sequencing/delivery/publication" &&
        method === "POST"
      ) {
        currentDelivery = publishedDelivery;
        return Promise.resolve(jsonResponse({ success: true, delivery: currentDelivery }));
      }
      if (
        url === "/api/orders/order-1/sequencing/delivery/publication" &&
        method === "DELETE"
      ) {
        currentDelivery = unpublishedDelivery;
        return Promise.resolve(jsonResponse({ success: true, delivery: currentDelivery }));
      }
      if (url === "/api/admin/settings/pipelines?enabled=true&catalog=order") {
        return Promise.resolve(jsonResponse({ pipelines: [] }));
      }
      if (url === "/api/orders/order-1/sequencing/runs") {
        return Promise.resolve(jsonResponse({ fields: [], runs: [] }));
      }
      if (
        url === "/api/orders/order-1/sequencing/artifacts/artifact-1/visibility" &&
        method === "PATCH"
      ) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            artifact: { ...orderArtifact, visibility: "customer" },
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function renderPage() {
    await act(async () => {
      render(
        <Suspense fallback={<div>Loading</div>}>
          <OrderSequencingPage params={Promise.resolve({ id: "order-1" })} />
        </Suspense>
      );
    });
  }

  it("shows delivery readiness and publishes through the confirmation modal", async () => {
    await renderPage();

    expect(await screen.findByText("Delivery to user")).toBeTruthy();
    expect(screen.getByText("Cleaned reads present")).toBeTruthy();
    expect(screen.getByText("Missing files")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make downloadable to user" }));
    expect(await screen.findByText("Make sequencing files downloadable?")).toBeTruthy();
    expect(screen.getByText("Excluded: 2 raw or unknown reads, 1 missing cleaned reads, 1 facility-only reports, 0 missing customer reports, 0 unsupported customer reports.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make downloadable" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/orders/order-1/sequencing/delivery/publication",
        { method: "POST" }
      );
    });
  });

  it("shows the hide action when published", async () => {
    currentDelivery = publishedDelivery;

    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Hide from user" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/orders/order-1/sequencing/delivery/publication",
        { method: "DELETE" }
      );
    });
  });

  it("marks sequencing reports as customer-facing", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Make customer-facing" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/orders/order-1/sequencing/artifacts/artifact-1/visibility",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ visibility: "customer" }),
        })
      );
    });
  });
});
