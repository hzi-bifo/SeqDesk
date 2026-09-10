// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PipelineRuntimePage from "./page";

vi.mock("@/lib/modules", () => ({ useModuleEnabled: () => false }));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/notifications/client", () => ({ notifyPanel: { error: vi.fn() } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("loads runtime settings without running probes, and only runs checks after an explicit click", async () => {
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/admin/settings/pipelines/execution") return reply({ settings: { pipelineRunDir: "/saved-runs", condaPath: "/conda", pipelineOverrides: {} } });
    if (url === "/api/admin/settings/pipelines") return reply({ pipelines: [] });
    if (url === "/api/admin/settings/sequencing-files") return reply({ dataBasePath: "/data", config: { allowedExtensions: [".fastq.gz"] } });
    if (url === "/api/admin/settings/sequencing-files/test" && init?.method === "POST") return reply({ valid: true, message: "Directory accessible" });
    if (url === "/api/admin/settings/pipelines/test-setting" && init?.method === "POST") return reply({ success: true, message: "Software available" });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<StrictMode><PipelineRuntimePage /></StrictMode>);
  const path = await screen.findByLabelText("Pipeline Run Directory");
  await screen.findByText("Storage & pipeline checks");
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  const beforeEdit = fetchMock.mock.calls.length;
  fireEvent.change(path, { target: { value: "/unsaved-runs" } });
  expect(fetchMock.mock.calls).toHaveLength(beforeEdit);
  fireEvent.click(screen.getByRole("button", { name: "Run storage and pipeline checks" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3));
  const probe = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith("/test-setting") && JSON.parse(String(init?.body)).setting === "pipelineRunDir");
  expect(JSON.parse(String(probe?.[1]?.body)).value).toBe("/saved-runs");
  expect((path as HTMLInputElement).value).toBe("/unsaved-runs");
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/pipelines/runs"))).toBe(false);
});
