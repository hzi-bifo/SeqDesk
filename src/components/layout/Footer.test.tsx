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

describe("Footer admin activity", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: "pipeline-db:metaxpath:db-bundle",
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
        }),
      }))
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
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: "pipeline-db:metaxpath:db-bundle",
              label: "MetaxPath Database Bundle (metaxpath)",
              state: "error",
              error: "curl failed with exit code 7",
              targetPath: "/data/metaxpath_db_bundle.tar",
              logExcerpt: ["curl: could not connect"],
            },
          ],
        }),
      }))
    );

    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/curl failed with exit code 7/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(screen.getByText(/Target: \/data\/metaxpath_db_bundle.tar/)).toBeTruthy();
    expect(screen.getByText(/curl: could not connect/)).toBeTruthy();
  });
});
