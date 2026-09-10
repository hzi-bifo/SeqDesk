// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableFileImportDialog } from "./TableFileImportDialog";
const request = vi.fn();
const imported = vi.fn();
const close = vi.fn();
const preview = { columns: ["sample", "value"], rows: [{ sample: "S1", value: 5 }], rowCount: 1, sheets: [], sheet: null, warnings: [], suggestedRoles: { sample: "sample" } };
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", request); imported.mockResolvedValue(undefined); request.mockResolvedValue(response(preview)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function open() {
  render(<TableFileImportDialog scope="order:one" onClose={close} onImported={imported} />);
  fireEvent.change(screen.getByLabelText("Table file"), { target: { files: [new File(["sample,value\nS1,5"], "table.csv", { type: "text/csv" })] } });
}
async function showPreview() { fireEvent.click(screen.getByRole("button", { name: "Preview file" })); await screen.findByRole("button", { name: "Import table", exact: true }); }
describe("in-editor table upload", () => {
  it("previews through the existing API without creating a table", async () => {
    open(); await showPreview();
    expect(request.mock.calls[0][0]).toBe("/api/explore/datasets/import?preview=1");
    const form = request.mock.calls[0][1].body as FormData;
    expect(form.get("targetKey")).toBe("order:one");
    expect(form.has("tableKind")).toBe(false);
    expect(imported).not.toHaveBeenCalled();
    expect(within(screen.getByRole("combobox", { name: "Sample column" })).getByRole("option", { name: "sample", exact: true })).toBeTruthy();
  });
  it("imports only on confirmation and refreshes without leaving the editor", async () => {
    open(); await showPreview();
    request.mockResolvedValue(response({ dataset: { id: "table", name: "Uploaded" } }));
    fireEvent.click(screen.getByRole("button", { name: "Import table", exact: true }));
    await waitFor(() => expect(imported).toHaveBeenCalledWith({ id: "table", name: "Uploaded" }));
    expect(request.mock.calls[1][0]).toBe("/api/explore/datasets/import");
    expect(JSON.parse(request.mock.calls[1][1].body.get("roles"))).toEqual({ sample: "sample" });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("never repeats a successful import after a picker refresh fails", async () => {
    open(); await showPreview();
    request.mockResolvedValue(response({ dataset: { id: "table", name: "Uploaded" } })); imported.mockRejectedValueOnce(new Error("Refresh failed"));
    fireEvent.click(screen.getByRole("button", { name: "Import table", exact: true }));
    await screen.findByRole("button", { name: "Refresh imported table" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh imported table" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(2);
    expect(imported).toHaveBeenCalledTimes(2);
  });
  it("does not retry an uncertain import response", async () => {
    open(); await showPreview(); request.mockRejectedValue(new Error("Connection lost"));
    fireEvent.click(screen.getByRole("button", { name: "Import table", exact: true }));
    await screen.findByText(/import may have succeeded/);
    expect(screen.getByRole("button", { name: "Import table", exact: true }).hasAttribute("disabled")).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("requires a fresh preview after changing the file", async () => {
    open(); await showPreview();
    fireEvent.change(screen.getByLabelText("Table file"), { target: { files: [new File(["name\nExample"], "second.csv")] } });
    expect(screen.queryByRole("button", { name: "Import table", exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: "Preview file" })).toBeTruthy();
  });
});
