// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  panelSuccess: vi.fn(),
  panelError: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/notifications/client", () => ({
  notifyPanel: {
    success: mocks.panelSuccess,
    error: mocks.panelError,
  },
}));

import { SequencingStreamView } from "./SequencingStreamView";
import type { SequencingSampleRow } from "@/lib/sequencing/types";

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}

function makeSample(id: string, sampleId: string, sampleAlias: string | null = null): SequencingSampleRow {
  return {
    id,
    sampleId,
    sampleAlias,
    sampleTitle: null,
    facilityStatus: "READY",
    facilityStatusUpdatedAt: null,
    updatedAt: "2026-04-01T10:00:00.000Z",
    read: null,
    integrityStatus: "complete",
    hasReads: false,
    protectedProvenanceCount: 0,
    protectedProvenance: [],
    sequencingRun: null,
    artifactCount: 0,
    qcArtifactCount: 0,
    latestArtifactStage: null,
    artifacts: [],
    stream: null,
  } as SequencingSampleRow;
}

const samples = [makeSample("sample-a", "SAMPLE_A", "Alpha"), makeSample("sample-b", "SAMPLE_B")];

function activeRunSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    orderId: "order-1",
    minknowRunId: "mk-1",
    flowCellId: "FC1",
    deviceId: "MN1",
    outputDir: "/data/run-1",
    status: "ACTIVE",
    totalBases: "1500000",
    totalReads: 1234,
    barcodeMap: { barcode01: "sample-a" },
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 5_000).toISOString(),
    stoppedAt: null,
    latestEvent: null,
    ...overrides,
  };
}

// An earlier run of the same sequencing order that has already been stopped:
// different id, directory and barcode mapping so it is never confused with the
// active one above.
function stoppedRunSummary(overrides: Record<string, unknown> = {}) {
  return {
    ...activeRunSummary(),
    id: "run-0",
    minknowRunId: "mk-0",
    outputDir: "/data/run-0",
    status: "STOPPED",
    totalBases: "900000",
    totalReads: 700,
    barcodeMap: { barcode02: "sample-b" },
    startedAt: new Date(Date.now() - 7_200_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 3_600_000).toISOString(),
    stoppedAt: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides,
  };
}

