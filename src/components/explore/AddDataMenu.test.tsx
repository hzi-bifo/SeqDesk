// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineTableSource } from "@/lib/explore/builders/pipeline-table";

const mocks = vi.hoisted(() => ({ swr: vi.fn(), fetch: vi.fn(), mutate: vi.fn(), post: vi.fn(), push: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.swr, mutate: mocks.mutate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/explore/client", () => ({ fetcher: mocks.fetch, postJson: mocks.post }));
vi.mock("./TableChartDialog", () => ({ TableChartDialog: ({ initialDatasetId, onAdd }: { initialDatasetId: string; onAdd: (block: unknown) => void }) => <div role="dialog" aria-label="Chart setup"><p>{initialDatasetId}</p><button onClick={() => onAdd({ id: "chart-one", type: "chart", datasetId: initialDatasetId, chart: "histogram", x: "quality" })}>Add chart to page</button></div> }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info, warning: mocks.warning } }));
import { AddDataMenu } from "./AddDataMenu";
import { PipelineTableSources } from "./PipelineTableSources";

const source: PipelineTableSource = {
  pipelineId: "fastqc", pipelineName: "FastQC", outputId: "summary", label: "FastQC quality summary", tableKind: "sample-summary", scope: "run", format: "tsv",
  description: "Read counts, mean Phred quality and check flags for R1 and R2.", columnLabels: { r1_read_count: "R1 reads", r2_avg_quality: "R2 mean quality (Phred)" },
  runs: [{ id: "run-new", runNumber: "FASTQC-NEW", completedAt: null, selected: false, artifactCount: 1 }, { id: "run-selected", runNumber: "FASTQC-SELECTED", completedAt: null, selected: true, artifactCount: 1 }],
};
const scope = "order:imported-data-test";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.swr.mockReturnValue({ data: { pipelineTables: [source] }, mutate: mocks.mutate, isLoading: false });
  mocks.post.mockResolvedValue({ dataset: { name: source.label }, version: { number: 1, rowCount: 1, unchanged: false }, warnings: [] });
});
afterEach(cleanup);

function openMenu() {
  render(<AddDataMenu scope={scope} reportId="new-report" />);
  fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Pipeline outputs", exact: true }));
}

