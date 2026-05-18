// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status || 200,
    headers: { "content-type": "application/json" },
  });
}

describe("admin settings seed status", () => {
  const confirmMock = vi.fn();

  beforeEach(() => {
    confirmMock.mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/admin/seed/dummy-data") {
          return jsonResponse(
            {
              error:
                "Data base path is not writable by the SeqDesk server process: /net/broker/devphil/seqdesk_data",
              dataBasePath: "/net/broker/devphil/seqdesk_data",
            },
            { status: 400 }
          );
        }
        if (url === "/api/admin/seed/example-datasets/gemma-metaxpath") {
          return jsonResponse(
            {
              error:
                "Data base path is not writable by the SeqDesk server process: /net/broker/devphil/seqdesk_data",
              dataBasePath: "/net/broker/devphil/seqdesk_data",
            },
            { status: 400 }
          );
        }
        if (url === "/api/admin/config/status") {
          return jsonResponse({ config: {}, sources: {} });
        }
        if (url === "/api/admin/settings/access") {
          return jsonResponse({ orderNotesEnabled: true });
        }
        if (url === "/api/admin/settings/telemetry") {
          return jsonResponse({
            enabled: false,
            endpoint: "",
            intervalHours: 1,
            instanceId: null,
            clientTokenConfigured: false,
            lastSentAt: null,
            lastError: null,
            lastStatus: null,
            promptDismissed: true,
          });
        }
        if (url === "/api/admin/updates/progress") {
          return jsonResponse({ status: null });
        }
        if (url.startsWith("/api/admin/updates")) {
          return jsonResponse({
            currentVersion: "1.1.94",
            runningVersion: "1.1.94",
            installedVersion: "1.1.94",
            updateAvailable: false,
          });
        }
        if (url === "/api/admin/settings/pipelines/test-setting") {
          return jsonResponse({ versions: {} });
        }
        return jsonResponse({});
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders storage errors instead of leaving seed cards in checking state", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getAllByText(/Data base path is not writable by the SeqDesk server process/)
          .length
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Checking current state…")).toBeNull();
    expect(screen.queryByText("Checking current state...")).toBeNull();
  });

  it("lets admins retry or clear failed update state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/seed/dummy-data") {
        return jsonResponse({ seeded: false });
      }
      if (url === "/api/admin/seed/example-datasets/gemma-metaxpath") {
        return jsonResponse({
          seeded: true,
          orderNumber: "DEV-GEMMA-ONT-001",
          orderId: "order-1",
          studyId: "study-1",
          samplesCount: 5,
          readsCount: 5,
        });
      }
      if (url === "/api/admin/config/status") {
        return jsonResponse({ config: {}, sources: {} });
      }
      if (url === "/api/admin/settings/access") {
        return jsonResponse({ orderNotesEnabled: true });
      }
      if (url === "/api/admin/settings/telemetry") {
        return jsonResponse({
          enabled: false,
          endpoint: "",
          intervalHours: 1,
          instanceId: null,
          clientTokenConfigured: false,
          lastSentAt: null,
          lastError: null,
          lastStatus: null,
          promptDismissed: true,
        });
      }
      if (url === "/api/admin/updates/progress" && init?.method === "DELETE") {
        return jsonResponse({ success: true });
      }
      if (url === "/api/admin/updates/progress") {
        return jsonResponse({
          status: {
            status: "error",
            progress: 0,
            message: "Update failed",
            error: "Prisma CLI Version : 7.8.0",
            targetVersion: "1.1.105",
          },
          runningVersion: "1.1.104",
          installedVersion: "1.1.105",
        });
      }
      if (url === "/api/admin/updates/install") {
        return jsonResponse({ success: true, repair: true, version: "1.1.105" });
      }
      if (url.startsWith("/api/admin/updates")) {
        return jsonResponse({
          currentVersion: "1.1.104",
          runningVersion: "1.1.104",
          installedVersion: "1.1.105",
          restartRequired: true,
          updateAvailable: false,
          latest: { version: "1.1.105" },
        });
      }
      if (url === "/api/admin/settings/pipelines/test-setting") {
        return jsonResponse({ versions: {} });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Retry update")).toBeTruthy();
    });
    expect(screen.getByText("Prisma CLI Version : 7.8.0")).toBeTruthy();

    fireEvent.click(screen.getByText("Retry update"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/updates/install",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ repair: true, targetVersion: "1.1.105" }),
        })
      );
    });

    fireEvent.click(screen.getByText("Clear failed status"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/updates/progress", {
        method: "DELETE",
      });
    });
  });
});
