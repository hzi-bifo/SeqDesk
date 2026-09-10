// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileUploadPanel } from "./FileUploadPanel";

const fetchMock = vi.fn();
const onSaved = vi.fn();
const onBusyChange = vi.fn();
const onStart = vi.fn();
const props = { targetKey: "study:s1", onSaved, onStart, onBusyChange };
const response = (status: number, error?: string) => ({ ok: status < 400, status, json: async () => ({ error, file: { id: "f1" } }) });
function choose(files: File[]) { fireEvent.change(screen.getByLabelText("Choose files to upload"), { target: { files } }); }

beforeEach(() => { vi.resetAllMocks(); onSaved.mockResolvedValue(undefined); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("file upload recovery", () => {
  it("retains every result and retries only the failed upload", async () => {
    fetchMock.mockResolvedValueOnce(response(201)).mockResolvedValueOnce(response(503, "Storage temporarily unavailable")).mockResolvedValueOnce(response(201)).mockResolvedValueOnce(response(201));
    render(<FileUploadPanel {...props} />);
    choose([new File(["a"], "one.csv"), new File(["b"], "two.pdf"), new File(["c"], "three.json")]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("2 saved · 1 failed · 3 total"));
    expect(screen.getByText("Storage temporarily unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Uploads finished. 3 saved · 3 total"));
    expect(fetchMock.mock.calls.map(([, request]) => request.body.get("file").name)).toEqual(["one.csv", "two.pdf", "three.json", "two.pdf"]);
    expect(onSaved).toHaveBeenCalledTimes(3);
  });

  it("continues past an oversized file and shows an actionable size error", async () => {
    const tooLarge = new File(["large"], "large.dat");
    Object.defineProperty(tooLarge, "size", { value: 100 * 1024 * 1024 + 1 });
    fetchMock.mockResolvedValue(response(201));
    render(<FileUploadPanel {...props} />);
    choose([tooLarge, new File(["ok"], "small.txt")]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Uploads finished. 1 saved · 1 failed"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Larger than 100 MB. Choose a smaller file.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry failed" })).toBeNull();
  });

  it("accepts dropped files and preserves success when refreshing the list fails", async () => {
    fetchMock.mockResolvedValue(response(201)); onSaved.mockRejectedValue(new Error("Refresh failed"));
    render(<FileUploadPanel {...props} />);
    fireEvent.drop(screen.getByText("Drop files here or choose them from your computer"), { dataTransfer: { files: [new File(["data"], "dropped.txt")] } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Uploads finished. 1 saved · 1 total"));
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("stops the remaining batch when the page is left", async () => {
    fetchMock.mockImplementation((_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const view = render(<FileUploadPanel {...props} />);
    choose([new File(["a"], "first.txt"), new File(["b"], "second.txt")]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1].signal;
    view.unmount();
    await waitFor(() => expect(signal.aborted).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("explains a non-JSON proxy rejection instead of showing a parsing error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413, json: async () => { throw new Error("Unexpected token <"); } });
    render(<FileUploadPanel {...props} />);
    choose([new File(["data"], "file.dat")]);
    await waitFor(() => expect(screen.getByText("The server rejected this file as too large.")).toBeTruthy());
    expect(screen.queryByText(/Unexpected token/)).toBeNull();
  });
});
