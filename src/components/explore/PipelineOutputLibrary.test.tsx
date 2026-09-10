// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineOutputSource } from "@/lib/explore/pipeline-output-types";
const mocks = vi.hoisted(() => ({ swr: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.swr }));
import { PipelineOutputLibrary } from "./PipelineOutputLibrary";
const source: PipelineOutputSource = { id: "user-tool:measurement", pipelineId: "user-tool", pipelineName: "User tool", outputId: "measurement", label: "Measured values", kind: "table", description: "Measurements from the user's pipeline.",
  table: { pipelineId: "user-tool", pipelineName: "User tool", outputId: "measurement", label: "Measured values", tableKind: "custom", scope: "sample", format: "json", runs: [] },
  runs: [{ id: "run1", runNumber: "USER-001", completedAt: null, files: [{ id: "f1", name: "values.json", kind: "table", size: 100, sample: "Sample 1", previewable: true }] }], templates: [{ id: "generic", name: "Measurement overview", inputAlias: "measurements" }] };
const callbacks = { onAdd: vi.fn(), onTemplate: vi.fn() };
const props = { scope: "order:one", sources: [source], busy: false, ...callbacks };
beforeEach(() => { vi.clearAllMocks(); mocks.swr.mockReturnValue({ data: { columns: [{ key: "x", label: "Value", unit: "percent" }], rows: [{ x: 5 }], truncated: false } }); });
afterEach(cleanup);
describe("generic output library", () => {
  it("shows actions from output capabilities and pins the chosen run", () => {
    render(<PipelineOutputLibrary {...props} />);
    expect(screen.getByRole("region", { name: "User tool" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add table" }));
    expect(callbacks.onAdd).toHaveBeenCalledWith(source, "run1");
  });
  it("searches and filters without displaying missing results", () => {
    render(<PipelineOutputLibrary {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search pipeline outputs" }), { target: { value: "unrelated" } });
    expect(screen.getByRole("status").textContent).toContain("No outputs match");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "user tool" } });
    fireEvent.click(screen.getByRole("button", { name: "Reports", exact: true }));
    expect(screen.queryByRole("button", { name: "Add table" })).toBeNull();
  });
  it("offers installed matching templates without running anything", () => {
    render(<PipelineOutputLibrary {...props} />);
    fireEvent.click(screen.getByText(/Use in an analysis/));
    fireEvent.click(screen.getByRole("button", { name: "Measurement overview" }));
    expect(callbacks.onTemplate).toHaveBeenCalledWith(source, "run1", source.templates[0]);
    expect(callbacks.onAdd).not.toHaveBeenCalled();
  });
  it("shows bounded table previews with human labels and units", () => {
    render(<PipelineOutputLibrary {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview", exact: true }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("columnheader").textContent).toBe("Valuepercent");
    expect(within(dialog).getByText("5")).toBeTruthy();
  });
  it("renders safe report previews and download links", () => {
    const report: PipelineOutputSource = { ...source, kind: "report", table: undefined, templates: [], runs: [{ ...source.runs[0], files: [{ ...source.runs[0].files[0], kind: "report", name: "report.html" }] }] };
    render(<PipelineOutputLibrary {...props} sources={[report]} />);
    expect(screen.queryByRole("button", { name: "Add table" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview", exact: true }));
    expect(screen.getByTitle("report.html").getAttribute("sandbox")).toBe("allow-scripts");
    expect(screen.getByRole("link", { name: "Download original file" }).getAttribute("href")).toContain("mode=download");
  });
  it("shows preview errors and retry without hiding downloads", () => {
    mocks.swr.mockReturnValue({ error: new Error("Output file is missing"), mutate: vi.fn() });
    render(<PipelineOutputLibrary {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview", exact: true }));
    expect(screen.getByRole("alert").textContent).toContain("missing");
    expect(screen.getByRole("button", { name: "Retry preview" })).toBeTruthy();
  });
  it("disables mutations while a request is running", () => {
    render(<PipelineOutputLibrary {...props} busy />);
    expect(screen.getByRole("button", { name: "Add table" }).hasAttribute("disabled")).toBe(true);
  });
  it.each(["workspace", "report"] as const)("distinguishes %s membership and offers the existing table instead of another add", state => {
    render(<PipelineOutputLibrary {...props} sources={[{ ...source, runs: [{ ...source.runs[0], usage: { datasetId: "existing", state } }] }]} />);
    expect(screen.getByText(state === "report" ? "On report" : "In workspace · not on this report page")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add table" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open table" }).getAttribute("href")).toContain("/datasets/existing?");
  });
  it("allows adding an existing workspace table directly to the page", () => {
    const current = { ...source, runs: [{ ...source.runs[0], usage: { datasetId: "existing", state: "workspace" as const } }] };
    render(<PipelineOutputLibrary {...props} forReport sources={[current]} onChart={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add table to page" }));
    expect(callbacks.onAdd).toHaveBeenCalledWith(current, "run1");
    expect(screen.getByRole("button", { name: "Create chart" })).toBeTruthy();
    expect(screen.queryByText(/Create report content/)).toBeNull();
  });
  it("does not offer a duplicate table block but still allows a new chart", () => {
    const current = { ...source, runs: [{ ...source.runs[0], usage: { datasetId: "existing", state: "report" as const } }] };
    render(<PipelineOutputLibrary {...props} forReport sources={[current]} addedTableIds={new Set(["existing"])} onChart={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Table on page" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Create chart" }).hasAttribute("disabled")).toBe(false);
  });
});
