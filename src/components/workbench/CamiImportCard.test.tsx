// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CamiImportCard } from "./CamiImportCard";

const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Benchmark controls" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
// Only SeqDesk's own UI/API contract is stubbed here; no external service is simulated.
function appApi() {
  const statuses: Record<string, string> = {};
  const phases: Record<number, string> = {};
  const previewFailures = new Set<number>(), queueFailures = new Set<number>();
  const previews = vi.fn(), starts = vi.fn(), onStarted = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/workbench/importers/cami-benchmark/samples?")) {
      const query = new URL(url, "http://localhost").searchParams;
      return json({ samples: Array.from({ length: query.get("dataset") === "cami2-marine" ? 10 : 20 }, (_, sample) => ({
        sample, phase: phases[sample], status: statuses[query.get("dataset") + ":" + query.get("technology") + ":" + sample] ?? "available",
      })) });
    }
    if (url === "/api/workbench/importers/cami-benchmark/preview") {
      const input = JSON.parse(String(init?.body)); previews(input);
      if (previewFailures.has(input.sample)) return json({ error: "Internal preview failure" }, 503);
      return json({ preview: {
        fingerprint: "internal-reviewed-" + input.sample, providerId: "cami-benchmark",
        summary: { label: "Internal UI contract", selectedCount: 1 }, genomes: [],
        assets: [{ url: "internal-asset-" + input.sample, filename: "sample_" + input.sample + "_reads.tar.gz", bytes: 1024 ** 3, role: "reads", etag: "internal" }],
      } });
    }
    if (url === "/api/workbench/imports") {
      const body = JSON.parse(String(init?.body));
      starts({ ...body, key: new Headers(init?.headers).get("idempotency-key") });
      if (queueFailures.has(body.input.sample)) return json({ error: "Internal queue failure" }, 503);
      statuses[body.input.dataset + ":" + body.input.technology + ":" + body.input.sample] = "queued";
      return json({ job: { id: "internal-job-" + body.input.sample }, collectionOrderId: "internal-collection" }, 202);
    }
    throw new Error("Unexpected application API request: " + url);
  });
  vi.stubGlobal("fetch", fetch);
  return { statuses, phases, previewFailures, queueFailures, previews, starts, onStarted, fetch };
}
async function open(api: ReturnType<typeof appApi>) {
  render(<CamiImportCard initiallyOpen collection={collection} enablePolling={false} onStarted={api.onStarted} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Select all available" }).hasAttribute("disabled")).toBe(false));
}
const select = (sample: number) => fireEvent.click(screen.getByRole("checkbox", { name: "Select sample_" + sample }));

it("opens the collection only after the complete batch is queued", async () => {
  const api = appApi(); const onQueued = vi.fn();
  render(<CamiImportCard initiallyOpen collection={collection} enablePolling={false} onStarted={api.onStarted} onQueued={onQueued} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Select all available" }).hasAttribute("disabled")).toBe(false));
  select(0); select(1);
  fireEvent.click(screen.getByRole("button", { name: "Preview 2 selected samples" }));
  await screen.findByText("2 reviewed samples · 2.00 GiB total download");
  fireEvent.click(screen.getByRole("button", { name: "Import 2 reviewed samples" }));
  await waitFor(() => expect(onQueued).toHaveBeenCalledWith("internal-collection"));
  expect(api.starts).toHaveBeenCalledTimes(2);
  expect(onQueued).toHaveBeenCalledTimes(1);
});

it("imports selected samples without asking users to classify source processing", async () => {
  const api = appApi(); await open(api); select(0); select(1);
  expect(screen.queryByLabelText("Processing label")).toBeNull();
  expect(screen.queryByText("Read processing")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview 2 selected samples" }));
  await screen.findByText("2 reviewed samples · 2.00 GiB total download");
  fireEvent.click(screen.getByRole("button", { name: "Import 2 reviewed samples" }));
  await waitFor(() => expect(api.onStarted).toHaveBeenCalledTimes(2));
  for (const [body] of api.starts.mock.calls) expect(body.input.processingDeclaration).toBeUndefined();
});

it("opens the dataset-specific multi-select without a destination-study selector", () => {
  render(<CamiImportCard onStarted={async () => {}} />);
  fireEvent.click(screen.getByText("Use CAMI module"));
  expect(screen.getAllByRole("checkbox")).toHaveLength(10);
  fireEvent.change(screen.getByLabelText("Dataset"), { target: { value: "cami3-toy-human-gut" } });
  expect(screen.getAllByRole("checkbox")).toHaveLength(20);
  expect(screen.queryByLabelText("Destination study")).toBeNull();
  expect(screen.getByText(/Gold standards are excluded/)).toBeTruthy();
});

it("selects all available samples while excluding imported, queued and running samples", async () => {
  const api = appApi();
  api.statuses["cami2-marine:short:0"] = "imported";
  api.statuses["cami2-marine:short:1"] = "queued";
  api.statuses["cami2-marine:short:2"] = "running";
  api.statuses["cami2-marine:short:3"] = "error";
  await open(api);
  expect(screen.getByText("Imported here")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Select sample_0" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByText("Select all available"));
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(7);
  expect(screen.getByText(/7 selected · 1 of 10 imported here for short reads/)).toBeTruthy();
  fireEvent.click(screen.getByText("Clear selection"));
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Technology"), { target: { value: "long" } });
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select sample_0" }).hasAttribute("disabled")).toBe(false));
  expect(screen.queryByText("Imported here")).toBeNull();
});

it("previews the combined size and starts each selected sample with its own reviewed manifest", async () => {
  const api = appApi(); await open(api);
  select(0); select(2);
  fireEvent.click(screen.getByRole("button", { name: "Preview 2 selected samples" }));
  expect(await screen.findByText("2 reviewed samples · 2.00 GiB total download")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Import 2 reviewed samples" }));
  await waitFor(() => expect(api.onStarted).toHaveBeenCalledTimes(2));
  expect(api.starts.mock.calls.map(([body]) => body.input.sample)).toEqual([0, 2]);
  expect(new Set(api.starts.mock.calls.map(([body]) => body.key)).size).toBe(2);
  for (const [body] of api.starts.mock.calls) {
    expect(body.input.collection).toEqual(collection);
    expect(body.input.targetStudyId).toBeUndefined();
    expect(body.previewFingerprint).toBe("internal-reviewed-" + body.input.sample);
  }
  expect(api.onStarted).toHaveBeenCalledWith("internal-job-0");
  await screen.findByText("2 sample imports queued.");
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
});

it("makes partial preview failures explicit and confirms only the successfully reviewed subset", async () => {
  const api = appApi(); api.previewFailures.add(1); await open(api);
  select(0); select(1);
  fireEvent.click(screen.getByRole("button", { name: "Preview 2 selected samples" }));
  expect(await screen.findByText("1 reviewed sample · 1.00 GiB total download")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("sample_1: Internal preview failure");
  fireEvent.click(screen.getByRole("button", { name: "Import 1 reviewed sample" }));
  await waitFor(() => expect(api.onStarted).toHaveBeenCalledTimes(1));
  expect(api.starts.mock.calls.map(([body]) => body.input.sample)).toEqual([0]);
});

it("retries only failed queue submissions using the same idempotency key", async () => {
  const api = appApi(); api.queueFailures.add(1); await open(api);
  select(0); select(1);
  fireEvent.click(screen.getByRole("button", { name: "Preview 2 selected samples" }));
  fireEvent.click(await screen.findByRole("button", { name: "Import 2 reviewed samples" }));
  await screen.findByText(/sample_1: Internal queue failure/);
  expect(api.onStarted).toHaveBeenCalledTimes(1);
  api.queueFailures.clear();
  fireEvent.click(screen.getByRole("button", { name: "Import 1 reviewed sample" }));
  await waitFor(() => expect(api.onStarted).toHaveBeenCalledTimes(2));
  expect(api.starts.mock.calls.map(([body]) => body.input.sample)).toEqual([0, 1, 1]);
  expect(api.starts.mock.calls[1][0].key).toBe(api.starts.mock.calls[2][0].key);
});

it("invalidates reviewed manifests when samples or datasets change", async () => {
  const api = appApi(); await open(api);
  select(0);
  fireEvent.click(screen.getByRole("button", { name: "Preview 1 selected sample" }));
  await screen.findByRole("button", { name: "Import 1 reviewed sample" });
  select(1);
  expect(screen.queryByRole("button", { name: /Import \d+ reviewed/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Dataset"), { target: { value: "cami3-toy-human-gut" } });
  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(20));
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
});

it("does not enable selection when imported status cannot be checked", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Status is temporarily unavailable" }, 503)));
  render(<CamiImportCard initiallyOpen collection={collection} enablePolling={false} onStarted={async () => {}} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Select all available" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getAllByRole("checkbox").every(checkbox => checkbox.hasAttribute("disabled"))).toBe(true);
});
it("queues all twenty CAMI III samples independently after reviewing the total", async () => {
  const api = appApi(); await open(api);
  fireEvent.change(screen.getByLabelText("Dataset"), { target: { value: "cami3-toy-human-gut" } });
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select sample_19" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Select all available" }));
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Preview 20 selected samples" }));
  expect(await screen.findByText("20 reviewed samples · 20.00 GiB total download")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Import 20 reviewed samples" }));
  await waitFor(() => expect(api.onStarted).toHaveBeenCalledTimes(20));
  expect(api.starts.mock.calls.map(([body]) => body.input.sample)).toEqual(Array.from({ length: 20 }, (_, sample) => sample));
  await screen.findByText("20 sample imports queued.");
});

it("shows storage waiting reasons without exposing free-space figures", async () => {
  const api = appApi();
  api.statuses["cami2-marine:short:0"] = "queued";
  api.phases[0] = "Queued—waiting for enough disk space.";
  api.statuses["cami2-marine:short:1"] = "queued";
  api.phases[1] = "Storage availability could not be checked.";
  await open(api);
  expect(screen.getByText(api.phases[0])).toBeTruthy();
  expect(screen.getByText(api.phases[1])).toBeTruthy();
  expect(screen.queryByText(/200 GiB|free scratch space/)).toBeNull();
});
