// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrderFilesAddDialog } from "./OrderFilesAddDialog";

const samples = [{ id: "sample-a", sampleId: "A", sampleTitle: null }, { id: "sample-b", sampleId: "B", sampleTitle: null }];
const storage = { path: "_uploads/orders/order-a", roots: [{ path: "_uploads/orders/order-a", label: "Collection files" }], entries: [
  { path: "_uploads/orders/order-a/A_R1.fastq.gz", name: "A_R1.fastq.gz", type: "file", size: 20 },
  { path: "_uploads/orders/order-a/A_R2.fastq.gz", name: "A_R2.fastq.gz", type: "file", size: 20 },
], truncated: false };
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(mode: "storage" | "upload" = "storage", extra: Record<string, unknown> = {}) {
  const onSaved = vi.fn(); const onClose = vi.fn();
  render(<OrderFilesAddDialog orderId="order-a" orderName="Collection A" samples={samples} mode={mode} preselectedSampleId="sample-b" onSaved={onSaved} onClose={onClose} {...extra} />);
  return { onSaved, onClose };
}
async function reviewStorage() {
  fireEvent.click(await screen.findByLabelText("Select A_R1.fastq.gz"));
  fireEvent.click(screen.getByLabelText("Select A_R2.fastq.gz"));
  fireEvent.click(screen.getByRole("button", { name: "Review matching" }));
}

