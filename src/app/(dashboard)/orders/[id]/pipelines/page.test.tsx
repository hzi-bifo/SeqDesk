// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pipeline: "fastqc", canRun: true, isDemo: false }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.pipeline ? { pipeline: state.pipeline } : {}) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "user-1", isDemo: state.isDemo } } }) }));
vi.mock("@/components/deployment-profile/useCapability", () => ({ useCapability: () => state.canRun }));
vi.mock("@/components/orders/OrderPipelineView", () => ({
  OrderPipelineView: ({ samples, inputSelection }: {
    samples: { id: string; sampleId: string }[];
    inputSelection?: { description: ReactNode; renderSample: (sampleId: string) => ReactNode };
  }) => <section aria-label="Selected pipeline"><h1>FastQC</h1><p>Pipeline explanation</p><section aria-label="Input data">
    {inputSelection?.description}<Link href="/orders/order-1/samples-files">Manage files and data sources</Link>
    <table><tbody>{samples.map(sample => <tr key={sample.id}><td>{sample.sampleId}</td><td>{inputSelection?.renderSample(sample.id)}</td></tr>)}</tbody></table>
  </section></section>,
}));

import OrderPipelinesPage from "./page";

const makeSample = () => ({
  id: "sample-1", sampleId: "sample_0", sampleTitle: "Marine sample",
  reads: [
    { id: "read-1", file1: "R1.fastq.gz", file2: "R2.fastq.gz", isActive: true, supersededByReadId: null as string | null },
    { id: "read-2", file1: "single.fastq.gz", file2: null, isActive: false, supersededByReadId: null as string | null },
  ],
});
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });

describe("/orders/[id]/pipelines", () => {
  const fetchMock = vi.fn();
  let sample = makeSample();
  let dataOrigin = "import";

  beforeEach(() => {
    state.pipeline = "fastqc"; state.canRun = true; state.isDemo = false;
    sample = makeSample(); dataOrigin = "import";
    fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/orders/order-1/pipeline-input" && init?.method === "PUT") {
        const selection = JSON.parse(init.body as string);
        sample.reads.forEach(read => { read.isActive = read.id === selection.readId; });
        return response({ ok: true });
      }
      if (url === "/api/orders/order-1/pipeline-input") return response({ samples: [{ id: sample.id, sampleId: sample.sampleId }] });
      if (url === "/api/orders/order-1") return response({ dataOrigin, samples: [sample] });
      if (url === "/api/admin/settings/pipelines?enabled=true&catalog=order") return response({ pipelines: [{ pipelineId: "fastqc", name: "FastQC" }] });
      throw new Error(`Unexpected test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  async function renderPage() {
    const params = Promise.resolve({ id: "order-1" });
    await act(async () => { render(<Suspense fallback={<p>Loading</p>}><OrderPipelinesPage params={params} /></Suspense>); });
  }

  it("places imported input selection in the matching row of the selected pipeline's input table", async () => {
    await renderPage();
    const view = screen.getByRole("region", { name: "Selected pipeline" });
    const picker = within(view).getByRole("combobox", { name: "Input reads for sample_0" }) as HTMLSelectElement;
    expect(picker.value).toBe("read-1");
    expect(screen.getAllByRole("region", { name: "Input data" })).toHaveLength(1);
    expect(within(picker.closest("tr")!).getByText("sample_0")).toBeTruthy();
    expect(screen.getByText("Pipeline explanation").compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage files and data sources" }).getAttribute("href")).toBe("/orders/order-1/samples-files");
    expect(screen.queryByRole("heading", { name: "Pipelines" })).toBeNull();
  });

  it("keeps read selection functional and refreshes the saved choice", async () => {
    await renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "Input reads for sample_0" }), { target: { value: "read-2" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/orders/order-1/pipeline-input", expect.objectContaining({ method: "PUT", body: JSON.stringify({ sampleId: "sample-1", readId: "read-2" }) })));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Input reads for sample_0" }) as HTMLSelectElement).value).toBe("read-2"));
  });

  it("shows a single active read set as filenames without an unnecessary dropdown or internal ID", async () => {
    sample.reads = [sample.reads[0]];
    await renderPage();
    const inputs = screen.getByRole("region", { name: "Input data" });
    expect(within(inputs).queryByRole("combobox")).toBeNull();
    expect(within(inputs).getByText("R1.fastq.gz + R2.fastq.gz")).toBeTruthy();
    expect(within(inputs).getAllByText("Paired-end")).toHaveLength(1);
    expect(within(inputs).queryByText("read-1")).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("requires an explicit choice for a lone inactive read set", async () => {
    sample.reads = [sample.reads[1]];
    await renderPage();
    const picker = screen.getByRole("combobox", { name: "Input reads for sample_0" }) as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    fireEvent.change(picker, { target: { value: "read-2" } });
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Input reads for sample_0" })).toBeNull());
    expect(screen.getByText("single.fastq.gz")).toBeTruthy();
  });

  it.each(["demo", "read-only"])("does not allow input changes in %s mode", async mode => {
    state.isDemo = mode === "demo"; state.canRun = mode !== "read-only";
    await renderPage();
    expect((screen.getByRole("combobox", { name: "Input reads for sample_0" }) as HTMLSelectElement).disabled).toBe(true);
  });

  it("does not show a superseded read as a valid selected input", async () => {
    sample.reads[0].supersededByReadId = "read-2";
    await renderPage();
    const picker = screen.getByRole("combobox", { name: "Input reads for sample_0" }) as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect(within(picker).queryByRole("option", { name: /Paired-end/ })).toBeNull();
  });

  it("keeps the pipeline overview and input selection available", async () => {
    state.pipeline = "";
    await renderPage();
    expect(screen.getByRole("heading", { name: "Pipelines" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Input data" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "FastQC" }).getAttribute("href")).toBe("/orders/order-1/pipelines?pipeline=fastqc");
  });

  it("does not offer the import-only read selector for facility data", async () => {
    dataOrigin = "facility";
    await renderPage();
    expect(screen.getByRole("region", { name: "Selected pipeline" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Input data" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Input reads for sample_0" })).toBeNull();
  });

  it("keeps samples without valid read sets in the table with a disabled selector", async () => {
    sample.reads = [];
    await renderPage();
    const picker = screen.getByRole("combobox", { name: "Input reads for sample_0" }) as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect(within(picker).getByRole("option", { name: "No validated read sets yet" })).toBeTruthy();
    expect(within(picker.closest("tr")!).getByText("sample_0")).toBeTruthy();
  });

  it("does not offer read sets without a first input file", async () => {
    sample.reads[0].file1 = "";
    await renderPage();
    const picker = screen.getByRole("combobox", { name: "Input reads for sample_0" }) as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect(within(picker).queryByRole("option", { name: /Paired-end/ })).toBeNull();
    expect(within(picker).getByRole("option", { name: /Single-end/ })).toBeTruthy();
  });

  it("shows a load error instead of silently hiding the inputs", async () => {
    fetchMock.mockResolvedValue(response({ error: "Forbidden" }, false));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByRole("region", { name: "Selected pipeline" })).toBeNull();
  });
});
