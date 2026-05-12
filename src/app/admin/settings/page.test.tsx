// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  beforeEach(() => {
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
});
