// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { fetcher } from "@/lib/explore/client";
import type { ReportListResponse, ReportSummary } from "@/lib/explore/reports";
import { SidebarReportLink } from "./SidebarReportLink";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui/toast", () => ({ toast: { success: mocks.success, error: mocks.error } }));

const fetchMock = vi.fn();
const scope = "study:study-1";
const reportsKey = `/api/explore/reports?targetKey=${encodeURIComponent(scope)}`;
const report: ReportSummary = {
  id: "report-1", targetKey: scope, title: "Cohort report", analysisCount: 2,
  blockCount: 0, hasSuccessfulRun: true,
  createdAt: "2026-09-10T10:00:00Z", updatedAt: "2026-09-10T10:00:00Z",
};
const otherReport = { ...report, id: "report-2", title: "Other report" };
let serverReports: ReportSummary[];

function Reports({ canEdit = true, active = false }: { canEdit?: boolean; active?: boolean }) {
  const { data } = useSWR<ReportListResponse>(reportsKey, fetcher);
  return <>{data?.reports.map((entry) => (
    <SidebarReportLink key={entry.id} report={entry} scope={scope} active={active && entry.id === report.id} canEdit={canEdit} />
  ))}</>;
}

async function showReports(props: { canEdit?: boolean; active?: boolean } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false, shouldRetryOnError: false }}>
      <ConfirmDialogProvider><Reports {...props} /></ConfirmDialogProvider>
    </SWRConfig>
  );
  return screen.findByRole("link", { name: /Cohort report/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  serverReports = [report, otherReport];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const renamed = { ...report, title: JSON.parse(init.body as string).title };
      serverReports = [renamed, otherReport];
      return { ok: true, json: async () => ({ report: renamed }) };
    }
    if (init?.method === "DELETE") {
      serverReports = [otherReport];
      return { ok: true, json: async () => ({ deleted: true }) };
    }
    return { ok: true, json: async () => url === reportsKey ? { reports: serverReports, canEdit: true } : { report: serverReports[0] } };
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("report sidebar actions", () => {
  it("opens the right-click menu while preserving report navigation and its successful-run dot", async () => {
    const link = await showReports({ active: true });
    expect(link.getAttribute("href")).toBe("/explore/reports/report-1?scope=study%3Astudy-1");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.querySelector("span[aria-hidden]")?.className).toContain("bg-[#00BD7D]");
    fireEvent.contextMenu(link);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Open canvas" }).getAttribute("href")).toContain("mode=edit&view=canvas");
    expect(within(menu).getByRole("menuitem", { name: "Open in new tab" }).getAttribute("target")).toBe("_blank");
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Delete report" })).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("offers navigation without mutation actions when the report is read-only", async () => {
    const link = await showReports({ canEdit: false });
    fireEvent.contextMenu(link);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.queryByRole("menuitem", { name: "Delete report" })).toBeNull();
  });

  it("opens with the keyboard and closes with Escape", async () => {
    const link = await showReports();
    link.focus();
    fireEvent.keyDown(link, { key: "F10", shiftKey: true });
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for Cohort report" })));
  });

  it("renames through the actions button and updates the shared report list", async () => {
    await showReports();
    fireEvent.keyDown(screen.getByRole("button", { name: "Actions for Cohort report" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename report" });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("textbox", { name: "Report title" })));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Report title" }), { target: { value: "  Final report  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("link", { name: /Final report/ });
    expect(fetchMock).toHaveBeenCalledWith("/api/explore/reports/report-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "Final report" }) }));
    expect(screen.getByRole("link", { name: /Other report/ })).toBeTruthy();
    expect(mocks.success).toHaveBeenCalledWith("Report renamed");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for Final report" })));
  });

  it("cancels deletion without sending a delete request", async () => {
    const link = await showReports();
    fireEvent.contextMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete report" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Cohort report?" });
    expect(within(dialog).getByText(/2 analysis steps.*runs and outputs/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(screen.getByRole("link", { name: /Cohort report/ })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it.each([true, false])("deletes only the selected report after confirmation (active: %s)", async (active) => {
    const link = await showReports({ active });
    fireEvent.contextMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete report" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Cohort report?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete report" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Cohort report/ })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/explore/reports/report-1", expect.objectContaining({ method: "DELETE" }));
    expect(screen.getByRole("link", { name: /Other report/ })).toBeTruthy();
    if (active) expect(mocks.replace).toHaveBeenCalledWith("/explore?scope=study%3Astudy-1");
    else expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("keeps the report and current page when deletion fails", async () => {
    const link = await showReports({ active: true });
    fireEvent.contextMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete report" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Cohort report?" });
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Could not delete the report" }) });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete report" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Could not delete the report"));
    expect(screen.getByRole("link", { name: /Cohort report/ })).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
