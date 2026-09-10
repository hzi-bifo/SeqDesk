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

function createDummyDataFetchMock(initiallySeeded: boolean) {
  let seeded = initiallySeeded;
  const fallbackFetch = createSettingsFetchMock(missingGemmaStatus);

  return vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === "/api/admin/seed/dummy-data") {
        const method = init?.method || "GET";
        if (method === "POST") {
          seeded = true;
          return jsonResponse({
            success: true,
            ordersCreated: 4,
            samplesCreated: 10,
            readsCreated: 12,
            filesCreated: 22,
            dataPath: "seed-dummy/admin-1",
            platform: {
              instrumentModel: "NovaSeq 6000/X",
              pairedEnd: true,
              fromConfiguredDevice: false,
            },
          });
        }
        if (method === "DELETE") {
          seeded = false;
          return jsonResponse({
            success: true,
            ordersDeleted: 4,
            filesRemoved: true,
          });
        }
        return jsonResponse({
          seeded,
          ordersCount: seeded ? 4 : 0,
          dummyDataEnabled: seeded,
        });
      }

      return fallbackFetch(input);
    }
  );
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

  it("describes the runnable two-study, four-order FASTQ dataset", async () => {
    vi.stubGlobal("fetch", createDummyDataFetchMock(false));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/two realistic seeded studies and four sequencing orders/)
      ).toBeTruthy();
    });
    expect(
      screen.getByText(
        /Every seeded sample is linked to actual gzipped FASTQ files on disk containing synthetic reads/
      )
    ).toBeTruthy();
  });

  it("keeps status visible but disables installation when storage is unavailable", async () => {
    const fallbackFetch = createSettingsFetchMock(missingGemmaStatus);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input) === "/api/admin/seed/dummy-data" &&
          (init?.method || "GET") === "GET"
        ) {
          return jsonResponse({
            seeded: false,
            ordersCount: 0,
            dummyDataEnabled: false,
            storageReady: false,
            storageError: "Data base path not configured",
          });
        }
        return fallbackFetch(input);
      })
    );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Data base path not configured")).toBeTruthy();
    });
    expect(
      (screen.getByLabelText("Load dummy data") as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      screen.getByText(
        "Configure a writable sequencing data path before loading dummy data."
      )
    ).toBeTruthy();
  });

  it("loads dummy data from the switch and refreshes the seeded state", async () => {
    const fetchMock = createDummyDataFetchMock(false);
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage />);

    const toggle = await waitFor(() => {
      const input = screen.getByLabelText("Load dummy data") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.checked).toBe(false);
      return input;
    });

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/seed/dummy-data",
        { method: "POST" }
      );
      expect(
        (screen.getByLabelText("Load dummy data") as HTMLInputElement).checked
      ).toBe(true);
    });
    expect(screen.getByText("4 seeded orders currently loaded for your profile.")).toBeTruthy();
  });

  it("confirms before wiping dummy data and refreshes the empty state", async () => {
    const fetchMock = createDummyDataFetchMock(true);
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage />);

    const toggle = await waitFor(() => {
      const input = screen.getByLabelText("Load dummy data") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.checked).toBe(true);
      return input;
    });

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText("Wipe seeded dummy data?")).toBeTruthy();
    });
    expect(
      screen.getByText(/the two seeded studies, all linked samples and reads/)
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Wipe seeded data" })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/seed/dummy-data",
        { method: "DELETE" }
      );
      expect(
        (screen.getByLabelText("Load dummy data") as HTMLInputElement).checked
      ).toBe(false);
    });
    expect(
      screen.getByText("No seeded data present. Toggle on to create the example dataset.")
    ).toBeTruthy();
  });

  it("keeps orphaned FASTQs visible and lets the admin retry cleanup", async () => {
    let cleanupPending = true;
    const fallbackFetch = createSettingsFetchMock(missingGemmaStatus);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/admin/seed/dummy-data") {
          if ((init?.method || "GET") === "DELETE") {
            cleanupPending = false;
            return jsonResponse({
              success: true,
              ordersDeleted: 0,
              filesRemoved: true,
            });
          }
          return jsonResponse({
            seeded: false,
            ordersCount: 0,
            filesPresent: cleanupPending,
            cleanupPending,
            storageReady: true,
          });
        }
        return fallbackFetch(input);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage />);

    const toggle = await waitFor(() => {
      expect(
        screen.getByText(
          "Database rows are gone, but generated-file cleanup is still pending at the original storage path."
        )
      ).toBeTruthy();
      const input = screen.getByLabelText(
        "Load dummy data"
      ) as HTMLInputElement;
      expect(input.checked).toBe(true);
      return input;
    });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(
        screen.getByText(/database fixture is already gone/i)
      ).toBeTruthy();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Wipe seeded data" })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/seed/dummy-data",
        { method: "DELETE" }
      );
      expect(
        (screen.getByLabelText("Load dummy data") as HTMLInputElement).checked
      ).toBe(false);
    });
  });

  it("blocks a pending cleanup retry while the original storage path is unavailable", async () => {
    const fallbackFetch = createSettingsFetchMock(missingGemmaStatus);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/admin/seed/dummy-data") {
          return jsonResponse({
            seeded: false,
            databasePresent: false,
            ordersCount: 0,
            filesPresent: false,
            cleanupPending: true,
            storageReady: true,
            fixtureStorageReady: false,
            fixtureStorageError:
              "The original demo-data storage path is unavailable.",
          });
        }
        return fallbackFetch(input);
      })
    );

    render(<SettingsPage />);

    await waitFor(() => {
      const toggle = screen.getByLabelText(
        "Load dummy data"
      ) as HTMLInputElement;
      expect(toggle.checked).toBe(true);
      expect(toggle.disabled).toBe(true);
    });
    expect(
      screen.getByText(
        "The original demo-data storage path is unavailable."
      )
    ).toBeTruthy();
  });

  it("shows a storage-path conflict and disables the demo-data switch", async () => {
    const fallbackFetch = createSettingsFetchMock(missingGemmaStatus);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/admin/seed/dummy-data") {
          return jsonResponse({
            seeded: true,
            databasePresent: true,
            ordersCount: 4,
            studiesCount: 2,
            filesPresent: false,
            cleanupPending: true,
            storagePathConflict: true,
            storageReady: true,
            fixtureStorageReady: true,
          });
        }
        return fallbackFetch(input);
      })
    );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Demo-data records disagree about where the generated files are stored."
        )
      ).toBeTruthy();
    });
    expect(
      screen.getByText(
        "Resolve the conflicting original storage paths before loading or removing demo data."
      )
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Load dummy data") as HTMLInputElement).disabled
    ).toBe(true);
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