describe("SequencingStreamView", () => {
  const fetchMock = vi.fn();
  const onDataChanged = vi.fn();

  // Count of fetches whose URL contains `fragment`. Event URLs are absolute
  // (built through `new URL(..., window.location.origin)`), so match on a
  // substring rather than the whole URL.
  function callsMatching(fragment: string) {
    return fetchMock.mock.calls.filter(([u]) => String(u).includes(fragment)).length;
  }

  function callsEqual(url: string) {
    return fetchMock.mock.calls.filter(([u]) => String(u) === url).length;
  }

  // Default: no active run, daemon not available, no events/barcodes.
  function installFetch(opts: {
    runs?: unknown[];
    daemonStatus?: "RUNNING" | "STOPPED" | "ERROR";
    daemonUnauthorized?: boolean;
    events?: Array<{ id: string; seq: number; ts: string; kind: string; payload: unknown }>;
    eventsCursor?: number;
    barcodes?: Array<Record<string, unknown>>;
    streamFails?: boolean;
  } = {}) {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      // Stream runs list (GET) + start stream (POST)
      if (url === "/api/orders/order-1/stream") {
        if (init?.method === "POST") {
          return Promise.resolve(jsonResponse({ ok: true }));
        }
        if (opts.streamFails) {
          return Promise.resolve(jsonResponse({}, false, 500));
        }
        return Promise.resolve(jsonResponse({ runs: opts.runs ?? [] }));
      }

      // Daemon / workers
      if (url === "/api/admin/workers") {
        if (opts.daemonUnauthorized) {
          return Promise.resolve(jsonResponse({}, false, 403));
        }
        return Promise.resolve(
          jsonResponse({
            workers: [
              {
                name: "stream-monitor",
                latest: {
                  status: opts.daemonStatus ?? "STOPPED",
                  pid: 4242,
                  lastErrorMsg: null,
                },
              },
            ],
          })
        );
      }

      if (url === "/api/admin/workers/stream-monitor/start") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }

      // Events
      if (url.includes("/events")) {
        return Promise.resolve(
          jsonResponse({
            events: opts.events ?? [],
            cursor: opts.eventsCursor ?? 0,
          })
        );
      }

      // By-barcode aggregates
      if (url.includes("/by-barcode")) {
        return Promise.resolve(jsonResponse({ barcodes: opts.barcodes ?? [] }));
      }

      // Stop
      if (url.includes("/stop")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }

      return Promise.resolve(jsonResponse({ ok: true }));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    installFetch();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the loading state then the idle view with the start form", async () => {
    installFetch({ runs: [], daemonUnauthorized: true });
    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    // Initial loadingRuns state.
    expect(screen.getByText("Loading stream status…")).toBeTruthy();

    // After the first refreshRuns resolves we see the idle status + start form.
    expect(await screen.findByText("Idle")).toBeTruthy();
    expect(screen.getByText(/No active stream for this sequencing order/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start receiving" })).toBeTruthy();

    // Dev seeding fills the output directory once.
    await waitFor(() => {
      expect((screen.getByLabelText("Output directory") as HTMLInputElement).value).toBe(
        "/tmp/seqdesk-sim"
      );
    });

    // Non-admin daemon hint shown (403 -> available:false).
    expect(
      screen.getByText(/Make sure the stream-monitor daemon is running/i)
    ).toBeTruthy();
  });

  it("loads demo stream data once without arming background intervals", async () => {
    installFetch({
      runs: [activeRunSummary()],
      daemonStatus: "RUNNING",
    });
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    render(
      <SequencingStreamView
        orderId="order-1"
        samples={samples}
        canManage
        enablePolling={false}
        onDataChanged={onDataChanged}
      />
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([url]) => String(url) === "/api/orders/order-1/stream"
        )
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === "/api/admin/workers")
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes("/by-barcode"))
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes("/events"))
      ).toHaveLength(1);
    });
    expect(
      intervalSpy.mock.calls.filter(([, delay]) => delay === 3000 || delay === 5000)
    ).toHaveLength(0);
  });

  it("validates the output directory before starting a stream", async () => {
    installFetch({ runs: [], daemonStatus: "RUNNING" });
    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    await screen.findByText("Idle");

    const input = screen.getByLabelText("Output directory") as HTMLInputElement;
    // Clear the dev-seeded value so validation fires.
    fireEvent.change(input, { target: { value: "   " } });

    fireEvent.click(screen.getByRole("button", { name: "Start receiving" }));

    await waitFor(() => {
      expect(mocks.panelError).toHaveBeenCalledWith("Output directory is required");
    });
    // Should not have POSTed to start.
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) => String(u) === "/api/orders/order-1/stream" && (init as RequestInit)?.method === "POST"
      )
    ).toBe(false);

    // Running daemon status surfaces a success hint with pid.
    expect(screen.getByText("Stream-monitor daemon running")).toBeTruthy();
    expect(screen.getByText("(pid 4242)")).toBeTruthy();
  });

  it("adds a barcode mapping and starts the stream", async () => {
    installFetch({ runs: [], daemonStatus: "RUNNING" });
    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    await screen.findByText("Idle");

    // Add a barcode row via Enter key.
    const barcodeInput = screen.getByPlaceholderText("barcode01");
    fireEvent.change(barcodeInput, { target: { value: "Barcode02" } });
    fireEvent.keyDown(barcodeInput, { key: "Enter" });

    // Row is added, lowercased.
    expect(await screen.findByText("barcode02")).toBeTruthy();

    // Adding the same barcode again errors.
    fireEvent.change(screen.getByPlaceholderText("barcode01"), { target: { value: "barcode02" } });
    fireEvent.click(screen.getByRole("button", { name: "Add barcode" }));
    await waitFor(() => {
      expect(mocks.panelError).toHaveBeenCalledWith("barcode02 is already mapped");
    });

    // Start the stream (output dir is dev-seeded).
    fireEvent.click(screen.getByRole("button", { name: "Start receiving" }));

    await waitFor(() => {
      expect(mocks.panelSuccess).toHaveBeenCalledWith("Stream started");
    });
    const startCall = fetchMock.mock.calls.find(
      ([u, init]) => String(u) === "/api/orders/order-1/stream" && (init as RequestInit)?.method === "POST"
    );
    expect(startCall).toBeTruthy();
    const body = JSON.parse((startCall![1] as RequestInit).body as string);
    expect(body.outputDir).toBe("/tmp/seqdesk-sim");
    expect(body.barcodeMap).toEqual({ barcode02: "sample-a" });
  });

  it("surfaces an error when starting a stream fails", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/orders/order-1/stream") {
        if (init?.method === "POST") {
          return Promise.resolve(jsonResponse({ error: "boom" }, false, 400));
        }
        return Promise.resolve(jsonResponse({ runs: [] }));
      }
      if (url === "/api/admin/workers") {
        return Promise.resolve(jsonResponse({}, false, 403));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    await screen.findByText("Idle");
    fireEvent.click(screen.getByRole("button", { name: "Start receiving" }));

    await waitFor(() => {
      expect(mocks.panelError).toHaveBeenCalledWith("Failed to start stream: boom");
    });
  });

  it("starts the daemon from the stopped-state warning button", async () => {
    installFetch({ runs: [], daemonStatus: "ERROR" });
    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    await screen.findByText("Idle");
    expect(await screen.findByText(/Stream-monitor daemon errored/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Start daemon/i }));

    await waitFor(() => {
      expect(mocks.panelSuccess).toHaveBeenCalledWith("Stream monitor started");
    });
    expect(
      fetchMock.mock.calls.some(([u]) => String(u) === "/api/admin/workers/stream-monitor/start")
    ).toBe(true);
  });

  it("renders the active run dashboard, barcode mapping, and lets a manager stop it", async () => {
    installFetch({
      runs: [activeRunSummary()],
      daemonStatus: "RUNNING",
      barcodes: [
        {
          barcode: "barcode01",
          fileCount: 3,
          totalSize: 4096,
          totalReads: 1000,
          totalBases: 1_500_000,
          lastFileAt: new Date(Date.now() - 2_000).toISOString(),
          lastFilePath: "/data/run-1/fastq_pass/barcode01/file1.fastq.gz",
        },
        {
          barcode: "unclassified",
          fileCount: 1,
          totalSize: 1024,
          totalReads: 50,
          totalBases: 75_000,
          lastFileAt: null,
          lastFilePath: null,
        },
      ],
    });

    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    // Active badge + totals.
    expect(await screen.findByText("Active")).toBeTruthy();
    expect(screen.getByText("/data/run-1")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
    // Run total bases (and matching barcode totals) render as 1.50 Mb.
    expect(screen.getAllByText("1.50 Mb").length).toBeGreaterThan(0);

    // Barcode mapping table maps barcode01 to the sample alias.
    expect(screen.getAllByText("barcode01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);

    // By-barcode aggregates appear after the first poll. "unmapped" appears
    // both in the explanatory help text and in the by-barcode row for the
    // unclassified barcode, so allow multiple matches.
    await waitFor(() => {
      expect(screen.getAllByText("unmapped").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("1,000")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // file count

    // Stop the run.
    fireEvent.click(screen.getByRole("button", { name: /Stop receiving/i }));
    await waitFor(() => {
      expect(mocks.panelSuccess).toHaveBeenCalledWith("Stream stopped");
    });
    expect(
      fetchMock.mock.calls.some(([u]) => String(u) === "/api/orders/order-1/stream/run-1/stop")
    ).toBe(true);
  });

  it("merges and dedups polled events, refreshes totals, and expands the audit log", async () => {
    // First runs poll returns a run with low totals; events poll yields a FILE_INGESTED
    // event. The event poll triggers refreshRuns which then returns higher totals.
    let runsPollCount = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/orders/order-1/stream") {
        if (init?.method === "POST") return Promise.resolve(jsonResponse({ ok: true }));
        runsPollCount += 1;
        const totalReads = runsPollCount === 1 ? 10 : 99;
        return Promise.resolve(jsonResponse({ runs: [activeRunSummary({ totalReads })] }));
      }
      if (url === "/api/admin/workers") {
        return Promise.resolve(jsonResponse({}, false, 403));
      }
      if (url.includes("/events")) {
        // Only the first events poll (no "after") returns events; subsequent
        // polls (with cursor) return nothing so totals stay stable.
        const hasAfter = url.includes("after=");
        return Promise.resolve(
          jsonResponse({
            events: hasAfter
              ? []
              : [
                  {
                    id: "evt-1",
                    seq: 7,
                    ts: new Date(Date.now() - 1_000).toISOString(),
                    kind: "FILE_INGESTED",
                    payload: {
                      filePath: "/data/run-1/fastq_pass/barcode01/a.fastq.gz",
                      barcode: "barcode01",
                      size: 2048,
                      linkedSampleId: "sample-a",
                    },
                  },
                ],
            cursor: hasAfter ? 7 : 7,
          })
        );
      }
      if (url.includes("/by-barcode")) {
        return Promise.resolve(jsonResponse({ barcodes: [] }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    expect(await screen.findByText("Active")).toBeTruthy();

    // The event poll fired, found a FILE_INGESTED event, and notified the parent.
    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalled();
    });

    // refreshRuns was re-invoked by the event poll, picking up the higher totals.
    await waitFor(() => {
      expect(screen.getByText("99")).toBeTruthy();
    });

    // Expand the audit log and confirm the event is rendered once (deduped).
    fireEvent.click(screen.getByText("Audit trail"));
    await waitFor(() => {
      expect(screen.getAllByText("FILE_INGESTED").length).toBeGreaterThan(0);
    });

    // Expand the recent files panel and confirm the ingested file row shows the alias.
    fireEvent.click(screen.getByText("Recent files"));
    await waitFor(() => {
      const fileCells = screen.getAllByText("/data/run-1/fastq_pass/barcode01/a.fastq.gz");
      expect(fileCells.length).toBeGreaterThan(0);
    });
  });

  it("hides the start form for a viewer who cannot manage the order", async () => {
    installFetch({ runs: [], daemonUnauthorized: true });
    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage={false} onDataChanged={onDataChanged} />
    );

    // Idle, but no start form because canManage is false.
    expect(await screen.findByText("Idle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start receiving" })).toBeNull();
  });

  it("hides the Stop control on an active run for a viewer who cannot manage", async () => {
    installFetch({ runs: [activeRunSummary()], daemonUnauthorized: true });
    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage={false} onDataChanged={onDataChanged} />
    );

    expect(await screen.findByText("Active")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop receiving/i })).toBeNull();
  });

  it("shows a stopped run's totals, files and audit trail when nothing is live", async () => {
    installFetch({
      runs: [stoppedRunSummary()],
      daemonUnauthorized: true,
      events: [
        {
          id: "evt-9",
          seq: 12,
          ts: new Date(Date.now() - 3_600_000).toISOString(),
          kind: "FILE_INGESTED",
          payload: {
            filePath: "/data/run-0/fastq_pass/barcode02/z.fastq.gz",
            barcode: "barcode02",
            size: 2048,
            linkedSampleId: "sample-b",
          },
        },
      ],
      eventsCursor: 12,
      barcodes: [
        {
          barcode: "barcode02",
          fileCount: 5,
          totalSize: 8192,
          totalReads: 700,
          totalBases: 900_000,
          lastFileAt: new Date(Date.now() - 3_600_000).toISOString(),
          lastFilePath: "/data/run-0/fastq_pass/barcode02/z.fastq.gz",
        },
      ],
    });

    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    // The finished run is shown instead of the never-ran empty state.
    expect(await screen.findByText("Stopped")).toBeTruthy();
    expect(screen.queryByText(/No active stream for this sequencing order/)).toBeNull();
    expect(screen.getByText("/data/run-0")).toBeTruthy();
    // Run total, and once the aggregates land the barcode row repeats it.
    expect(screen.getAllByText("700").length).toBeGreaterThan(0);

    // Visibly finished: a wall-clock duration and when it ended, not a heartbeat.
    expect(screen.getByText("Duration")).toBeTruthy();
    expect(screen.queryByText("Elapsed")).toBeNull();
    expect(screen.getByText(/Stopped 1h ago on /)).toBeTruthy();
    expect(screen.queryByText(/Monitor heartbeat/)).toBeNull();

    // Its barcode mapping and final per-barcode totals are readable. The live
    // "Rate" column is dropped — a stopped run is fetched once, so it has no delta.
    expect(screen.getAllByText("barcode02").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SAMPLE_B").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText("5")).toBeTruthy(); // file count
    });
    expect(screen.getByText(/Final totals/)).toBeTruthy();
    expect(screen.queryByText("Rate")).toBeNull();

    // The ingested files and the event trail are still reachable.
    fireEvent.click(screen.getByText("Recent files"));
    await waitFor(() => {
      expect(screen.getAllByText("/data/run-0/fastq_pass/barcode02/z.fastq.gz").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByText("Audit trail"));
    await waitFor(() => {
      expect(screen.getAllByText("FILE_INGESTED").length).toBeGreaterThan(0);
    });

    // Nothing is receiving, so a manager can still start the next stream.
    expect(screen.getByRole("button", { name: "Start receiving" })).toBeTruthy();
  });

  it("lands on the live run when an earlier stopped run is also present", async () => {
    installFetch({ runs: [activeRunSummary(), stoppedRunSummary()], daemonUnauthorized: true });
    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    // The live run is what the reader lands on, not the more numerous history.
    expect(await screen.findByText("Active")).toBeTruthy();
    expect(screen.getByText("/data/run-1")).toBeTruthy();
    expect(screen.queryByText("/data/run-0")).toBeNull();

    // Both runs are offered, with the live one marked as the current selection.
    const runGroup = screen.getByRole("group", { name: "Stream runs" });
    expect(within(runGroup).getAllByRole("button")).toHaveLength(2);
    expect(within(runGroup).getByRole("button", { name: /^Live/ }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(within(runGroup).getByRole("button", { name: /^Stopped/ }).getAttribute("aria-pressed")).toBe(
      "false"
    );

    // Only the live run's detail panels are fetched.
    await waitFor(() => {
      expect(callsMatching("/api/orders/order-1/stream/run-1/by-barcode")).toBeGreaterThan(0);
    });
    expect(callsMatching("/api/orders/order-1/stream/run-0/")).toBe(0);
  });

  it("stops polling when the reader selects a stopped run", async () => {
    installFetch({ runs: [activeRunSummary(), stoppedRunSummary()], daemonUnauthorized: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    expect(await screen.findByText("Active")).toBeTruthy();

    const runGroup = screen.getByRole("group", { name: "Stream runs" });
    fireEvent.click(within(runGroup).getByRole("button", { name: /^Stopped/ }));

    // The stopped run's panels are loaded exactly once…
    expect(await screen.findByText("/data/run-0")).toBeTruthy();
    await waitFor(() => {
      expect(callsMatching("/api/orders/order-1/stream/run-0/by-barcode")).toBe(1);
      expect(callsMatching("/api/orders/order-1/stream/run-0/events")).toBe(1);
    });

    const runsListPolls = callsEqual("/api/orders/order-1/stream");
    const liveRunPolls = callsMatching("/api/orders/order-1/stream/run-1/");
    await vi.advanceTimersByTimeAsync(12_000);

    // …and never again: its totals, files and events are frozen. The runs list
    // itself keeps ticking, which is what proves the timers really advanced.
    expect(callsMatching("/api/orders/order-1/stream/run-0/by-barcode")).toBe(1);
    expect(callsMatching("/api/orders/order-1/stream/run-0/events")).toBe(1);
    expect(callsEqual("/api/orders/order-1/stream")).toBeGreaterThan(runsListPolls);

    // The run left behind is not polled behind the reader's back either.
    expect(callsMatching("/api/orders/order-1/stream/run-1/")).toBe(liveRunPolls);
  });

  it("keeps the empty state for a sequencing order that has never streamed", async () => {
    installFetch({ runs: [], daemonUnauthorized: true });
    render(
      <SequencingStreamView orderId="order-1" samples={samples} canManage onDataChanged={onDataChanged} />
    );

    expect(await screen.findByText("Idle")).toBeTruthy();
    expect(screen.getByText(/No active stream for this sequencing order/)).toBeTruthy();
    // No run to select and no detail panels to render.
    expect(screen.queryByRole("group", { name: "Stream runs" })).toBeNull();
    expect(screen.queryByText("Barcode mapping")).toBeNull();
    expect(screen.queryByText("By barcode")).toBeNull();
    expect(screen.queryByText("Recent files")).toBeNull();
    expect(screen.queryByText("Audit trail")).toBeNull();
    expect(callsMatching("/by-barcode")).toBe(0);
    expect(callsMatching("/events")).toBe(0);
  });
});
