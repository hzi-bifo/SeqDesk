// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_DATABASE_WAKING_CODE,
  DEMO_DATABASE_WAKING_MESSAGE,
} from "@/lib/demo/bootstrap-errors";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  postDemoFrameMessage: vi.fn(),
  useSearchParams: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: mocks.useSession,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: mocks.useSearchParams,
}));

vi.mock("@/lib/demo/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/demo/client")>(
    "@/lib/demo/client"
  );
  return {
    ...actual,
    postDemoFrameMessage: mocks.postDemoFrameMessage,
  };
});

import { DemoBootstrapClient } from "./DemoBootstrapClient";

const DATABASE_RETRY_DELAYS_MS = [2_000, 3_000, 5_000, 7_000, 8_000, 8_000];

function bootstrapResponse(
  status: number,
  payload: unknown = {},
  headers: Record<string, string> = {}
): Response {
  return {
    headers: new Headers(headers),
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function databaseWakingResponse(): Response {
  return bootstrapResponse(
    503,
    {
      code: DEMO_DATABASE_WAKING_CODE,
      error: DEMO_DATABASE_WAKING_MESSAGE,
      retryable: true,
    },
    { "Retry-After": "2" }
  );
}

describe("DemoBootstrapClient", () => {
  let replaceMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
    mocks.useSession.mockReturnValue({ data: null, status: "unauthenticated" });
    replaceMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        replace: replaceMock,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps showing a waiting state and continues when the database wakes", async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(databaseWakingResponse())
      .mockResolvedValueOnce(bootstrapResponse(200));

    render(<DemoBootstrapClient demoExperience="facility" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Waking the demo database")).toBeTruthy();
    expect(screen.queryByText("Unable to start the demo")).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(replaceMock).toHaveBeenCalledWith("/orders");
  });

  it("keeps the landing-page iframe in its loading state while retrying", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(databaseWakingResponse());

    render(<DemoBootstrapClient embedded demoExperience="facility" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.postDemoFrameMessage).toHaveBeenCalledWith("seqdesk-demo-loading");
    expect(mocks.postDemoFrameMessage).toHaveBeenCalledWith("seqdesk-demo-loading", {
      demoExperience: "facility",
      message: DEMO_DATABASE_WAKING_MESSAGE,
      phase: "database",
    });
    expect(mocks.postDemoFrameMessage).not.toHaveBeenCalledWith(
      "seqdesk-demo-error",
      expect.anything()
    );
  });

  it("shows a friendly error only after all database wake-up retries fail", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(async () => databaseWakingResponse());

    render(<DemoBootstrapClient demoExperience="researcher" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    for (const delayMs of DATABASE_RETRY_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delayMs);
      });
    }

    expect(mocks.fetch).toHaveBeenCalledTimes(DATABASE_RETRY_DELAYS_MS.length + 1);
    expect(screen.getByText("Unable to start the demo")).toBeTruthy();
    expect(
      screen.getByText(
        "The demo database is taking longer than expected. Please try again."
      )
    ).toBeTruthy();
  });
});