describe("report data source picker", () => {
  it("returns focus to its launch button after keyboard dismissal", async () => {
    render(<AddDataMenu scope={scope} outputs={{ figures: [], tables: [], analyses: [] }} />);
    const trigger = screen.getByRole("button", { name: "Add", exact: true });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Add data", exact: true })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("keeps analysis setup explicit and never opens the generation wizard or starts a run", async () => {
    mocks.swr.mockReturnValue({ data: { outputs: [{ id: "fastqc:summary", ...source, kind: "table", table: source,
      runs: [{ id: "run-new", runNumber: "FASTQC-NEW", completedAt: null, files: [{ id: "artifact", name: "summary.tsv", kind: "table", previewable: true, sample: null, size: 100 }] }],
      templates: [{ id: "quality-template", name: "Quality overview", inputAlias: "qc" }] }] }, mutate: mocks.mutate });
    mocks.post.mockResolvedValue({ dataset: { id: "built-dataset", name: "QC" }, version: { number: 1, rowCount: 1, unchanged: false }, warnings: [] });
    openMenu();
    expect(screen.queryByText(/Create report content/)).toBeNull();
    fireEvent.click(screen.getByText(/Use in an analysis/));
    fireEvent.click(screen.getByRole("button", { name: "Quality overview" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/explore/datasets/build", { targetKey: scope, kind: "pipeline-table", options: { pipelineId: "fastqc", outputId: "summary", runIds: ["run-new"] } }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/explore/analyses/new?scope=${encodeURIComponent(scope)}&kit=quality-template&dataset=built-dataset&input=qc&report=new-report`));
    expect(screen.queryByRole("dialog", { name: "Generation setup" })).toBeNull();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it("groups a described table under its pipeline, separate from metadata and HTML reports", () => {
    openMenu();
    expect(screen.getByRole("heading", { name: "Add data" })).toBeTruthy();
    const pipeline = screen.getByRole("region", { name: "FastQC", exact: true });
    expect(within(pipeline).getByText(source.description!)).toBeTruthy();
    expect(within(pipeline).getByText(/R1 reads · R2 mean quality/)).toBeTruthy();
    expect(within(pipeline).getByRole("link", { name: "Reports & run history" }).getAttribute("href")).toBe("/orders/imported-data-test/pipelines?pipeline=fastqc");
    expect(screen.getByText(/Original HTML reports and technical details/)).toBeTruthy();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("uses the normal selected/latest selection unless the user chooses a run", async () => {
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Add FastQC quality summary" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/explore/datasets/build", { targetKey: scope, kind: "pipeline-table", options: { pipelineId: "fastqc", outputId: "summary" } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("pins an explicitly chosen completed run", async () => {
    openMenu();
    fireEvent.change(screen.getByRole("combobox", { name: /Result source/ }), { target: { value: "run-selected" } });
    fireEvent.click(screen.getByRole("button", { name: "Add FastQC quality summary" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/explore/datasets/build", expect.objectContaining({ options: { pipelineId: "fastqc", outputId: "summary", runIds: ["run-selected"] } })));
  });

  it("shows loading skeletons instead of a misleading no-results message", () => {
    mocks.swr.mockReturnValue({ isLoading: true, mutate: mocks.mutate });
    openMenu();
    expect(screen.getByRole("status").textContent).toContain("Loading pipeline outputs");
    expect(screen.queryByText(/No report-ready/)).toBeNull();
  });

  it("keeps pipeline outputs available while the catalog refreshes", () => {
    mocks.swr.mockReturnValue({ data: { pipelineTables: [source] }, isLoading: true, isValidating: true, mutate: mocks.mutate });
    openMenu();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Add FastQC quality summary" })).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it.each([
    ["Metadata", "Loading saved metadata…"],
    ["Saved analysis results", "Loading saved results…"],
    ["Your files", "Loading saved files…"],
  ])("waits for saved data in %s without offering misleading empty states", (tab, label) => {
    mocks.swr.mockReturnValue({ isLoading: true, mutate: mocks.mutate });
    render(<AddDataMenu scope={scope} reportId="report" />);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: tab, exact: true }));
    expect(screen.getByRole("status", { name: label })).toBeTruthy();
    expect(screen.queryByText(/No saved analysis results/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Samples" })).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it.each([
    ["Metadata", "Retry loading metadata"],
    ["Saved analysis results", "Retry loading saved results"],
    ["Your files", "Retry loading saved files"],
  ])("provides retry after %s fails instead of leaving a skeleton", (tab, label) => {
    mocks.swr.mockReturnValue({ error: new Error("Network unavailable"), mutate: mocks.mutate });
    render(<AddDataMenu scope={scope} reportId="report" />);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: tab, exact: true }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("surfaces failed or stale catalog requests and offers retry", () => {
    mocks.swr.mockReturnValue({ error: new Error("Session expired"), data: { pipelineTables: [source] }, mutate: mocks.mutate });
    openMenu();
    expect(screen.getByRole("alert").textContent).toContain("Session expired");
    expect(screen.queryByRole("button", { name: "Add FastQC quality summary" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading outputs" }));
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  });

  it("does not offer metadata-only or report-only output as a fabricated table", () => {
    mocks.swr.mockReturnValue({ data: { pipelineTables: [] }, mutate: mocks.mutate });
    openMenu();
    expect(screen.getByText(/No report-ready pipeline tables yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add FastQC/ })).toBeNull();
  });

  it("keeps a failed table build open for correction and retry", async () => {
    mocks.post.mockRejectedValue(new Error("Summary file is missing"));
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Add FastQC quality summary" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Summary file is missing"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add FastQC quality summary" }).hasAttribute("disabled")).toBe(false);
  });

  it("prevents duplicate builds while a request is in flight", async () => {
    let finish!: (value: unknown) => void;
    mocks.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    openMenu();
    const button = screen.getByRole("button", { name: "Add FastQC quality summary" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => finish({ dataset: { name: source.label }, version: { rowCount: 1, number: 1 }, warnings: [] }));
  });

  it("shows the single producing run without an unnecessary selector", () => {
    render(<PipelineTableSources scope={scope} sources={[{ ...source, runs: source.runs.slice(0, 1) }]} busy={false} onAdd={vi.fn()} />);
    expect(screen.getByText("FASTQC-NEW")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("drops stale run choices when eligible runs change", () => {
    const onAdd = vi.fn();
    const { rerender } = render(<PipelineTableSources scope={scope} sources={[source]} busy={false} onAdd={onAdd} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "run-selected" } });
    const refreshed = { ...source, runs: source.runs.slice(0, 1) };
    rerender(<PipelineTableSources scope={scope} sources={[refreshed]} busy={false} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Add FastQC quality summary" }));
    expect(onAdd).toHaveBeenCalledWith(refreshed, undefined);
  });

  it("inserts metadata directly into the page draft without navigation or an analysis", async () => {
    const onInsertBlock = vi.fn();
    mocks.post.mockResolvedValue({ dataset: { id: "samples-table", name: "Samples" }, version: { number: 1, rowCount: 1 }, warnings: [] });
    render(<AddDataMenu scope={scope} reportId="report" outputs={{ figures: [], tables: [], analyses: [] }} onInsertBlock={onInsertBlock} />);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add table to page" })[0]);
    await waitFor(() => expect(onInsertBlock).toHaveBeenCalledWith(expect.objectContaining({ id: "table:samples-table", type: "table", datasetId: "samples-table", download: true })));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0][0]).toBe("/api/explore/datasets/build");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("reuses a pipeline table already in the workspace, even when not on the page", async () => {
    const onInsertBlock = vi.fn();
    mocks.swr.mockReturnValue({ data: { outputs: [{ id: "custom:table", ...source, kind: "table", table: source, templates: [], runs: [{ id: "run", runNumber: "CUSTOM-001", usage: { datasetId: "existing", state: "workspace" }, files: [] }] }] }, mutate: mocks.mutate });
    render(<AddDataMenu scope={scope} reportId="report" outputs={{ figures: [], tables: [], analyses: [] }} onInsertBlock={onInsertBlock} />);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Pipeline outputs", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Add table to page" }));
    await waitFor(() => expect(onInsertBlock).toHaveBeenCalledWith(expect.objectContaining({ datasetId: "existing" })));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("opens a chart on the exact chosen saved pipeline data without running anything", async () => {
    const onInsertBlock = vi.fn();
    mocks.swr.mockReturnValue({ data: { outputs: [{ id: "custom:table", ...source, kind: "table", table: source, templates: [], runs: [{ id: "run", runNumber: "CUSTOM-001", usage: { datasetId: "existing", state: "workspace" }, files: [] }] }] }, mutate: mocks.mutate });
    mocks.fetch.mockResolvedValue({ dataset: { id: "existing", targetKey: scope, name: "Saved measurements", currentVersion: { number: 2, rowCount: 4 }, schema: { columns: [] } } });
    render(<AddDataMenu scope={scope} reportId="report" outputs={{ figures: [], tables: [], analyses: [] }} onInsertBlock={onInsertBlock} />);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Pipeline outputs", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Create chart" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Chart setup" })).toBeTruthy());
    expect(mocks.fetch).toHaveBeenCalledWith("/api/explore/datasets/existing");
    expect(onInsertBlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add chart to page" }));
    await waitFor(() => expect(onInsertBlock).toHaveBeenCalledWith(expect.objectContaining({ type: "chart", datasetId: "existing" })));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("adds a finished analysis figure without making an analysis or run", async () => {
    const onInsertBlock = vi.fn();
    render(<AddDataMenu scope={scope} reportId="report" onInsertBlock={onInsertBlock} outputs={{ tables: [], analyses: [], figures: [{ analysisId: "a1", analysisName: "Saved analysis", figureName: "distribution", runId: "r1", runNumber: "EXP-001", format: "plotly-json", url: "/saved", thumbnailUrl: null, unchanged: false }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Saved analysis results" }));
    fireEvent.click(screen.getByRole("button", { name: "Add figure to page" }));
    await waitFor(() => expect(onInsertBlock).toHaveBeenCalledWith(expect.objectContaining({ id: "figure:a1:distribution", type: "figure", analysisId: "a1", figureName: "distribution" })));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("offers file import inside the picker instead of navigating away from unsaved edits", () => {
    render(<AddDataMenu scope={scope} reportId="report" outputs={{ tables: [], analyses: [], figures: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Your files" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
    expect(screen.getByRole("dialog", { name: "Import a table" })).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps the active picker when its launch button moves between responsive panels", () => {
    const desktop = document.createElement("div");
    const mobile = document.createElement("div");
    document.body.append(desktop, mobile);
    try {
      const props = { scope, reportId: "report", outputs: { tables: [], analyses: [], figures: [] } };
      const { rerender, unmount } = render(<AddDataMenu {...props} triggerContainer={desktop} />);
      fireEvent.click(within(desktop).getByRole("button", { name: "Add", exact: true }));
      fireEvent.click(screen.getByRole("button", { name: "Your files", exact: true }));
      rerender(<AddDataMenu {...props} triggerContainer={null} />);
      expect(screen.getByRole("dialog", { name: "Add data" })).toBeTruthy();
      rerender(<AddDataMenu {...props} triggerContainer={mobile} />);
      expect(screen.getByRole("button", { name: "Your files", exact: true }).getAttribute("aria-pressed")).toBe("true");
      expect(within(desktop).queryByRole("button", { name: "Add", hidden: true })).toBeNull();
      expect(mobile.querySelectorAll("button")).toHaveLength(1);
      expect(mocks.post).not.toHaveBeenCalled();
      unmount();
    } finally { desktop.remove(); mobile.remove(); }
  });

  it("opens from an inline insertion control without adding data when cancelled", () => {
    const onOpenChange = vi.fn();
    const onInsertBlock = vi.fn();
    const props = { scope, reportId: "report", outputs: { tables: [], analyses: [], figures: [] }, onOpenChange, onInsertBlock };
    const { rerender } = render(<AddDataMenu {...props} open triggerContainer={null} />);
    const dialog = screen.getByRole("dialog", { name: "Add to page" });
    expect(dialog).toBeTruthy();
    expect(onInsertBlock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close", exact: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<AddDataMenu {...props} open={false} triggerContainer={null} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
