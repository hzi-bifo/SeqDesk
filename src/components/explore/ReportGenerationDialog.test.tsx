// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExploreDatasetSummary } from "@/lib/explore/types";
const mocks = vi.hoisted(() => ({ swr: vi.fn(), post: vi.fn(), started: vi.fn(), retry: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.swr }));
vi.mock("@/lib/explore/client", () => ({ fetcher: vi.fn(), postJson: mocks.post }));
import { ReportGenerationDialog } from "./ReportGenerationDialog";
const dataset = { id: "d1", name: "Saved measurements", tableKind: "custom", roles: {}, schema: { columns: [{ key: "value", type: "number", label: "Value" }] }, currentVersion: { id: "v1", number: 1, rowCount: 3 } } as ExploreDatasetSummary;
const kit = { id: "custom-template", name: "Measurement overview", description: "A generic overview", environment: "python", inputs: [{ alias: "data", label: "Measurements", requiredRoles: [], requiredColumns: { value: { type: "number" } } }], outputs: [{ name: "histogram", label: "Value distribution", kind: "figure" }, { name: "table", label: "Measurements", kind: "table" }] };
const props = { scope: "order:o1", reportId: "r1", kitId: kit.id, inputAlias: "data", dataset, onClose: vi.fn(), onStarted: mocks.started };
function setup(ready = true, rows = [dataset]) {
  mocks.swr.mockImplementation((key: string) => ({ data: key === "/api/explore/kits" ? { kits: [kit] } : key === "/api/explore/environments" ? { environments: [{ name: "python", status: ready ? "ready" : "missing" }] } : { datasets: rows }, mutate: mocks.retry }));
}
beforeEach(() => { vi.clearAllMocks(); setup(); mocks.post.mockResolvedValue({ analysisId: "a1" }); });
afterEach(cleanup);
describe("guided report setup", () => {
  it("shows expected outputs and pinned compatible inputs without running anything", () => {
    render(<ReportGenerationDialog {...props} />);
    expect(screen.getByText(/1 chart · 1 table/)).toBeTruthy();
    expect(screen.getByText("Value distribution")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("d1");
    expect(screen.getByText(/Saved version 1/)).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("generates only on explicit confirmation and sends the reviewed version", async () => {
    render(<ReportGenerationDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate report content" }));
    await waitFor(() => expect(mocks.started).toHaveBeenCalledOnce());
    expect(mocks.post).toHaveBeenCalledWith("/api/explore/reports/r1/generations", expect.objectContaining({ kitId: kit.id, inputs: [{ alias: "data", datasetId: "d1", versionId: "v1" }] }));
  });
  it("reuses the request identity after an uncertain response", async () => {
    mocks.post.mockRejectedValueOnce(new Error("Connection lost"));
    render(<ReportGenerationDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate report content" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Connection lost"));
    fireEvent.click(screen.getByRole("button", { name: "Generate report content" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[0][1].requestId).toBe(mocks.post.mock.calls[1][1].requestId);
  });
  it("guards double clicks during launch", async () => {
    let finish!: (value: unknown) => void;
    mocks.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<ReportGenerationDialog {...props} />);
    const button = screen.getByRole("button", { name: "Generate report content" });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.post).toHaveBeenCalledOnce();
    await act(async () => finish({ analysisId: "a1" }));
  });
  it("shows why software is unavailable without offering automatic installation", () => {
    setup(false);
    render(<ReportGenerationDialog {...props} />);
    expect(screen.getByRole("alert").textContent).toContain("Nothing will be installed automatically");
    expect(screen.getByRole("button", { name: "Generate report content" }).hasAttribute("disabled")).toBe(true);
  });
  it("disables incompatible tables with a reason and never substitutes a requested source", () => {
    const bad = { ...dataset, id: "bad", name: "Wrong units", schema: { columns: [] } };
    setup(true, [dataset, bad]);
    render(<ReportGenerationDialog {...props} dataset={bad} />);
    expect(screen.getByRole("option", { name: /Wrong units.*value/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Generate report content" }).hasAttribute("disabled")).toBe(true);
  });
  it("does not silently switch to a newer version on refresh", () => {
    const { rerender } = render(<ReportGenerationDialog {...props} />);
    setup(true, [{ ...dataset, currentVersion: { ...dataset.currentVersion!, id: "v2", number: 2 } }]);
    rerender(<ReportGenerationDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate report content" }));
    expect(mocks.post.mock.calls[0][1].inputs[0].versionId).toBe("v1");
  });
  it("keeps loading and session failure distinct from empty inputs", () => {
    mocks.swr.mockReturnValue({ mutate: mocks.retry });
    const { rerender } = render(<ReportGenerationDialog {...props} />);
    expect(screen.getByRole("status").textContent).toContain("Checking templates");
    mocks.swr.mockReturnValue({ error: new Error("Unauthorized"), mutate: mocks.retry });
    rerender(<ReportGenerationDialog {...props} />);
    expect(screen.getByRole("alert").textContent).toContain("Unauthorized");
    fireEvent.click(screen.getByRole("button", { name: "Retry setup" }));
    expect(mocks.retry).toHaveBeenCalledTimes(3);
  });
});
