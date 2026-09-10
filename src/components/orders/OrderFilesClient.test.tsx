// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OrderDataFilesInventory } from "@/lib/orders/data-files-types";

const modules = vi.hoisted(() => ({ disabled: [] as string[] }));
vi.mock("@/lib/modules", () => ({ useModuleEnabled: (id: string) => !modules.disabled.includes(id) }));
vi.mock("./OrderFilesAddDialog", () => ({
  formatFileSize: () => "20 B",
  OrderFilesAddDialog: ({ mode, preselectedSampleId, orderId }: { mode: string; preselectedSampleId?: string; orderId: string }) => <div role="dialog" aria-label="Add files dialog" data-mode={mode} data-sample={preselectedSampleId} data-order={orderId} />,
}));
import { OrderFilesClient } from "./OrderFilesClient";

const inventory: OrderDataFilesInventory = {
  order: { id: "order-a", name: "Marine collection", dataOrigin: "import", status: "DRAFT", collectionKey: "collection-a" },
  canManage: true, canManageFacility: false, sequencingSourceEnabled: false, storageConfigured: true,
  samples: [{ id: "sample-a", sampleId: "A", sampleTitle: "Marine sample" }, { id: "sample-b", sampleId: "B", sampleTitle: null }],
  readSets: [
    { id: "imported-set", sampleId: "sample-a", sampleIdentifier: "A", sampleTitle: "Marine sample", source: "ena-fastq-accession", processing: "unknown", isActive: false, runAccessionNumber: null, metadata: { source: "ENA" }, files: [{ path: "cache/A_R1.fastq.gz", name: "A_R1.fastq.gz", role: "R1", exists: true, size: 20 }, { path: "cache/A_R2.fastq.gz", name: "A_R2.fastq.gz", role: "R2", exists: true, size: 20 }] },
    { id: "local-set", sampleId: "sample-a", sampleIdentifier: "A", sampleTitle: "Marine sample", source: "local_files", processing: "cleaned", isActive: false, runAccessionNumber: null, metadata: {}, files: [{ path: "reads/A-cleaned.fastq.gz", name: "A-cleaned.fastq.gz", role: "single", exists: true, size: 20 }] },
  ], artifacts: [], streams: [],
};
const fetchMock = vi.fn();
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); modules.disabled = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function serve(data = inventory, jobs: unknown[] = []) {
  fetchMock.mockImplementation((url: string) => Promise.resolve(url.startsWith("/api/workbench/") ? response({ jobs }) : response(data)));
}
function openMenu(name: string) { fireEvent.keyDown(screen.getByRole("button", { name, exact: true }), { key: "Enter" }); }
function tab(name: string | RegExp) { fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false }); }
function importJob(id: string, status: string, phase = "downloading 30%") {
  return { id, providerId: "ena-fastq-accession", status, phase, error: null, updatedAt: new Date().toISOString(), finishedAt: null, request: { accession: "selected accession" } };
}

