// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { LibraryFileSummary } from "@/lib/files/library-types";

const mocks = vi.hoisted(() => ({ query: "scope=study:s1&report=r1", files: [] as LibraryFileSummary[], fetch: vi.fn(), push: vi.fn(), replace: vi.fn(), mutate: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.query), useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/modules", () => ({ useModuleEnabled: () => true }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: mocks.mutate }),
  default: (key: string | null) => ({ mutate: mocks.mutate, data: !key ? undefined : key === "/api/files/library/scopes" ? { scopes: [{ targetKey: "study:s1", label: "Study one" }] }
    : key.startsWith("/api/explore/reports?") ? { reports: [{ id: "r1", title: "Report one" }] }
    : { files: mocks.files, canEdit: true } }),
}));
vi.mock("@/components/ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Context = createContext<{ value: string; onValueChange: (value: string) => void }>({ value: "", onValueChange: () => {} });
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => <Context.Provider value={{ value, onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ "aria-label": label }: { "aria-label": string }) => { const { value, onValueChange } = useContext(Context); return <input aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)} />; },
    SelectContent: () => null, SelectItem: () => null, SelectValue: () => null,
  };
});
import Page from "./page";

beforeEach(() => {
  vi.resetAllMocks(); mocks.query = "scope=study:s1&report=r1";
  mocks.files = ["one.pdf", "two.pdf"].map((originalName, index) => ({ id: `f${index + 1}`, originalName, targetKey: "study:s1", mimeType: "application/pdf", sizeBytes: 5, checksumSha256: "x", createdAt: "2026-09-10T12:00:00Z", canImportTable: false, datasets: [], reports: [] }));
  mocks.mutate.mockResolvedValue(undefined);
  mocks.replace.mockImplementation((href) => { mocks.query = href.split("?")[1]; });
  mocks.fetch.mockImplementation(async (_url, request) => {
    const { fileId } = JSON.parse(request.body);
    mocks.files = mocks.files.map((file) => file.id === fileId ? { ...file, reports: [{ id: "r1", title: "Report one", attached: true, usedInReport: false }] } : file);
    return { ok: true, json: async () => ({ linked: true }) };
  });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Files report context", () => {
  it("allows attaching multiple files without leaving the library and marks each attached", async () => {
    render(<Page />);
    const first = screen.getByText("one.pdf").closest("tr")!;
    fireEvent.click(within(first).getByRole("button", { name: "Attach to report" }));
    await waitFor(() => expect((within(first).getByRole("button", { name: "Attached" }) as HTMLButtonElement).disabled).toBe(true));
    const second = screen.getByText("two.pdf").closest("tr")!;
    fireEvent.click(within(second).getByRole("button", { name: "Attach to report" }));
    await waitFor(() => expect(within(second).getByRole("button", { name: "Attached" })).toBeTruthy());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Return to report" }).getAttribute("href")).toContain("/explore/reports/r1");
  });

  it("does not keep a previously selected report after Back removes it from the URL", () => {
    mocks.query = "scope=study:s1";
    const view = render(<Page />);
    fireEvent.change(screen.getByLabelText("Use files in report"), { target: { value: "r1" } });
    view.rerender(<Page />);
    expect(screen.getByRole("link", { name: "Return to report" })).toBeTruthy();
    mocks.query = "scope=study:s1";
    view.rerender(<Page />);
    expect(screen.queryByRole("link", { name: "Return to report" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach to report" })).toBeNull();
  });

  it("explains a deleted report while keeping the file library usable", () => {
    mocks.query = "scope=study:s1&report=deleted";
    render(<Page />);
    expect(screen.getByRole("alert").textContent).toContain("selected report is no longer available");
    expect(screen.getByRole("button", { name: "Upload files" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach to report" })).toBeNull();
  });
});
