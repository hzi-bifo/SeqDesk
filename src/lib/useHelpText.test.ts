// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useHelpText } from "./useHelpText";

const STORAGE_KEY = "seqdesk-help-text-visible";

afterEach(() => {
  localStorage.clear();
});

describe("useHelpText", () => {
  it("loads with help text visible by default", async () => {
    const { result } = renderHook(() => useHelpText());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.showHelpText).toBe(true);
  });

  it("restores the saved help text preference from localStorage", async () => {
    localStorage.setItem(STORAGE_KEY, "false");

    const { result } = renderHook(() => useHelpText());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.showHelpText).toBe(false);
  });

  it("updates state and localStorage when toggling visibility", async () => {
    const { result } = renderHook(() => useHelpText());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      result.current.toggleHelpText();
    });
    expect(result.current.showHelpText).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");

    act(() => {
      result.current.showHelpTextAgain();
    });
    expect(result.current.showHelpText).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");

    act(() => {
      result.current.hideHelpText();
    });
    expect(result.current.showHelpText).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });
});
