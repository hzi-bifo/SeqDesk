// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Footer } from "./Footer";

vi.mock("@/lib/useHelpText", () => ({
  useHelpText: () => ({
    showHelpText: false,
    isLoaded: true,
    toggleHelpText: vi.fn(),
  }),
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function makePipelineRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    runNumber: "MAG-20260519-001",
    pipelineId: "mag",
    targetType: "study",
    targetLabel: "Metagenomics Study",
    userId: "user-1",
    userName: "Ada Lovelace",
    userEmail: "ada@example.com",
    status: "running",
    mode: "slurm",
    queueJobId: "12345",
    queueStatus: "RUNNING",
    queueReason: null,
    activeSince: new Date(Date.now() - 90 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    stale: false,
    resources: {
      queue: "bigmem",
      cores: 24,
      memory: "256GB",
      timeLimitHours: 48,
    },
    ...overrides,
  };
}

function makePipelineLoad(overrides: Record<string, unknown> = {}) {
  const visibleUsers = [
    {
      userId: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      active: 3,
      staleActive: 0,
      statuses: { pending: 1, queued: 1, running: 1 },
      staleByStatus: { pending: 0, queued: 0, running: 0 },
      modes: { slurm: 2, local: 1, unknown: 0 },
    },
    {
      userId: "user-2",
      name: "Max Planck",
      email: "max@example.com",
      active: 1,
      staleActive: 0,
      statuses: { pending: 0, queued: 0, running: 1 },
      staleByStatus: { pending: 0, queued: 0, running: 0 },
      modes: { slurm: 1, local: 0, unknown: 0 },
    },
  ];
  return {
    totalActive: 4,
    statuses: { pending: 1, queued: 1, running: 2 },
    modes: { slurm: 3, local: 1, unknown: 0 },
    staleActive: 0,
    staleByStatus: { pending: 0, queued: 0, running: 0 },
    totalUsers: visibleUsers.length,
    visibleUsers,
    hiddenUserCount: 0,
    activeRuns: [makePipelineRun()],
    hiddenRunCount: 0,
    users: visibleUsers,
    updatedAt: "2026-05-19T10:00:00.000Z",
    ...overrides,
  };
}

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: "notification-1",
    eventType: "order.updated",
    severity: "info",
    title: "Order ORD-20260519-0001 updated",
    body: "Ada Lovelace updated order details.",
    linkPath: "/orders/order-1",
    sourceType: "order",
    sourceId: "order-1",
    readAt: null,
    archivedAt: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe("Footer admin activity", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({ workers: [] });
        }
        if (url.startsWith("/api/notifications")) {
          return jsonResponse({ notifications: [], unreadCount: 0 });
        }
        return jsonResponse({
          jobs: [
            {
              id: "pipeline-db:metaxpath:db-bundle",
              type: "pipeline-db-download",
              label: "MetaxPath Database Bundle (metaxpath)",
              state: "running",
              phase: "downloading",
              bytesDownloaded: 1024 * 1024,
              totalBytes: 2 * 1024 * 1024,
              progressPercent: 50,
              speedBytesPerSecond: 1024,
              etaSeconds: 60,
              targetPath: "/data/metaxpath_db_bundle.tar",
            },
          ],
        });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows persistent running admin activity in the footer", async () => {
    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/Downloading MetaxPath Database Bundle/)).toBeTruthy();
    });
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(screen.getByText(/ETA 1m/)).toBeTruthy();
  });

  it("opens activity details with target path and log excerpt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        if (String(input) === "/api/admin/workers") {
          return jsonResponse({ workers: [] });
        }
        return jsonResponse({
          jobs: [
            {
              id: "pipeline-db:metaxpath:db-bundle",
              type: "pipeline-db-download",
              label: "MetaxPath Database Bundle (metaxpath)",
              state: "error",
              error: "curl failed with exit code 7",
              targetPath: "/data/metaxpath_db_bundle.tar",
              logExcerpt: ["curl: could not connect"],
            },
          ],
        });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/curl failed with exit code 7/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(screen.getByText(/Target: \/data\/metaxpath_db_bundle.tar/)).toBeTruthy();
    expect(screen.getByText(/curl: could not connect/)).toBeTruthy();
  });

  it("hides a failed activity entry through the activity API", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/workers") {
        return jsonResponse({ workers: [] });
      }
      if (url.includes("/api/admin/activity/jobs/") && url.endsWith("/hide")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ hidden: true, jobs: [] });
      }
      return jsonResponse({
        jobs: [
          {
            id: "seed:dummy-data:admin-1",
            type: "dummy-seed",
            label: "Load dummy data",
            state: "error",
            error: "Data base path is not writable",
            updatedAt: "2026-05-13T07:00:00.000Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/Data base path is not writable/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /hide/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("/hide"))
      ).toBe(true);
    });
    expect(screen.queryByText(/Data base path is not writable/)).toBeNull();
  });

  it("shows compact background worker status when no activity is visible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({
            workers: [
              {
                name: "pipeline-monitor",
                label: "Pipeline monitor",
                paused: false,
                latest: {
                  id: "worker-1",
                  name: "pipeline-monitor",
                  pid: 1234,
                  startedAt: new Date(Date.now() - 60_000).toISOString(),
                  stoppedAt: null,
                  status: "RUNNING",
                  exitCode: null,
                  logPath: "/tmp/pipeline-monitor.log",
                  lastErrorMsg: null,
                  startedByEmail: "admin@example.com",
                },
              },
            ],
          });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/Background workers: Pipeline monitor/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(screen.getByText("Background workers")).toBeTruthy();
    expect(screen.getByText("Pipeline monitor")).toBeTruthy();
    expect(screen.getByText("Open full page")).toBeTruthy();
  });

  it("shows clickable pipeline job details when active runs exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({
            workers: [],
            pipelineLoad: makePipelineLoad(),
          });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("4 jobs active · 3 on SLURM · 1 local")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /pipeline jobs, 4 jobs active/i }));

    expect(screen.getByText("Pipeline jobs")).toBeTruthy();
    expect(screen.getByText("2 running · 1 queued · 1 pending")).toBeTruthy();
    expect(screen.getByText("3 on SLURM · 1 local")).toBeTruthy();
    expect(screen.getByText("Active jobs")).toBeTruthy();
    expect(screen.getByText("MAG-20260519-001")).toBeTruthy();
    expect(screen.getByText(/Running for/)).toBeTruthy();
    expect(screen.getByText("SLURM 12345 · RUNNING")).toBeTruthy();
    expect(screen.getByText("queue bigmem · 24 CPU · 256GB · 48h limit")).toBeTruthy();
    expect(screen.getAllByText(/Ada Lovelace/).length).toBeGreaterThan(0);
    expect(screen.getByText(/3 jobs active · 2 on SLURM · 1 local/)).toBeTruthy();
  });

  it("uses singular pipeline job copy", async () => {
    const visibleUsers = [
      {
        userId: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: 1,
        staleActive: 0,
        statuses: { pending: 0, queued: 0, running: 1 },
        staleByStatus: { pending: 0, queued: 0, running: 0 },
        modes: { slurm: 1, local: 0, unknown: 0 },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({
            workers: [],
            pipelineLoad: makePipelineLoad({
              totalActive: 1,
              statuses: { pending: 0, queued: 0, running: 1 },
              modes: { slurm: 1, local: 0, unknown: 0 },
              totalUsers: 1,
              visibleUsers,
              users: visibleUsers,
            }),
          });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("1 job active · SLURM")).toBeTruthy();
    });
  });

  it("renders a short pipeline load label for narrow footer space", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({
            workers: [],
            pipelineLoad: makePipelineLoad(),
          });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("4 jobs")).toBeTruthy();
    });
  });

  it("shows stale pipeline load and hidden user counts in details", async () => {
    const visibleUsers = [
      {
        userId: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        active: 3,
        staleActive: 2,
        statuses: { pending: 1, queued: 1, running: 1 },
        staleByStatus: { pending: 1, queued: 0, running: 1 },
        modes: { slurm: 2, local: 1, unknown: 0 },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({
            workers: [],
            pipelineLoad: makePipelineLoad({
              totalActive: 8,
              statuses: { pending: 2, queued: 2, running: 4 },
              modes: { slurm: 6, local: 1, unknown: 1 },
              staleActive: 2,
              staleByStatus: { pending: 1, queued: 0, running: 1 },
              totalUsers: 3,
              visibleUsers,
              users: visibleUsers,
              hiddenUserCount: 2,
            }),
          });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("8 jobs active · 6 on SLURM · 1 local · 1 unknown")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /pipeline jobs, 8 jobs active/i }));

    expect(screen.getByText("Pipeline jobs")).toBeTruthy();
    expect(screen.getByText("8 jobs active")).toBeTruthy();
    expect(screen.getByText("2 stale jobs")).toBeTruthy();
    expect(screen.getByText("1 running · 1 pending")).toBeTruthy();
    expect(screen.getByText("+2 more users")).toBeTruthy();
  });

  it("shows partial admin status warnings from the workers endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({
            workers: [],
            pipelineLoad: null,
            workersError: "Some background worker status could not be loaded.",
            pipelineLoadError: "Pipeline load could not be loaded.",
          });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Admin status: partial data unavailable")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(screen.getByText("Status warnings")).toBeTruthy();
    expect(screen.getByText("Some background worker status could not be loaded.")).toBeTruthy();
    expect(screen.getByText("Pipeline load could not be loaded.")).toBeTruthy();
  });

  it("keeps worker attention visible while adding pipeline load context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({
            workers: [
              {
                name: "pipeline-monitor",
                label: "Pipeline monitor",
                paused: false,
                latest: {
                  id: "worker-1",
                  name: "pipeline-monitor",
                  pid: 1234,
                  startedAt: new Date(Date.now() - 60_000).toISOString(),
                  stoppedAt: new Date().toISOString(),
                  status: "ERROR",
                  exitCode: 1,
                  logPath: "/tmp/pipeline-monitor.log",
                  lastErrorMsg: "squeue unavailable",
                  startedByEmail: "admin@example.com",
                },
              },
            ],
            pipelineLoad: makePipelineLoad({
              totalActive: 2,
              statuses: { pending: 0, queued: 1, running: 1 },
              modes: { slurm: 2, local: 0, unknown: 0 },
              users: [],
            }),
          });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Error")).toBeTruthy();
    });
    expect(screen.getByText("2 jobs active · 2 on SLURM")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /pipeline jobs, 2 jobs active/i }));

    expect(screen.getByText("Pipeline jobs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(screen.getByText("squeue unavailable")).toBeTruthy();
  });

  it("does not show pipeline load when no active runs are reported", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/admin/workers") {
        return jsonResponse({
          workers: [],
          pipelineLoad: makePipelineLoad({
            totalActive: 0,
            statuses: { pending: 0, queued: 0, running: 0 },
            modes: { slurm: 0, local: 0, unknown: 0 },
            users: [],
          }),
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Footer />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/workers", { cache: "no-store" });
    });
    expect(screen.queryByRole("button", { name: /pipeline jobs/i })).toBeNull();
  });

  it("shows notification unread count and expands notification details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/notifications?limit=20&archived=false") {
          return jsonResponse({
            notifications: [makeNotification()],
            unreadCount: 2,
          });
        }
        if (url === "/api/admin/workers") {
          return jsonResponse({ workers: [] });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /notifications, 2 unread/i })
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText("Order ORD-20260519-0001 updated")).toBeTruthy();
    expect(screen.queryByText("Ada Lovelace updated order details.")).toBeNull();

    fireEvent.click(screen.getByText("Order ORD-20260519-0001 updated"));

    expect(screen.getByText("Ada Lovelace updated order details.")).toBeTruthy();
    expect(
      (screen.getByRole("link", { name: /open/i }) as HTMLAnchorElement).getAttribute("href")
    ).toBe("/orders/order-1");
  });

  it("marks notification rows read and archives hidden notifications", async () => {
    let read = false;
    let archived = false;
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/notifications/notification-1/read") {
        expect(init?.method).toBe("POST");
        read = true;
        return jsonResponse({ success: true });
      }
      if (url === "/api/notifications/notification-1/archive") {
        expect(init?.method).toBe("POST");
        archived = true;
        return jsonResponse({ success: true });
      }
      if (url === "/api/notifications?limit=20&archived=false") {
        return jsonResponse({
          notifications: archived
            ? []
            : [makeNotification({ readAt: read ? new Date().toISOString() : null })],
          unreadCount: read || archived ? 0 : 1,
        });
      }
      if (url === "/api/admin/workers") {
        return jsonResponse({ workers: [] });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /notifications, 1 unread/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /mark order ord-20260519-0001 updated read/i })
    );

    await waitFor(() => {
      expect(read).toBe(true);
    });
    expect(screen.queryByRole("button", { name: /mark order ord-20260519-0001 updated read/i })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /hide order ord-20260519-0001 updated/i })
    );

    await waitFor(() => {
      expect(archived).toBe(true);
    });
    expect(screen.queryByText("Order ORD-20260519-0001 updated")).toBeNull();
  });

  it("shows an empty notification state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/notifications?limit=20&archived=false") {
          return jsonResponse({ notifications: [], unreadCount: 0 });
        }
        if (url === "/api/admin/workers") {
          return jsonResponse({ workers: [] });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(screen.getByText("No notifications.")).toBeTruthy();
  });

  it("expands worker log output from the footer details panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/admin/workers/pipeline-monitor/logs")) {
          return jsonResponse({
            lines: ["polling SLURM", "updated 2 pipeline runs"],
            logPath: "/tmp/pipeline-monitor.log",
          });
        }
        if (url === "/api/admin/workers") {
          return jsonResponse({
            workers: [
              {
                name: "pipeline-monitor",
                label: "Pipeline monitor",
                paused: false,
                latest: {
                  id: "worker-1",
                  name: "pipeline-monitor",
                  pid: 1234,
                  startedAt: new Date(Date.now() - 60_000).toISOString(),
                  stoppedAt: null,
                  status: "RUNNING",
                  exitCode: null,
                  logPath: "/tmp/pipeline-monitor.log",
                  lastErrorMsg: null,
                  startedByEmail: null,
                },
              },
            ],
          });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/Background workers: Pipeline monitor/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /show log/i }));

    await waitFor(() => {
      expect(screen.getByText(/polling SLURM/)).toBeTruthy();
    });
  });

  it("starts an errored worker from the footer details panel", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/workers/pipeline-monitor/start") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ ok: true, id: "worker-2", pid: 5678 });
      }
      if (url === "/api/admin/workers") {
        const workerCalls = fetchMock.mock.calls.filter(
          ([callUrl]) => String(callUrl) === "/api/admin/workers"
        ).length;
        const running = workerCalls > 1;
        return jsonResponse({
          workers: [
            {
              name: "pipeline-monitor",
              label: "Pipeline monitor",
              paused: false,
              latest: {
                id: running ? "worker-2" : "worker-1",
                name: "pipeline-monitor",
                pid: running ? 5678 : 1234,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: running ? null : new Date().toISOString(),
                status: running ? "RUNNING" : "ERROR",
                exitCode: running ? null : 1,
                logPath: "/tmp/pipeline-monitor.log",
                lastErrorMsg: running ? null : "exited via signal SIGINT",
                startedByEmail: "admin@example.com",
              },
            },
          ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Error")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /start pipeline monitor/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/admin/workers/pipeline-monitor/start" &&
            init?.method === "POST"
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === "/api/admin/workers")
          .length
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows a footer worker start error inline", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/admin/workers/pipeline-monitor/start") {
        return jsonResponse(
          { error: "Failed to start pipeline-monitor: missing NEXTFLOW_BIN" },
          false,
          500
        );
      }
      if (url === "/api/admin/workers") {
        return jsonResponse({
          workers: [
            {
              name: "pipeline-monitor",
              label: "Pipeline monitor",
              paused: false,
              latest: {
                id: "worker-1",
                name: "pipeline-monitor",
                pid: 1234,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: new Date().toISOString(),
                status: "ERROR",
                exitCode: 1,
                logPath: "/tmp/pipeline-monitor.log",
                lastErrorMsg: null,
                startedByEmail: "admin@example.com",
              },
            },
          ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Error")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /start pipeline monitor/i }));

    await waitFor(() => {
      expect(screen.getByText(/missing NEXTFLOW_BIN/)).toBeTruthy();
    });
  });

  it("clears a stale worker action error after a successful retry refreshes status", async () => {
    let started = false;
    let startAttempts = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/admin/workers/pipeline-monitor/start") {
        startAttempts += 1;
        if (startAttempts === 1) {
          return jsonResponse(
            { error: "Failed to start pipeline-monitor: missing NEXTFLOW_BIN" },
            false,
            500
          );
        }
        started = true;
        return jsonResponse({ ok: true, id: "worker-2", pid: 5678 });
      }
      if (url === "/api/admin/workers") {
        return jsonResponse({
          workers: [
            {
              name: "pipeline-monitor",
              label: "Pipeline monitor",
              paused: false,
              latest: {
                id: started ? "worker-2" : "worker-1",
                name: "pipeline-monitor",
                pid: started ? 5678 : 1234,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: started ? null : new Date().toISOString(),
                status: started ? "RUNNING" : "ERROR",
                exitCode: started ? null : 1,
                logPath: "/tmp/pipeline-monitor.log",
                lastErrorMsg: null,
                startedByEmail: "admin@example.com",
              },
            },
          ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Error")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /start pipeline monitor/i }));

    await waitFor(() => {
      expect(screen.getByText(/missing NEXTFLOW_BIN/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /start pipeline monitor/i }));

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Running")).toBeTruthy();
    });
    expect(screen.queryByText(/missing NEXTFLOW_BIN/)).toBeNull();
  });

  it("disables other footer worker actions while one action is pending", async () => {
    let resolveStart: ((value: unknown) => void) | undefined;
    const pendingStart = new Promise((resolve) => {
      resolveStart = resolve;
    });
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/admin/workers/stream-monitor/start") {
        return pendingStart;
      }
      if (url === "/api/admin/workers") {
        return jsonResponse({
          workers: [
            {
              name: "pipeline-monitor",
              label: "Pipeline monitor",
              paused: false,
              latest: {
                id: "worker-1",
                name: "pipeline-monitor",
                pid: 1234,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: null,
                status: "RUNNING",
                exitCode: null,
                logPath: "/tmp/pipeline-monitor.log",
                lastErrorMsg: null,
                startedByEmail: "admin@example.com",
              },
            },
            {
              name: "stream-monitor",
              label: "Stream monitor",
              paused: false,
              latest: {
                id: "worker-2",
                name: "stream-monitor",
                pid: 2345,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: new Date().toISOString(),
                status: "ERROR",
                exitCode: 1,
                logPath: "/tmp/stream-monitor.log",
                lastErrorMsg: "socket closed",
                startedByEmail: "admin@example.com",
              },
            },
          ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Running")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /start stream monitor/i }));

    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /start stream monitor/i }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
    });
    expect(
      (screen.getByRole("button", { name: /stop pipeline monitor/i }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    await act(async () => {
      resolveStart?.(jsonResponse({ ok: true }));
      await Promise.resolve();
    });
  });

  it("stops a running worker from the footer details panel", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/workers/pipeline-monitor/stop") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ ok: true });
      }
      if (url === "/api/admin/workers") {
        const workerCalls = fetchMock.mock.calls.filter(
          ([callUrl]) => String(callUrl) === "/api/admin/workers"
        ).length;
        const stopping = workerCalls > 1;
        return jsonResponse({
          workers: [
            {
              name: "pipeline-monitor",
              label: "Pipeline monitor",
              paused: false,
              latest: {
                id: "worker-1",
                name: "pipeline-monitor",
                pid: 1234,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: null,
                status: stopping ? "STOPPING" : "RUNNING",
                exitCode: null,
                logPath: "/tmp/pipeline-monitor.log",
                lastErrorMsg: null,
                startedByEmail: "admin@example.com",
              },
            },
          ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Running")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop pipeline monitor/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/admin/workers/pipeline-monitor/stop" &&
            init?.method === "POST"
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === "/api/admin/workers")
          .length
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it("does not stop a running worker when confirmation is cancelled", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/admin/workers") {
        return jsonResponse({
          workers: [
            {
              name: "pipeline-monitor",
              label: "Pipeline monitor",
              paused: false,
              latest: {
                id: "worker-1",
                name: "pipeline-monitor",
                pid: 1234,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: null,
                status: "RUNNING",
                exitCode: null,
                logPath: "/tmp/pipeline-monitor.log",
                lastErrorMsg: null,
                startedByEmail: "admin@example.com",
              },
            },
          ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Running")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop pipeline monitor/i }));

    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === "/api/admin/workers/pipeline-monitor/stop")
    ).toBe(false);
  });

  it("stops a paused worker from the footer details panel", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/workers/pipeline-monitor/stop") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ ok: true });
      }
      if (url === "/api/admin/workers") {
        return jsonResponse({
          workers: [
            {
              name: "pipeline-monitor",
              label: "Pipeline monitor",
              paused: true,
              latest: {
                id: "worker-1",
                name: "pipeline-monitor",
                pid: 1234,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: null,
                status: "RUNNING",
                exitCode: null,
                logPath: "/tmp/pipeline-monitor.log",
                lastErrorMsg: null,
                startedByEmail: "admin@example.com",
              },
            },
          ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Paused")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop pipeline monitor/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/admin/workers/pipeline-monitor/stop" &&
            init?.method === "POST"
        )
      ).toBe(true);
    });
  });

  it("clears a zombie worker from the footer details panel", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/workers/pipeline-monitor/stop") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ ok: true, cleared: "zombie" });
      }
      if (url === "/api/admin/workers") {
        const workerCalls = fetchMock.mock.calls.filter(
          ([callUrl]) => String(callUrl) === "/api/admin/workers"
        ).length;
        return jsonResponse({
          workers:
            workerCalls > 1
              ? []
              : [
                  {
                    name: "pipeline-monitor",
                    label: "Pipeline monitor",
                    paused: false,
                    latest: {
                      id: "worker-1",
                      name: "pipeline-monitor",
                      pid: 1234,
                      startedAt: new Date(Date.now() - 60_000).toISOString(),
                      stoppedAt: new Date().toISOString(),
                      status: "ZOMBIE",
                      exitCode: null,
                      logPath: "/tmp/pipeline-monitor.log",
                      lastErrorMsg: "process disappeared",
                      startedByEmail: "admin@example.com",
                    },
                  },
                ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Zombie")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear zombie status for pipeline monitor/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/admin/workers/pipeline-monitor/stop" &&
            init?.method === "POST"
        )
      ).toBe(true);
    });
  });

  it("shows a footer worker stop error inline", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/admin/workers/pipeline-monitor/stop") {
        return jsonResponse(
          { error: "No running pipeline-monitor to stop" },
          false,
          404
        );
      }
      if (url === "/api/admin/workers") {
        return jsonResponse({
          workers: [
            {
              name: "pipeline-monitor",
              label: "Pipeline monitor",
              paused: false,
              latest: {
                id: "worker-1",
                name: "pipeline-monitor",
                pid: 1234,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                stoppedAt: null,
                status: "RUNNING",
                exitCode: null,
                logPath: "/tmp/pipeline-monitor.log",
                lastErrorMsg: null,
                startedByEmail: "admin@example.com",
              },
            },
          ],
        });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("Background workers: Pipeline monitor · Running")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop pipeline monitor/i }));

    await waitFor(() => {
      expect(screen.getByText(/No running pipeline-monitor to stop/)).toBeTruthy();
    });
  });
});
