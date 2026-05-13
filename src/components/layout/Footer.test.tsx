// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("Footer admin activity", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === "/api/admin/workers") {
          return jsonResponse({ workers: [] });
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
});
