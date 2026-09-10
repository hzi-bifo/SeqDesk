// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ useSWR: vi.fn(), mutate: vi.fn() }));
vi.mock("swr", () => ({ default: mocks.useSWR }));
import { PipelineReportPreview } from "./PipelineReportPreview";
const file = { runId: "run-1", path: "/runs/report.html", label: "R1 report" };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("PipelineReportPreview", () => {
  it("shows a skeleton until the report availability check finishes", () => {
    mocks.useSWR.mockReturnValue({ isLoading: true, mutate: mocks.mutate });
    render(<PipelineReportPreview file={file} onClose={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Checking report availability");
    expect(screen.queryByTitle("R1 report")).toBeNull();
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  });

  it("offers retry rather than a broken iframe when the report is unavailable", () => {
    mocks.mutate.mockResolvedValue(undefined);
    mocks.useSWR.mockReturnValue({ error: new Error("File missing"), mutate: mocks.mutate });
    render(<PipelineReportPreview file={file} onClose={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("File missing");
    fireEvent.click(screen.getByRole("button", { name: "Retry report" }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle("R1 report")).toBeNull();
  });

  it("opens an available report and can close via the accessible dialog control", () => {
    const close = vi.fn();
    mocks.useSWR.mockReturnValue({ data: { available: true }, mutate: mocks.mutate });
    render(<PipelineReportPreview file={file} onClose={close} />);
    expect(screen.getByTitle("R1 report").getAttribute("src")).toBe("/api/files/preview?path=%2Fruns%2Freport.html");
    expect(screen.getByRole("link", { name: "Download R1 report" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