it("keeps the selected sample and sends the exact reviewed link payload only on confirmation", async () => {
  fetchMock.mockImplementation((url: string, options?: RequestInit) => Promise.resolve(options?.method === "POST" ? response({ readId: "new-read", sampleId: "sample-b" }) : response(storage)));
  const { onSaved } = mount();
  await reviewStorage();
  expect((screen.getByLabelText("Destination sample for set 1") as HTMLSelectElement).value).toBe("sample-b");
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  expect(screen.queryByText("I checked the files and destination sample")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Confirm file links" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const [url, options] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(url).toBe("/api/orders/order-a/data-files");
  expect(JSON.parse(options.body)).toEqual({ sampleId: "sample-b", read1: storage.entries[0].path, read2: storage.entries[1].path, processing: "unknown", requestId: expect.any(String) });
});

it("prevents duplicate mates and missing target selection from being submitted", async () => {
  fetchMock.mockResolvedValue(response(storage)); mount(); await reviewStorage();
  fireEvent.change(screen.getByLabelText("R2 for set 1"), { target: { value: storage.entries[0].path } });
  expect((screen.getByRole("button", { name: "Confirm file links" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("R1 and R2 must be different files.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("R2 for set 1"), { target: { value: storage.entries[1].path } });
  fireEvent.change(screen.getByLabelText("Destination sample for set 1"), { target: { value: "" } });
  expect((screen.getByRole("button", { name: "Confirm file links" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps pending requests locked and reuses the request ID after a lost response", async () => {
  let reject: (reason: Error) => void = () => {};
  fetchMock.mockImplementation((url: string, options?: RequestInit) => options?.method === "POST" ? new Promise((_, rejectPromise) => { reject = rejectPromise; }) : Promise.resolve(response(storage)));
  mount(); await reviewStorage();
  fireEvent.click(screen.getByRole("button", { name: "Confirm file links" }));
  expect((screen.getByRole("button", { name: "Saving files…" }) as HTMLButtonElement).disabled).toBe(true);
  reject(new Error("Connection interrupted"));
  await screen.findByRole("alert");
  const first = JSON.parse(fetchMock.mock.calls.find(([, options]) => options?.method === "POST")![1].body);
  fetchMock.mockResolvedValue(response({ readId: "new-read", sampleId: "sample-b" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm file links" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(2));
  const second = JSON.parse(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")[1][1].body);
  expect(second.requestId).toBe(first.requestId);
});

it("confines Up navigation to the permitted storage root and reports storage failures", async () => {
  fetchMock.mockResolvedValue(response(storage)); mount();
  await screen.findByLabelText("Select A_R1.fastq.gz");
  expect(screen.queryByRole("button", { name: "Up one folder" })).toBeNull();
  cleanup(); fetchMock.mockResolvedValue(response({ error: "Storage is not configured" }, false)); mount();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Storage is not configured"));
});

it("uploads real selected Files with sample and stable request identity, without link paths", async () => {
  fetchMock.mockResolvedValue(response({ readId: "uploaded", sampleId: "sample-b" }));
  const { onSaved } = mount("upload");
  expect(screen.getByText(/64.0 MiB per read set/)).toBeTruthy();
  const file1 = new File(["@a\nA\n+\nI\n"], "A_R1.fastq");
  const file2 = new File(["@a\nT\n+\nI\n"], "A_R2.fastq");
  fireEvent.change(screen.getByLabelText("FASTQ files"), { target: { files: [file1, file2] } });
  fireEvent.click(screen.getByRole("button", { name: "Review matching" }));
  fireEvent.click(screen.getByRole("button", { name: "Upload and associate" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/orders/order-a/data-files/upload");
  const body = options.body as FormData;
  expect(body.get("file1")).toBe(file1); expect(body.get("file2")).toBe(file2);
  expect(body.get("sampleId")).toBe("sample-b"); expect(body.get("processing")).toBe("unknown");
  expect(body.get("requestId")).toEqual(expect.any(String)); expect(body.has("read1")).toBe(false);
});

it("blocks oversized upload read sets before making a network request", async () => {
  mount("upload", { uploadLimitBytes: 5 });
  fireEvent.change(screen.getByLabelText("FASTQ files"), { target: { files: [new File(["123456"], "A.fastq")] } });
  fireEvent.click(screen.getByRole("button", { name: "Review matching" }));
  expect(screen.getByRole("alert").textContent).toContain("exceeds the 5 B upload limit");
  expect((screen.getByRole("button", { name: "Upload and associate" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("retries only an interrupted second lane using the created sample and the same request ID", async () => {
  const batch = { ...storage, entries: ["C_S1_L001_R1_001.fastq.gz", "C_S1_L001_R2_001.fastq.gz", "C_S1_L002_R1_001.fastq.gz", "C_S1_L002_R2_001.fastq.gz"].map(name => ({ path: `${storage.path}/${name}`, name, type: "file", size: 20 })) };
  let posts = 0;
  fetchMock.mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method !== "POST") return Promise.resolve(response(batch));
    posts += 1;
    if (posts === 2) return Promise.reject(new Error("Response lost after saving"));
    return Promise.resolve(response({ readId: `lane-${posts}`, sampleId: "created-sample-c" }));
  });
  const { onClose } = mount("storage", { preselectedSampleId: undefined });
  await screen.findByLabelText(`Select ${batch.entries[0].name}`);
  batch.entries.forEach(entry => fireEvent.click(screen.getByLabelText(`Select ${entry.name}`)));
  fireEvent.click(screen.getByRole("button", { name: "Review matching" }));
  for (const index of [1, 2]) {
    fireEvent.change(screen.getByLabelText(`Destination sample for set ${index}`), { target: { value: "new" } });
    expect((screen.getByLabelText(`New sample identifier for set ${index}`) as HTMLInputElement).value).toBe("C");
  }
  fireEvent.click(screen.getByRole("button", { name: "Confirm file links" }));
  expect((await screen.findByRole("alert")).textContent).toContain("1 read set was saved");
  expect((screen.getByLabelText("Destination sample for set 2") as HTMLSelectElement).value).toBe("created-sample-c");
  fireEvent.click(screen.getByRole("button", { name: "Confirm file links" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const payloads = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST").map(([, options]) => JSON.parse(options.body));
  expect(payloads).toHaveLength(3);
  expect(payloads[0].newSample).toEqual({ sampleId: "C" });
  expect(payloads[0].read1).toContain("L001_R1");
  expect(payloads[1]).toMatchObject({ sampleId: "created-sample-c", read1: expect.stringContaining("L002_R1") });
  expect(payloads[2]).toEqual(payloads[1]);
});
