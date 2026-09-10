// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ query: "scope=study:s1&file=first", fetch: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.query), useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("swr", () => ({ default: (key: string) => ({ data: { file: { id: key.split("/").pop(), originalName: "source.xlsx", targetKey: "study:s1", canImportTable: true } } }) }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Context = createContext<{ value: string; onValueChange: (value: string) => void; label?: string }>({ value: "", onValueChange: () => {} });
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => <Context.Provider value={{ value, onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ "aria-label": label }: { "aria-label": string }) => { const { value, onValueChange } = useContext(Context); return <input aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)} />; },
    SelectContent: () => null, SelectItem: () => null, SelectValue: () => null,
  };
});
import Page from "./page";

function preview(columns = ["sample", "count"], sheet = "Sheet1") {
  return { fileName: "source.xlsx", columns, rows: [Object.fromEntries(columns.map((key) => [key, "example"]))], rowCount: 1, sheets: ["Sheet1", "Sheet2"], sheet, suggestedRoles: { sample: columns[0] }, warnings: [] };
}
const respond = (data: unknown) => ({ ok: true, json: async () => data });
beforeEach(() => { mocks.query = "scope=study:s1&file=first"; vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("source table preparation", () => {
  it("resets the preview and table name when navigation selects another source file", async () => {
    mocks.fetch.mockResolvedValue(respond(preview()));
    const view = render(<Page />);
    fireEvent.change(screen.getByLabelText("Table name"), { target: { value: "First table" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Use as table" }) as HTMLButtonElement).disabled).toBe(false));
    mocks.query = "scope=study:s1&file=second";
    view.rerender(<Page />);
    expect((screen.getByLabelText("Table name") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Use as table" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("requires a fresh preview after changing worksheets and drops old column mappings", async () => {
    mocks.fetch.mockResolvedValueOnce(respond(preview())).mockResolvedValueOnce(respond(preview(["specimen", "amount"], "Sheet2")));
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByLabelText("Worksheet")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Count column"), { target: { value: "count" } });
    fireEvent.change(screen.getByLabelText("Worksheet"), { target: { value: "Sheet2" } });
    expect((screen.getByRole("button", { name: "Use as table" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("Worksheet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect((screen.getByLabelText("Sample column") as HTMLInputElement).value).toBe("specimen"));
    expect((screen.getByLabelText("Count column") as HTMLInputElement).value).toBe("__none__");
  });

  it("sends an explicitly cleared suggested role and requires a new preview for grammar changes", async () => {
    mocks.fetch.mockResolvedValueOnce(respond(preview())).mockResolvedValueOnce(respond({ dataset: { id: "d1", name: "Test" } }));
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByLabelText("Sample column")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Expand INDIVO sample ids"));
    expect((screen.getByRole("button", { name: "Use as table" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Expand INDIVO sample ids"));
    fireEvent.change(screen.getByLabelText("Sample column"), { target: { value: "__none__" } });
    fireEvent.click(screen.getByRole("button", { name: "Use as table" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body.get("roles"))).toMatchObject({ sample: "" });
  });
});
