// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CancelImportButton } from "./CancelImportButton";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("requires confirmation and shows stopping after the request", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
  vi.stubGlobal("fetch", fetch);
  render(<CancelImportButton jobId="job" status="running" />);
  fireEvent.click(screen.getByText("Stop download"));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Confirm cancellation"));
  await screen.findByText("Stopping…");
  expect(fetch).toHaveBeenCalledWith("/api/workbench/imports/job/cancel", { method: "POST" });
});
it("does not offer cancellation for finished jobs", () => {
  render(<CancelImportButton jobId="job" status="success" />);
  expect(screen.queryByRole("button")).toBeNull();
});
it("shows server errors without falsely claiming the import stopped", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Already finished" }), { status: 409 })));
  render(<CancelImportButton jobId="job" status="queued" />);
  fireEvent.click(screen.getByText("Cancel queued import"));
  fireEvent.click(screen.getByText("Confirm cancellation"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Cancellation requested")).toBeNull();
});
