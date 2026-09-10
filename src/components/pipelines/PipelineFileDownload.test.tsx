// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineFileDownload } from "./PipelineFileDownload";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ toast: { error: mocks.error } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("PipelineFileDownload", () => {
  it("downloads the file from its source run with encoded parameters, without opening row details", () => {
    const parent = vi.fn();
    const path = "/runs/report R1 & R2#résumé.html";
    render(<div onClick={parent}><PipelineFileDownload runId="run/1" path={path} label="R1 report" /></div>);
    const link = screen.getByRole("link", { name: "Download R1 report" });
    expect(link.getAttribute("href")).toBe(`/api/pipelines/runs/run%2F1/file?path=${encodeURIComponent(path)}&download=1`);
    expect(link.hasAttribute("download")).toBe(true);
    fireEvent.click(link);
    expect(parent).not.toHaveBeenCalled();
  });

  it("does not offer downloads without provenance or for unavailable/demo files", () => {
    const { rerender } = render(<PipelineFileDownload path="/report.html" label="Report" />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<PipelineFileDownload runId="run-1" path="/report.html" label="Report" disabled />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leaves sequencing-file downloads in Files when restricted to sample reports", () => {
    render(<PipelineFileDownload runId="run-1" path="/data/R1.fastq.gz" label="R1" reportsOnly />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("can display a text label in the report preview", () => {
    render(<PipelineFileDownload runId="run-1" path="/runs/report.html" label="R1 report" showLabel />);
    expect(screen.getByRole("link", { name: "Download R1 report" }).textContent).toBe("Download");
  });

  it("checks only the report before downloading and ignores repeated clicks during the check", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PipelineFileDownload runId="run-1" path="/runs/report.html" label="R1 report" verifyAvailability />);
    const link = screen.getByRole("link", { name: "Download R1 report" });
    fireEvent.click(link);
    fireEvent.click(link);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pipelines/runs/run-1/file?path=%2Fruns%2Freport.html&check=1");
    expect(click).not.toHaveBeenCalled();
    finish(new Response(JSON.stringify({ available: true }), { status: 200 }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([401, 404, 500])("does not download an error response when the report check returns %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Report unavailable" }), { status })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PipelineFileDownload runId="run-1" path="/runs/report.html" label="Report" verifyAvailability />);
    fireEvent.click(screen.getByRole("link", { name: "Download Report" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(click).not.toHaveBeenCalled();
  });
});
