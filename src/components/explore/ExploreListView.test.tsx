// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ swr: vi.fn(), tables: vi.fn(), analyses: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.swr }));
vi.mock("./AddDataMenu", () => ({ AddDataMenu: () => <button>Add table</button> }));
import { ExploreListView } from "./ExploreListView";

const saved = {
  datasets: [{ id: "table", name: "Saved measurements", kind: "external", tableKind: "sample-summary", sensitivity: "standard", updatedAt: "2026-09-10T00:00:00Z", currentVersion: { number: 1, rowCount: 3 } }],
  analyses: [{ id: "analysis", name: "Saved analysis", language: "python", kitId: null, latestRun: null, updatedAt: "2026-09-10T00:00:00Z" }],
};
beforeEach(() => { vi.clearAllMocks(); mocks.swr.mockReturnValue({}); });
afterEach(cleanup);

describe("report list loading", () => {
  it("waits for both independent requests instead of claiming there are no analysis steps", () => {
    render(<ExploreListView scope="order:test" reportId="report" />);
    expect(screen.getByRole("status", { name: "Loading tables…" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading analysis steps…" })).toBeTruthy();
    expect(screen.queryByText(/No tables yet/)).toBeNull();
    expect(screen.queryByText(/No analysis steps yet/)).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("shows the loaded table while waiting for analysis steps", () => {
    mocks.swr.mockImplementation((key: string) => key.includes("/datasets?") ? { data: saved } : {});
    const { rerender } = render(<ExploreListView scope="order:test" reportId="report" />);
    expect(screen.getByRole("link", { name: "Saved measurements" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading tables…" })).toBeNull();
    expect(screen.getByRole("status", { name: "Loading analysis steps…" })).toBeTruthy();
    mocks.swr.mockReturnValue({ data: saved });
    rerender(<ExploreListView scope="order:test" reportId="report" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("link", { name: "Saved analysis" })).toBeTruthy();
  });

  it("keeps loaded content during background refresh", () => {
    mocks.swr.mockReturnValue({ data: saved, isLoading: true, isValidating: true });
    render(<ExploreListView scope="order:test" reportId="report" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("link", { name: "Saved measurements" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Saved analysis" })).toBeTruthy();
  });

  it("only shows empty messages after successful empty responses", () => {
    mocks.swr.mockReturnValue({ data: { datasets: [], analyses: [] } });
    render(<ExploreListView scope="order:test" reportId="report" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/No tables yet/)).toBeTruthy();
    expect(screen.getByText(/No analysis steps yet/)).toBeTruthy();
  });

  it("offers independent retries on errors, not loading or empty states", () => {
    mocks.swr.mockImplementation((key: string) => ({ error: new Error("Request failed"), mutate: key.includes("/datasets?") ? mocks.tables : mocks.analyses }));
    render(<ExploreListView scope="order:test" reportId="report" />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/No tables yet/)).toBeNull();
    expect(screen.queryByText(/No analysis steps yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading tables" }));
    expect(mocks.tables).toHaveBeenCalledOnce();
    expect(mocks.analyses).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading analysis steps" }));
    expect(mocks.analyses).toHaveBeenCalledOnce();
  });
});
