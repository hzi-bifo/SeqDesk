// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
it.each(["success", "error", "cancelled"])("does not offer cancellation for %s jobs", status => {
  render(<CancelImportButton jobId="job" status={status} />);
  expect(screen.queryByRole("button")).toBeNull();
});
it("prevents duplicate requests while cancellation is pending", async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetch);
  render(<CancelImportButton jobId="job" status="queued" />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel queued import" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect((screen.getByRole("button", { name: "Requesting…" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Keep queued" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Requesting…" }));
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => resolve(new Response(JSON.stringify({ success: true }))));
  expect(screen.getByText("Cancellation requested")).toBeTruthy();
});
it("shows server errors without falsely claiming the import stopped", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Already finished" }), { status: 409 })));
  render(<CancelImportButton jobId="job" status="queued" />);
  fireEvent.click(screen.getByText("Cancel queued import"));
  fireEvent.click(screen.getByText("Confirm cancellation"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Cancellation requested")).toBeNull();
});
