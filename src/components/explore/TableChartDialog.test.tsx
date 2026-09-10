// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartTable } from "@/lib/explore/report-source-actions";
const mocks = vi.hoisted(() => ({ swr: vi.fn(), add: vi.fn(), close: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.swr }));
vi.mock("./PlotlyChart", () => ({ PlotlyChart: () => <div>Live chart preview</div> }));
import { TableChartDialog } from "./TableChartDialog";
const table: ChartTable = { datasetId: "measurements", name: "User pipeline measurements", rowCount: 2, version: 1, columns: [{ key: "sample_id", label: "Sample", type: "string" }, { key: "quality", label: "Mean quality", type: "number", unit: "Phred" }] };
const frame = { datasetId: table.datasetId, version: 1, columns: table.columns, total: 2, truncated: false, rows: [{ sample_id: "S1", quality: 30 }, { sample_id: "S2", quality: 35 }] };
const props = { tables: [table], onAdd: mocks.add, onClose: mocks.close };
beforeEach(() => { vi.clearAllMocks(); mocks.swr.mockReturnValue({ data: frame }); mocks.add.mockResolvedValue(undefined); });
afterEach(cleanup);
describe("table-first chart builder", () => {
  it("asks for the source instead of silently selecting the first table", () => {
    render(<TableChartDialog {...props} />);
    expect((screen.getByRole("combobox", { name: "Source table" }) as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Add chart to page" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("uses the chosen source, human column names and units, and adds just one chart", async () => {
    render(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    fireEvent.click(screen.getByRole("button", { name: "Customize chart" }));
    expect(within(screen.getByRole("combobox", { name: "Measurement" })).getByRole("option", { name: "Mean quality (Phred)" })).toBeTruthy();
    expect(screen.getByText("Live chart preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add chart to page" }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ type: "chart", datasetId: "measurements", chart: "values", x: "sample_id", y: "quality" })));
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalled();
  });
  it("does nothing on cancellation", () => {
    render(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("rejects an older preview after the selected table changes", () => {
    render(<TableChartDialog {...props} tables={[{ ...table, version: 2 }]} initialDatasetId={table.datasetId} />);
    expect(screen.getByRole("alert").textContent).toContain("table changed");
    expect(screen.getByRole("button", { name: "Add chart to page" }).hasAttribute("disabled")).toBe(true);
  });
  it("shows missing values as unavailable instead of category counts", () => {
    mocks.swr.mockReturnValue({ data: { ...frame, rows: [{ sample_id: "S1", quality: null }] } });
    render(<TableChartDialog {...props} initialDatasetId={table.datasetId} initialChart="histogram" />);
    expect(screen.queryByText("Live chart preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Add chart to page" }).hasAttribute("disabled")).toBe(true);
  });
  it("explains why a nested-data table cannot be charted instead of drawing object counts", () => {
    const nested = { ...table, columns: [{ key: "data", label: "Nested data", type: "json" as const }] };
    mocks.swr.mockReturnValue({ data: { ...frame, columns: nested.columns, rows: [{ data: { value: 5 } }] } });
    render(<TableChartDialog {...props} tables={[nested]} initialDatasetId={table.datasetId} />);
    expect(screen.getByText(/no columns suitable for a chart/)).toBeTruthy();
    expect(screen.queryByText("Live chart preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Add chart to page" }).hasAttribute("disabled")).toBe(true);
  });
  it("keeps save conflicts visible without retrying or leaving the editor", async () => {
    mocks.add.mockRejectedValue(new Error("Report changed elsewhere"));
    render(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    fireEvent.click(screen.getByRole("button", { name: "Add chart to page" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("changed elsewhere"));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });
  it("guards rapid repeated clicks", async () => {
    let finish!: () => void;
    mocks.add.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    const button = screen.getByRole("button", { name: "Add chart to page" });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("previews suggestions without adding anything and saves the selected view on confirmation", async () => {
    render(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    expect(screen.getByRole("button", { name: "Compare values" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("combobox", { name: "Chart type" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See distribution" }));
    expect(screen.getByRole("button", { name: "See distribution" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Chart title" }) as HTMLInputElement).value).toBe("Distribution of Mean quality (Phred)");
    expect(mocks.add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add chart to page" }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ chart: "histogram", x: "quality", caption: "Distribution of Mean quality (Phred)" })));
  });

  it("keeps a custom title and manual settings across background refreshes", () => {
    const { rerender } = render(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chart title" }), { target: { value: "My quality comparison" } });
    fireEvent.click(screen.getByRole("button", { name: "See distribution" }));
    fireEvent.click(screen.getByRole("button", { name: "Customize chart" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Chart type" }), { target: { value: "bar" } });
    mocks.swr.mockReturnValue({ data: { ...frame, rows: [...frame.rows, { sample_id: "S3", quality: 39 }] } });
    rerender(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    expect((screen.getByRole("textbox", { name: "Chart title" }) as HTMLInputElement).value).toBe("My quality comparison");
    expect((screen.getByRole("combobox", { name: "Chart type" }) as HTMLSelectElement).value).toBe("bar");
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("respects an explicitly requested chart type", () => {
    render(<TableChartDialog {...props} initialDatasetId={table.datasetId} initialChart="histogram" />);
    expect((screen.getByRole("combobox", { name: "Chart type" }) as HTMLSelectElement).value).toBe("histogram");
    expect(screen.getByRole("button", { name: "See distribution" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("explains the row meaning and bounded suggestions", () => {
    mocks.swr.mockReturnValue({ data: { ...frame, rowEntity: "sample-taxon", truncated: true, total: 20000 } });
    render(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    expect(screen.getByText(/Each row represents: sample taxon/)).toBeTruthy();
    expect(screen.getByText(/Suggestions use the first 2 of 20,000 rows/)).toBeTruthy();
  });

  it("shows loading feedback and requires a nonempty title", () => {
    mocks.swr.mockReturnValue({ isLoading: true });
    const { rerender } = render(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    expect(screen.getByRole("status").textContent).toContain("Finding views");
    expect(screen.queryByRole("button", { name: "Compare values" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add chart to page" }).hasAttribute("disabled")).toBe(true);
    mocks.swr.mockReturnValue({ data: frame });
    rerender(<TableChartDialog {...props} initialDatasetId={table.datasetId} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chart title" }), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Add chart to page" }).hasAttribute("disabled")).toBe(true);
  });
});
