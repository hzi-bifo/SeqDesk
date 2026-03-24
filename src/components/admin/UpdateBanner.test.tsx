// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: mocks.useSession,
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

import { UpdateBanner } from "./UpdateBanner";

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("UpdateBanner", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    sessionStorage.clear();
    mocks.useSession.mockReturnValue({
      data: {
        user: {
          role: "FACILITY_ADMIN",
        },
      },
    });
  });

  it("does not render or fetch for non-admin users", () => {
    mocks.useSession.mockReturnValue({
      data: {
        user: {
          role: "USER",
        },
      },
    });

    render(<UpdateBanner />);

    expect(screen.queryByText(/SeqDesk/)).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("renders an available update and can be dismissed", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        currentVersion: "1.1.79",
        updateAvailable: true,
        databaseCompatible: true,
        latest: {
          version: "1.1.80",
          releaseNotes: "Pipeline fixes",
        },
      })
    );

    render(<UpdateBanner />);

    expect(await screen.findByText(/SeqDesk 1.1.80/)).toBeTruthy();
    expect(screen.getByText(/Pipeline fixes/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Update now" }).getAttribute("href")).toBe(
      "/admin/settings"
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.queryByText(/SeqDesk 1.1.80/)).toBeNull();
    });
    expect(sessionStorage.getItem("update-banner-dismissed")).toBe("1.1.80");
  });

  it("hides updates that were already dismissed for the same version", async () => {
    sessionStorage.setItem("update-banner-dismissed", "1.1.80");
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        currentVersion: "1.1.79",
        updateAvailable: true,
        databaseCompatible: true,
        latest: {
          version: "1.1.80",
        },
      })
    );

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith("/api/admin/updates");
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    });
  });

  it("shows restart pending state when the latest version is already installed", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        currentVersion: "1.1.79",
        installedVersion: "1.1.80",
        restartRequired: true,
        updateAvailable: true,
        databaseCompatible: true,
        latest: {
          version: "1.1.80",
          releaseNotes: "Pipeline fixes",
        },
      })
    );

    render(<UpdateBanner />);

    expect(await screen.findByText(/Restart pending/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View status" }).getAttribute("href")).toBe(
      "/admin/settings"
    );
    expect(screen.queryByText(/Pipeline fixes/)).toBeNull();
  });
});
