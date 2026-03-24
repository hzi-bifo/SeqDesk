// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getDemoEntryPath: vi.fn(),
  postDemoFrameMessage: vi.fn(),
}));

vi.mock("@/lib/demo/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/demo/client")>("@/lib/demo/client");
  return {
    ...actual,
    getDemoEntryPath: mocks.getDemoEntryPath,
    postDemoFrameMessage: mocks.postDemoFrameMessage,
  };
});

import { DemoBanner } from "./DemoBanner";

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("DemoBanner", () => {
  let assignMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getDemoEntryPath.mockReturnValue("/demo/admin/embed");
    assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign: assignMock,
      },
    });
  });

  it("resets the demo and posts embedded frame messages on success", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    render(<DemoBanner embeddedMode demoExperience="facility" />);

    expect(screen.getByText("Facility Demo")).toBeTruthy();
    fireEvent.click(screen.getByTestId("demo-reset-button"));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith("/api/demo/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          demoExperience: "facility",
        }),
      });
    });
    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("/demo/admin/embed");
    });
    expect(mocks.postDemoFrameMessage).toHaveBeenNthCalledWith(1, "seqdesk-demo-reset", {
      demoExperience: "facility",
    });
    expect(mocks.postDemoFrameMessage).toHaveBeenNthCalledWith(2, "seqdesk-demo-loading");
  });

  it("redirects without posting embedded messages when not embedded", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    mocks.getDemoEntryPath.mockReturnValue("/demo");

    render(<DemoBanner embeddedMode={false} demoExperience="researcher" />);

    expect(screen.getByText("Researcher Demo")).toBeTruthy();
    fireEvent.click(screen.getByTestId("demo-reset-button"));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("/demo");
    });
    expect(mocks.postDemoFrameMessage).not.toHaveBeenCalled();
  });

  it("shows an error and re-enables the button when reset fails", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Reset failed",
        },
        false
      )
    );

    render(<DemoBanner embeddedMode demoExperience="facility" />);

    const button = screen.getByTestId("demo-reset-button");
    fireEvent.click(button);

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText("Reset failed")).toBeTruthy();
    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
