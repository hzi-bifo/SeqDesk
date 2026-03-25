// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODULE_STATES } from "./types";
import { ModuleGate, useModuleGate } from "./ModuleGate";
import { ModuleProvider, useModules } from "./ModuleContext";

const fetchMock = vi.fn();

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <ModuleProvider>{children}</ModuleProvider>;
}

describe("module UI helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
  });

  it("loads module state, updates it, toggles global disable, and refreshes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          modules: {
            ...DEFAULT_MODULE_STATES,
            "funding-info": true,
          },
          globalDisabled: false,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          modules: {
            ...DEFAULT_MODULE_STATES,
            "funding-info": false,
          },
          globalDisabled: false,
        })
      );

    const { result } = renderHook(() => useModules(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isModuleEnabled("funding-info")).toBe(true);
    expect(result.current.getModule("ai-validation")?.id).toBe("ai-validation");

    await act(async () => {
      await result.current.setModuleEnabled("funding-info", false);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/modules",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ moduleId: "funding-info", enabled: false }),
      })
    );
    expect(result.current.moduleStates["funding-info"]).toBe(false);

    await act(async () => {
      await result.current.setGlobalDisabled(true);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/modules",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ globalDisabled: true }),
      })
    );
    expect(result.current.globalDisabled).toBe(true);
    expect(result.current.isModuleEnabled("ai-validation")).toBe(false);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.globalDisabled).toBe(false);
    expect(result.current.moduleStates["funding-info"]).toBe(false);
  });

  it("falls back to defaults and reverts optimistic updates when writes fail", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false));

    const { result } = renderHook(() => useModules(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.moduleStates).toEqual(DEFAULT_MODULE_STATES);
    expect(result.current.globalDisabled).toBe(false);

    await act(async () => {
      await expect(
        result.current.setModuleEnabled("funding-info", true)
      ).rejects.toThrow("Failed to update module");
    });

    await waitFor(() => {
      expect(result.current.moduleStates["funding-info"]).toBe(false);
    });

    await act(async () => {
      await expect(result.current.setGlobalDisabled(true)).rejects.toThrow(
        "Failed to update global setting"
      );
    });

    await waitFor(() => {
      expect(result.current.globalDisabled).toBe(false);
    });
  });

  it("renders ModuleGate branches and exposes hook state", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        modules: {
          ...DEFAULT_MODULE_STATES,
          "funding-info": false,
          "ai-validation": true,
        },
        globalDisabled: false,
      })
    );

    function HookProbe() {
      const { enabled, module } = useModuleGate("ai-validation");
      return (
        <div data-testid="hook-probe" data-enabled={String(enabled)}>
          {module?.id}
        </div>
      );
    }

    render(
      <ModuleProvider>
        <ModuleGate moduleId="ai-validation">
          <div>Enabled Child</div>
        </ModuleGate>
        <ModuleGate moduleId="funding-info" fallback="hide">
          <div>Hidden Child</div>
        </ModuleGate>
        <ModuleGate moduleId="funding-info" fallback={<div>Custom Fallback</div>}>
          <div>Ignored Child</div>
        </ModuleGate>
        <ModuleGate moduleId="funding-info" adminView>
          <div>Admin Child</div>
        </ModuleGate>
        <ModuleGate moduleId="funding-info">
          <div>User Child</div>
        </ModuleGate>
        <HookProbe />
      </ModuleProvider>
    );

    expect(await screen.findByText("Enabled Child")).toBeTruthy();
    expect(screen.queryByText("Hidden Child")).toBeNull();
    expect(screen.getByText("Custom Fallback")).toBeTruthy();
    expect(screen.getByText("Admin Child")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Modules" }).getAttribute("href")).toBe(
      "/admin/modules"
    );
    expect(screen.getByText("This feature is not currently available.")).toBeTruthy();
    expect(screen.getByTestId("hook-probe").getAttribute("data-enabled")).toBe("true");
    expect(screen.getByTestId("hook-probe").textContent).toBe("ai-validation");
  });
});
