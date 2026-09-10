// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportGeneration } from "@/lib/explore/report-generation";
const mocks = vi.hoisted(() => ({ swr: vi.fn(), post: vi.fn(), mutate: vi.fn(), changed: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.swr }));
vi.mock("@/lib/explore/client", () => ({ fetcher: vi.fn(), postJson: mocks.post }));
import { ReportGenerationPanel } from "./ReportGenerationPanel";
const generation: ReportGeneration = { analysisId: "a1", name: "Measurement overview", status: "completed", runId: "run1", runNumber: "EXP-1", createdAt: "2026-09-09T17:00:00.000Z", warnings: [], notes: [], addedIds: [], items: [{ label: "Value distribution", block: { id: "figure:a1:values", type: "figure", analysisId: "a1", figureName: "values" } }, { label: "Table", block: { id: "table:d1", type: "table", datasetId: "d1" } }] };
const props = { scope: "order:o1", reportId: "r1", updatedAt: "2026-09-09T17:00:00.000Z", canEdit: true, onChanged: mocks.changed };
function data(value: ReportGeneration) { mocks.swr.mockReturnValue({ data: { generations: [value] }, mutate: mocks.mutate }); }
beforeEach(() => { vi.clearAllMocks(); data(generation); mocks.post.mockResolvedValue({ added: 1 }); });
afterEach(cleanup);
describe("report generation progress", () => {
  it("restores active progress after mounting without starting another run", () => {
    data({ ...generation, status: "running", items: [] });
    render(<ReportGenerationPanel {...props} />);
    expect(screen.getByRole("status").textContent).toContain("You can leave this page");
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("adds only reviewed items against the visible report version", async () => {
    render(<ReportGenerationPanel {...props} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Table" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 item to report" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/explore/reports/r1/generations/a1", { action: "add", itemIds: ["figure:a1:values"], expectedUpdatedAt: props.updatedAt }));
  });
  it("does not automatically retry a conflicting append and retains the selection", async () => {
    mocks.post.mockRejectedValue(new Error("The report changed in another tab. Review the refreshed page."));
    render(<ReportGenerationPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add 2 items to report" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("another tab"));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.changed).toHaveBeenCalledOnce();
  });
  it("shows a completed added state without offering duplicates", () => {
    data({ ...generation, addedIds: generation.items.map(item => item.block.id) });
    render(<ReportGenerationPanel {...props} />);
    expect(screen.getByText("Added to report")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add.*to report/ })).toBeNull();
  });
  it.each(["failed", "cancelled", "edited"])("does not offer items from %s generation", status => {
    data({ ...generation, status, items: [] });
    render(<ReportGenerationPanel {...props} />);
    expect(screen.queryByRole("button", { name: /Add.*to report/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Open analysis and outputs" })).toBeTruthy();
  });
  it("does not offer mutations to a read-only user", () => {
    render(<ReportGenerationPanel {...props} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /Add.*to report/ })).toBeNull();
    expect(screen.getAllByRole("checkbox").every(input => input.hasAttribute("disabled"))).toBe(true);
  });
});
