// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

vi.mock("@/lib/notifications/client", () => ({
  notifyPanel: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  refreshPanelNotifications: vi.fn(),
}));

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status || 200,
    headers: { "content-type": "application/json" },
  });
}

const appliedGemmaStatus = {
  seeded: true,
  fixtureState: "applied",
  fixtureIssues: [],
  orderNumber: "DEV-GEMMA-ONT-001",
  orderId: "order-1",
  orderStatus: "SUBMITTED",
  studyId: "study-1",
  samplesCount: 5,
  readsCount: 5,
  sourceUrl: "https://research.example/gemma.tar.gz",
  sha256: "sha256",
};

const missingGemmaStatus = {
  seeded: false,
  fixtureState: "missing",
  fixtureIssues: [],
  orderNumber: "DEV-GEMMA-ONT-001",
  orderId: null,
  orderStatus: null,
  studyId: null,
  samplesCount: 0,
  readsCount: 0,
  sourceUrl: "https://research.example/gemma.tar.gz",
  sha256: "sha256",
};

const hostedInstallProfileResponse = {
  profile: {
    id: "hosted-profile-1",
    name: "Hosted Profile",
    version: "1.0.0",
    source: "database",
  },
  profileRegistryUrl: "https://profiles.example/registry",
  profileCodeEnvName: "SEQDESK_PROFILE_CODE",
  profileCodeEnvAvailable: false,
};

function createSettingsFetchMock(
  gemmaStatus: unknown,
  installProfile: unknown = hostedInstallProfileResponse
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/admin/install-profile/reload") {
      return jsonResponse(installProfile);
    }
    if (url === "/api/admin/seed/dummy-data") {
      return jsonResponse({ seeded: false, ordersCount: 0, dummyDataEnabled: false });
    }
    if (url === "/api/admin/seed/example-datasets/gemma-metaxpath") {
      return jsonResponse(gemmaStatus);
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
        if (url === "/api/admin/install-profile/reload") {
          return jsonResponse(hostedInstallProfileResponse);
        }
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

  it("shows the Gemma dataset as applied with green status styling", async () => {
    vi.stubGlobal("fetch", createSettingsFetchMock(appliedGemmaStatus));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Applied")).toBeTruthy();
    });
    expect(
      screen.getByText(
        "5 ONT MinION Mk1D samples loaded in sequencing order DEV-GEMMA-ONT-001."
      )
    ).toBeTruthy();
    expect(screen.getByText("Re-seed")).toBeTruthy();

    const card = screen
      .getByText("Gemma Nanopore MetaxPath dataset")
      .closest(".rounded-lg");
    expect(card?.className).toContain("border-emerald-200");
    expect(card?.className).toContain("bg-emerald-50");
  });

  it("shows changed Gemma fixture integrity with amber status and issues", async () => {
    vi.stubGlobal(
      "fetch",
      createSettingsFetchMock({
        ...appliedGemmaStatus,
        fixtureState: "changed",
        fixtureIssues: [
          "Expected 5 samples, found 4.",
          "One or more read file links no longer point to the fixture reads folder.",
        ],
        samplesCount: 4,
        readsCount: 4,
      })
    );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Changed")).toBeTruthy();
    });
    expect(
      screen.getByText(
        "Seeded dataset exists but no longer matches the original fixture."
      )
    ).toBeTruthy();
    expect(screen.getByText("Expected 5 samples, found 4.")).toBeTruthy();
    expect(screen.getByText("Re-seed")).toBeTruthy();

    const card = screen
      .getByText("Gemma Nanopore MetaxPath dataset")
      .closest(".rounded-lg");
    expect(card?.className).toContain("border-amber-200");
    expect(card?.className).toContain("bg-amber-50");
  });

  it("shows missing Gemma fixture as a neutral not-loaded state", async () => {
    vi.stubGlobal("fetch", createSettingsFetchMock(missingGemmaStatus));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Not loaded")).toBeTruthy();
    });
    expect(screen.getByText("Load dataset")).toBeTruthy();
    expect(
      screen.queryByText(
        "Seeded dataset exists but no longer matches the original fixture."
      )
    ).toBeNull();

    const card = screen
      .getByText("Gemma Nanopore MetaxPath dataset")
      .closest(".rounded-lg");
    expect(card?.className).toContain("border-border");
    expect(card?.className).toContain("bg-white");
  });

  it("hides the Gemma dataset section when no hosted profile is applied", async () => {
    vi.stubGlobal(
      "fetch",
      createSettingsFetchMock(appliedGemmaStatus, {
        profile: null,
        profileRegistryUrl: null,
        profileCodeEnvName: null,
        profileCodeEnvAvailable: false,
      })
    );

    render(<SettingsPage />);

    // The Demo data section ("Load dummy data") still renders, so once it is
    // present the page has settled and the Gemma section is confirmed absent.
    await waitFor(() => {
      expect(screen.getByText("Load dummy data")).toBeTruthy();
    });
    expect(
      screen.queryByText("Gemma Nanopore MetaxPath dataset")
    ).toBeNull();
  });

  it("lets admins retry or clear failed update state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/seed/dummy-data") {
        return jsonResponse({ seeded: false });
      }
      if (url === "/api/admin/seed/example-datasets/gemma-metaxpath") {
        return jsonResponse(appliedGemmaStatus);
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
          state: {
            phase: "error",
            startedAt: "2026-05-20T10:00:00.000Z",
            updatedAt: "2026-05-20T10:01:00.000Z",
            previousRelease: "/srv/seqdesk/releases/1.1.104",
            targetRelease: "/srv/seqdesk/releases/1.1.105",
            activeRelease: "/srv/seqdesk/releases/1.1.105",
            targetVersion: "1.1.105",
          },
          runningVersion: "1.1.104",
          installedVersion: "1.1.105",
        });
      }
      if (url === "/api/admin/updates/install") {
        return jsonResponse({ success: true, repair: true, version: "1.1.105" });
      }
      if (url === "/api/admin/updates/rollback") {
        return jsonResponse({ success: true, rollback: true });
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

    // The page fans out several async fetches before the failed-update controls
    // render; give the initial load extra headroom so a slow CI run (coverage +
    // parallel suites) doesn't trip the default 1s waitFor timeout.
    await waitFor(
      () => {
        expect(screen.getByText("Retry update")).toBeTruthy();
      },
      { timeout: 5000 }
    );
    expect(screen.getByText("Roll back release")).toBeTruthy();
    expect(screen.getByText("Prisma CLI Version : 7.8.0")).toBeTruthy();

    fireEvent.click(screen.getByText("Roll back release"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/updates/rollback", {
        method: "POST",
      });
    });

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
