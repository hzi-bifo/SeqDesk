// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));

import { FieldHelpProvider, useFieldHelp } from "./FieldHelpContext";

describe("FieldHelpContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePathname.mockReturnValue("/orders");
  });

  it("stores field help state and clears it when the pathname changes", async () => {
    const field = {
      type: "text",
      name: "sampleName",
      label: "Sample Name",
      required: false,
      visible: true,
    } as never;

    const { result, rerender } = renderHook(() => useFieldHelp(), {
      wrapper: ({ children }) => <FieldHelpProvider>{children}</FieldHelpProvider>,
    });

    act(() => {
      result.current.setFocusedField(field);
      result.current.setValidationError("Required");
    });

    expect(result.current.focusedField).toEqual(field);
    expect(result.current.validationError).toBe("Required");

    mocks.usePathname.mockReturnValue("/studies");
    rerender();

    await waitFor(() => {
      expect(result.current.focusedField).toBeNull();
    });
    expect(result.current.validationError).toBeNull();
  });

  it("throws when the hook is used outside the provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useFieldHelp())).toThrow(
      "useFieldHelp must be used within a FieldHelpProvider"
    );

    consoleError.mockRestore();
  });
});