it("shows every distinct read set regardless of isActive, with origin and collapsed evidence", async () => {
  serve(); const { container } = render(<OrderFilesClient orderId="order-a" />);
  await screen.findByText("A_R1.fastq.gz");
  expect(container.querySelectorAll("[data-read-set]")).toHaveLength(2);
  expect(screen.getByText("SRA / ENA import")).toBeTruthy();
  expect(screen.getByText("Linked from storage")).toBeTruthy();
  expect(screen.getByText("Read set 1")).toBeTruthy(); expect(screen.getByText("Read set 2")).toBeTruthy();
  expect(container.querySelector("[data-read-set] > details")?.hasAttribute("open")).toBe(false);
  expect(screen.getByRole("tab", { name: "By sample" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByText("Ready for analysis")).toBeNull();
  tab("All files");
  await screen.findByText("Files in Marine collection");
  expect(within(screen.getByRole("tabpanel")).getAllByRole("row")).toHaveLength(4);
});

it("shows the store's modules and file alternatives directly, keeping every link scoped to this collection", async () => {
  serve(); render(<OrderFilesClient orderId="order-a" />); await screen.findByText("A_R1.fastq.gz");
  const choices = screen.getByRole("region", { name: "Add data" });
  expect(within(choices).getAllByRole("article").map(card => within(card).getByRole("heading").textContent)).toEqual([
    "CAMI benchmark reads", "SRA / ENA reads", "Other ways to add data",
  ]);
  for (const [name, source] of [["CAMI benchmark reads", "cami"], ["SRA / ENA reads", "sra"]]) {
    const link = within(choices).getByRole("link", { name: `Open module: ${name}` });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/orders/import");
    expect(Object.fromEntries(url.searchParams)).toEqual({ source, orderId: "order-a", name: "Marine collection", collection: "collection-a" });
    expect(link.getAttribute("data-variant")).toBe("default");
  }
  expect(within(choices).getByRole("link", { name: "Browse import module store" }).getAttribute("href")).toBe("/orders/import?orderId=order-a&name=Marine+collection&collection=collection-a");
  const alternatives = within(choices).getByRole("article", { name: "Other ways to add data" });
  expect(within(alternatives).getByRole("button", { name: "Use existing files" })).toBeTruthy();
  expect(within(alternatives).getByRole("button", { name: "Upload files" })).toBeTruthy();
  expect(choices.compareDocumentPosition(screen.getByRole("heading", { name: "Collection files" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Import data with SeqDesk" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Other ways to add data" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Connect a sequencer" })).toBeNull();
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it.each([["Use existing files", "storage"], ["Upload files", "upload"]])("opens %s directly from its card without adding files yet", async (action, mode) => {
  serve(); render(<OrderFilesClient orderId="order-a" />);
  fireEvent.click(await screen.findByRole("button", { name: action, exact: true }));
  const dialog = screen.getByRole("dialog", { name: "Add files dialog" });
  expect(dialog.getAttribute("data-mode")).toBe(mode);
  expect(dialog.getAttribute("data-order")).toBe("order-a");
  expect(dialog.hasAttribute("data-sample")).toBe(false);
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("preserves sample-specific file actions alongside the collection cards", async () => {
  serve(); render(<OrderFilesClient orderId="order-a" />); await screen.findByText("A_R1.fastq.gz");
  openMenu("Add files to B");
  expect(screen.queryByRole("menuitem", { name: "Import data with SeqDesk" })).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "Use existing files" }));
  const dialog = await screen.findByRole("dialog", { name: "Add files dialog" });
  expect(dialog.getAttribute("data-sample")).toBe("sample-b"); expect(dialog.getAttribute("data-order")).toBe("order-a"); expect(dialog.getAttribute("data-mode")).toBe("storage");
});

it("keeps facility actions out of import collections and respects view-only access", async () => {
  serve({ ...inventory, canManageFacility: true }); render(<OrderFilesClient orderId="order-a" />); await screen.findByText("A_R1.fastq.gz");
  expect(screen.queryByRole("link", { name: "Facility processing" })).toBeNull();
  cleanup(); serve({ ...inventory, canManage: false }); render(<OrderFilesClient orderId="order-a" />); await screen.findByText("A_R1.fastq.gz");
  expect(screen.queryByRole("button", { name: "Add data" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Import data with SeqDesk" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Other ways to add data" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add files to A" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Add data" })).toBeNull();
  expect(screen.queryByRole("link", { name: /Open module:/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
});

it("highlights import for an empty collection without starting a job", async () => {
  serve({ ...inventory, samples: [], readSets: [] });
  render(<OrderFilesClient orderId="order-a" />);
  await screen.findByRole("heading", { name: "No samples or files yet" });
  expect(within(screen.getByRole("region", { name: "Add data" })).getAllByRole("article")).toHaveLength(3);
  expect(screen.getByText("Choose a source above to add samples and files to this collection.")).toBeTruthy();
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("keeps file actions available without offering a broken import link when the collection key is absent", async () => {
  serve({ ...inventory, order: { ...inventory.order, collectionKey: null } });
  render(<OrderFilesClient orderId="order-a" />);
  await screen.findByText("A_R1.fastq.gz");
  expect(screen.queryByRole("link", { name: "Import data with SeqDesk" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Add data" })).toBeNull();
  openMenu("Add data");
  expect(screen.getByRole("menuitem", { name: "Use existing files" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Upload files" })).toBeTruthy();
});

it("retains facility selection and blocks superseded read-set actions", async () => {
  const facility = { ...inventory, order: { ...inventory.order, dataOrigin: "facility", collectionKey: null, status: "SUBMITTED" }, canManageFacility: true, readSets: [{ ...inventory.readSets[0], supersededByReadId: "local-set" }, inventory.readSets[1]] };
  serve(facility); const { container } = render(<OrderFilesClient orderId="order-a" />); await screen.findByText("A_R1.fastq.gz");
  expect(screen.getByRole("link", { name: "Facility processing" }).getAttribute("href")).toBe("/orders/order-a/sequencing");
  expect(screen.queryByRole("link", { name: "Import data with SeqDesk" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Add data" })).toBeNull();
  openMenu("Add data"); expect(screen.queryByRole("menuitem", { name: "Import data with SeqDesk" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Upload files" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  container.querySelectorAll("[data-read-set] > details").forEach(details => details.setAttribute("open", ""));
  expect(screen.getAllByRole("button", { name: "Use for facility processing" })).toHaveLength(1);
  fetchMock.mockImplementation((url: string, options?: RequestInit) => Promise.resolve(options?.method === "PUT" ? response({ error: "Unpublish the delivery in Facility processing before changing selected files" }, false) : response(facility)));
  fireEvent.click(screen.getByRole("button", { name: "Use for facility processing" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Unpublish the delivery");
  const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === "PUT")!;
  expect(JSON.parse(options.body)).toEqual({ sampleId: "sample-a", readId: "local-set" });
});

it("opens Activity by default for a running import and shows progress and cancellation immediately", async () => {
  serve(inventory, [importJob("job-a", "running")]);
  render(<OrderFilesClient orderId="order-a" />);
  const activity = await screen.findByRole("tab", { name: "Activity 1 in progress" });
  expect(activity.getAttribute("aria-selected")).toBe("true");
  expect(await screen.findByRole("progressbar", { name: "Download progress" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stop download" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Live sequencer" })).toBeNull();
});

it("counts queued and running imports, excluding finished history", async () => {
  serve(inventory, [
    importJob("queued", "queued", "waiting for space"), importJob("running", "running"),
    importJob("done", "success", "complete"), importJob("failed", "error", "failed"), importJob("cancelled", "cancelled", "cancelled"),
  ]);
  render(<OrderFilesClient orderId="order-a" />);
  const activity = await screen.findByRole("tab", { name: "Activity 2 in progress" });
  expect(activity.getAttribute("aria-selected")).toBe("true");
  expect(within(activity).getByText("2 in progress").getAttribute("title")).toBe("2 imports are running or queued");
  expect(screen.getByRole("button", { name: "Cancel queued import" })).toBeTruthy();
});

it.each(["success", "error", "cancelled"])("keeps By sample as the default when only %s imports exist", async status => {
  serve(inventory, [importJob("past", status, status)]);
  render(<OrderFilesClient orderId="order-a" />);
  await screen.findByText("A_R1.fastq.gz");
  expect(screen.getByRole("tab", { name: "By sample" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Activity", exact: true })).toBeTruthy();
  expect(screen.queryByText(/in progress/)).toBeNull();
});

it.each(["queued", "running"])("opens Activity for a %s import even when the collection has no files yet", async status => {
  serve({ ...inventory, samples: [], readSets: [] }, [importJob("new-job", status, status)]);
  render(<OrderFilesClient orderId="order-a" />);
  const activity = await screen.findByRole("tab", { name: "Activity 1 in progress" });
  expect(activity.getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("heading", { name: "No samples or files yet" })).toBeNull();
});

it.each(["By sample", "All files"])("preserves a user's %s tab choice while activity polls", async name => {
  vi.useFakeTimers();
  serve(inventory, [importJob("job-a", "running")]);
  await act(async () => { render(<OrderFilesClient orderId="order-a" />); });
  expect(screen.getByRole("tab", { name: /Activity/ }).getAttribute("aria-selected")).toBe("true");
  tab(name);
  serve(inventory, [importJob("job-a", "running", "downloading 60%"), importJob("job-b", "queued", "queued")]);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Activity 2 in progress" }).getAttribute("aria-selected")).toBe("false");
});

it("does not take over a manually selected By sample tab when the initial activity request resolves late", async () => {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  fetchMock.mockImplementation((url: string) => url.startsWith("/api/workbench/") ? pending : Promise.resolve(response(inventory)));
  render(<OrderFilesClient orderId="order-a" />);
  await screen.findByText("A_R1.fastq.gz");
  fireEvent.click(screen.getByRole("tab", { name: "By sample" }));
  await act(async () => { resolve(response({ jobs: [importJob("job-a", "running")] })); });
  expect(screen.getByRole("tab", { name: "By sample" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Activity 1 in progress" }).getAttribute("aria-selected")).toBe("false");
});

it("removes the active indicator on completion without navigating away from Activity", async () => {
  vi.useFakeTimers();
  serve(inventory, [importJob("job-a", "running")]);
  await act(async () => { render(<OrderFilesClient orderId="order-a" />); });
  serve(inventory, [importJob("job-a", "success", "complete")]);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole("tab", { name: "Activity", exact: true }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("Ready — files validated")).toBeTruthy();
  expect(screen.queryByText(/in progress/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop download" })).toBeNull();
});

it("announces new activity through the badge without changing an already resolved default tab", async () => {
  vi.useFakeTimers();
  serve();
  await act(async () => { render(<OrderFilesClient orderId="order-a" />); });
  serve(inventory, [importJob("new-job", "queued", "queued")]);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole("tab", { name: "By sample" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Activity 1 in progress" }).getAttribute("aria-selected")).toBe("false");
});

it("keeps disabled import modules visible but leaves file alternatives usable", async () => {
  modules.disabled = ["import-cami", "import-sra"];
  serve(); render(<OrderFilesClient orderId="order-a" />);
  const choices = within(await screen.findByRole("region", { name: "Add data" }));
  expect(choices.getAllByRole("article")).toHaveLength(3);
  expect(choices.queryByRole("link", { name: /Open module:/ })).toBeNull();
  for (const button of choices.getAllByRole("button", { name: "Disabled by administrator" })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  }
  expect((choices.getByRole("button", { name: "Upload files" }) as HTMLButtonElement).disabled).toBe(false);
  expect((choices.getByRole("button", { name: "Use existing files" }) as HTMLButtonElement).disabled).toBe(false);
});

it("explains unavailable storage on the file card without blocking uploads or import modules", async () => {
  serve({ ...inventory, storageConfigured: false }); render(<OrderFilesClient orderId="order-a" />);
  const choices = within(await screen.findByRole("region", { name: "Add data" }));
  const storage = choices.getByRole("button", { name: "Use existing files" });
  expect((storage as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById(storage.getAttribute("aria-describedby")!)?.textContent).toContain("Server storage is not configured");
  fireEvent.click(storage);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((choices.getByRole("button", { name: "Upload files" }) as HTMLButtonElement).disabled).toBe(false);
  expect(choices.getAllByRole("link", { name: /Open module:/ })).toHaveLength(2);
});

it("reports inventory errors and retries without inventing files", async () => {
  fetchMock.mockResolvedValue(response({ error: "Access denied" }, false));
  render(<OrderFilesClient orderId="order-a" />);
  expect(screen.getByRole("status", { name: "Loading files" })).toBeTruthy();
  expect((await screen.findByRole("alert")).textContent).toContain("Access denied");
  expect(screen.queryByRole("table")).toBeNull();
  serve(); fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("A_R1.fastq.gz")).toBeTruthy();
});

it("gates the sequencer action by connection availability and uses scoped download URLs", async () => {
  serve({ ...inventory, order: { ...inventory.order, dataOrigin: "facility", collectionKey: null }, canManageFacility: true, sequencingSourceEnabled: true, storageConfigured: false });
  const { container } = render(<OrderFilesClient orderId="order-a" />); await screen.findByText("A_R1.fastq.gz");
  openMenu("Add data");
  expect(screen.getByRole("menuitem", { name: "Connect a sequencer" }).getAttribute("href")).toBe("/orders/order-a/sequencing?view=stream");
  expect(screen.getByRole("menuitem", { name: "Use existing files (storage unavailable)" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Upload files" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  container.querySelectorAll("[data-read-set] > details").forEach(details => details.setAttribute("open", ""));
  expect(screen.getByRole("link", { name: "Download R1" }).getAttribute("href")).toBe("/api/orders/order-a/data-files/download?readId=imported-set&mate=1");
  expect(screen.getByRole("link", { name: "Download R2" }).getAttribute("href")).toBe("/api/orders/order-a/data-files/download?readId=imported-set&mate=2");
});
