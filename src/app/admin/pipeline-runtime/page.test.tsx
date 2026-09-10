// @vitest-environment jsdom

import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PipelineRuntimePage from "./page";

vi.mock("@/components/admin/infrastructure/InfrastructureSetupStatus", () => ({
  InfrastructureSetupStatus: () => <div data-testid="infrastructure-status" />,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/notifications/client", () => ({
  notifyPanel: {
    error: vi.fn(),
  },
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PipelineRuntimePage settings hydration", () => {
  it("loads settings once in StrictMode and saves the edited run directory", async () => {
    const storedRunDirectory = "/tmp/seqdesk-runs-stored";
    const editedRunDirectory = "/tmp/seqdesk-runs-edited";
    let executionGetCount = 0;
    let savedSettings: Record<string, unknown> | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url === "/api/admin/settings/pipelines/execution") {
          if (method === "POST") {
            savedSettings = JSON.parse(String(init?.body)) as Record<
              string,
              unknown
            >;
            return jsonResponse({ success: true, settings: savedSettings });
          }

          executionGetCount += 1;
          return jsonResponse({
            settings: {
              pipelineRunDir: storedRunDirectory,
              pipelineOverrides: {},
            },
          });
        }

        if (url === "/api/admin/settings/pipelines") {
          return jsonResponse({ pipelines: [] });
        }

        return jsonResponse({});
      }),
    );

    render(
      <StrictMode>
        <PipelineRuntimePage />
      </StrictMode>,
    );

    const runDirectoryInput = (await screen.findByLabelText(
      "Pipeline Run Directory",
    )) as HTMLInputElement;
    expect(runDirectoryInput.value).toBe(storedRunDirectory);
    expect(executionGetCount).toBe(1);
    expect(screen.getByRole("heading", { level: 1, name: "Where pipelines run" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "report analysis environments" }).getAttribute("href")).toBe("/admin/settings/analysis");
    expect(screen.getByRole("link", { name: "pipeline store" }).getAttribute("href")).toBe("/admin/settings/pipelines");

    fireEvent.change(runDirectoryInput, {
      target: { value: editedRunDirectory },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save Runtime Settings" }),
    );

    await waitFor(() => {
      expect(savedSettings?.pipelineRunDir).toBe(editedRunDirectory);
    });
    expect(runDirectoryInput.value).toBe(editedRunDirectory);
  });

  it("blocks default settings after a failed load and recovers with a retry", async () => {
    let unavailable = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/admin/settings/pipelines/execution") {
        if (unavailable) return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 });
        return jsonResponse({ settings: { pipelineRunDir: "/original-runs" } });
      }
      return jsonResponse({ pipelines: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PipelineRuntimePage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Runtime Settings" })).toBeNull();
    unavailable = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByLabelText("Pipeline Run Directory") as HTMLInputElement).value).toBe("/original-runs");
    expect(fetchMock.mock.calls).toHaveLength(4);
  });

  it("rejects malformed successful responses instead of showing editable defaults", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    render(<PipelineRuntimePage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Runtime Settings" })).toBeNull();
  });
});
