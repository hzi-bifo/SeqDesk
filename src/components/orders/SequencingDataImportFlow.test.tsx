// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ push: state.push }) }));
vi.mock("@/lib/modules", () => ({ useModuleEnabled: () => true }));
vi.mock("@/components/workbench/WorkbenchImportsClient", () => ({ WorkbenchImportsClient: ({ source, collection }: { source: string; collection?: { name: string } }) => <div data-testid="import-client">{source}: {collection?.name}</div> }));
import { SequencingDataImportFlow } from "./SequencingDataImportFlow";
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (_url, init) => new Response(JSON.stringify({ id: "internal-collection", name: JSON.parse(init.body).name }), { status: 201 }))));
afterEach(() => { cleanup(); state.query = ""; vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("creates a collection and opens Files without requiring a repository import", async () => {
  render(<SequencingDataImportFlow newEntry />);
  expect(screen.queryByRole("heading", { name: "Import module store" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Collection name" }), { target: { value: "  Marine controls  " } });
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
  await waitFor(() => expect(state.push).toHaveBeenCalledTimes(1));
  const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(request.name).toBe("Marine controls");
  expect(request.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.push).toHaveBeenCalledWith("/orders/internal-collection/samples-files");
});
it("does not start a module without naming the collection, including direct links", async () => {
  state.query = "source=cami";
  render(<SequencingDataImportFlow />);
  expect(screen.queryByTestId("import-client")).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
  fireEvent.click(screen.getByRole("button", { name: "Continue to import module" }));
  expect(state.push).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "CAMI controls" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue to import module" }));
  await waitFor(() => expect(state.push).toHaveBeenCalledTimes(1));
  expect(state.push.mock.calls[0][0]).toContain("source=cami");
});
it("keeps save failures visible and reuses the collection key on retry", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => { requests.push(JSON.parse(init.body).key); return new Response(JSON.stringify({ error: "Could not save" }), { status: 500 }); }));
  render(<SequencingDataImportFlow newEntry />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Controls" } });
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0]).toBe(requests[1]);
  expect(state.push).not.toHaveBeenCalled();
});
it("opens the store from the sidebar and opens a named module with no study selection", () => {
  const view = render(<SequencingDataImportFlow />);
  expect(screen.getByRole("heading", { name: "Import module store" })).toBeTruthy();
  expect(screen.queryByTestId("import-client")).toBeNull();
  state.query = "source=sra&collection=00e55dcb-9697-4b89-af56-af51bd557a17&name=Public+controls";
  view.rerender(<SequencingDataImportFlow />);
  expect(screen.getByTestId("import-client").textContent).toBe("sra: Public controls");
  expect(screen.queryByLabelText("Destination study")).toBeNull();
});
it("keeps the named data-source selection free of import jobs", () => {
  state.query = "collection=00e55dcb-9697-4b89-af56-af51bd557a17&name=Public+controls";
  render(<SequencingDataImportFlow />);
  expect(screen.getByRole("heading", { level: 1, name: "Import data with SeqDesk" })).toBeTruthy();
  expect(screen.getByText("Use import modules such as CAMI and SRA to add samples, files and metadata.")).toBeTruthy();
  expect(screen.queryByText(/Import from a repository/i)).toBeNull();
  expect(screen.getByRole("heading", { name: "Import module store" })).toBeTruthy();
  expect(screen.getByText("Public controls")).toBeTruthy();
  expect(screen.queryByTestId("import-client")).toBeNull();
});
it("does not mount a disabled module's importer", () => {
  state.query = "source=cami&collection=00e55dcb-9697-4b89-af56-af51bd557a17&name=Controls";
  render(<SequencingDataImportFlow moduleEnabled={false} />);
  expect(screen.queryByTestId("import-client")).toBeNull();
  expect(screen.getByText(/This import module is disabled/)).toBeTruthy();
});
it("keeps the collection and order context in the styled back-to-store link", () => {
  state.query = "source=cami&collection=00e55dcb-9697-4b89-af56-af51bd557a17&name=Controls&orderId=internal-order";
  render(<SequencingDataImportFlow />);
  const link = screen.getByRole("link", { name: "Back to import module store" });
  const query = new URL(link.getAttribute("href")!, "http://localhost").searchParams;
  expect(query.get("collection")).toBe("00e55dcb-9697-4b89-af56-af51bd557a17");
  expect(query.get("name")).toBe("Controls");
  expect(query.get("orderId")).toBe("internal-order");
  expect(query.has("source")).toBe(false);
});
