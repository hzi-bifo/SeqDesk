// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisiblePolling } from "./polling";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startVisiblePolling", () => {
  it("polls on the interval while the tab is visible", () => {
    const task = vi.fn();
    const stop = startVisiblePolling(task, 5000);

    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15_000);
    expect(task).toHaveBeenCalledTimes(3);

    stop();
  });

  it("stops polling while the tab is hidden", () => {
    const task = vi.fn();
    const stop = startVisiblePolling(task, 5000);

    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(task).toHaveBeenCalledTimes(1);

    stop();
  });

  it("runs once immediately when the tab becomes visible again", () => {
    const task = vi.fn();
    const stop = startVisiblePolling(task, 5000);

    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(task).toHaveBeenCalledTimes(0);

    setVisibility("visible");
    expect(task).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledTimes(2);

    stop();
  });

  it("stops polling and detaches its listener once stopped", () => {
    const task = vi.fn();
    const stop = startVisiblePolling(task, 5000);

    stop();

    vi.advanceTimersByTime(60_000);
    setVisibility("hidden");
    setVisibility("visible");
    vi.advanceTimersByTime(60_000);

    expect(task).not.toHaveBeenCalled();
  });
});
