// @vitest-environment jsdom
import { useState } from "react";
import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ desktop: true, listeners: new Set<() => void>(), replace: vi.fn(), report: vi.fn(), retry: vi.fn(), view: "page" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "report" }),
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams({ scope: "order:qa", mode: "edit", view: state.view }),
}));
vi.mock("swr", () => ({ default: (key: string) => key === "/api/explore/scopes"
  ? { data: { scopes: [{ targetKey: "order:qa", label: "Layout test", access: "write" }] } }
  : state.report() }));
vi.mock("@/components/explore/ExploreCanvas", () => ({ ExploreCanvas: () => null }));
vi.mock("@/components/explore/ExploreListView", () => ({ ExploreListView: () => null }));
// A stateful editor probe catches accidental remounts when the sidebar changes.
vi.mock("@/components/explore/ExploreReport", () => ({ ExploreReport: function EditorProbe({ actionsContainer, panelContainer }: { actionsContainer?: HTMLElement | null; panelContainer?: HTMLElement | null }) {
  const [changes, setChanges] = useState(0);
  return <>
    <button onClick={() => setChanges(value => value + 1)}>Make local edit</button>
    <span>Local edits: {changes}</span>
    {actionsContainer && createPortal(<button onClick={() => setChanges(value => Math.max(0, value - 1))}>Undo</button>, actionsContainer)}
    {panelContainer && createPortal(<button>Browse data</button>, panelContainer)}
  </>;
} }));

import ReportPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  state.view = "page";
  state.report.mockReturnValue({ data: { report: { id: "report", targetKey: "order:qa" } }, mutate: state.retry });
  state.desktop = true;
  state.listeners.clear();
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return state.desktop; },
    addEventListener: (_type: string, listener: () => void) => state.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => state.listeners.delete(listener),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function resize(desktop: boolean) { act(() => { state.desktop = desktop; for (const listener of state.listeners) listener(); }); }

it.each(["page", "canvas", "list"])("loads %s without briefly rendering actionable editor controls", view => {
  state.view = view;
  state.report.mockReturnValue({ isLoading: true });
  const { container } = render(<ReportPage />);
  expect(screen.getByRole("status", { name: "Loading report…" })).toBeTruthy();
  expect(Boolean(container.querySelector("[data-report-loading-sidebar]"))).toBe(view === "page");
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("replaces loading with the editor and does not remount it for revalidation", () => {
  state.report.mockReturnValue({ isLoading: true });
  const { rerender } = render(<ReportPage />);
  state.report.mockReturnValue({ data: { report: { id: "report", targetKey: "order:qa" } } });
  rerender(<ReportPage />);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Make local edit" }));
  state.report.mockReturnValue({ data: { report: { id: "report", targetKey: "order:qa" } }, isValidating: true, isLoading: true });
  rerender(<ReportPage />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("Local edits: 1")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Done", exact: true })).toHaveLength(1);
});

it("shows retry instead of an endless loading state when the report request fails", () => {
  state.report.mockReturnValue({ error: new Error("Connection lost"), mutate: state.retry });
  render(<ReportPage />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Connection lost");
  fireEvent.click(screen.getByRole("button", { name: "Retry loading report" }));
  expect(state.retry).toHaveBeenCalledOnce();
});

it("keeps Undo and Done in the main document header while the sidebar opens and closes", () => {
  render(<ReportPage />);
  const toolbar = screen.getByRole("group", { name: "Report toolbar" });
  const sidebar = screen.getByRole("complementary", { name: "Add to the page" });
  expect(within(sidebar).queryByRole("button", { name: "Done", exact: true })).toBeNull();
  expect(within(sidebar).queryByRole("button", { name: "Undo" })).toBeNull();
  expect(within(toolbar).getByRole("button", { name: "Done", exact: true })).toBeTruthy();
  expect(within(toolbar).getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Hide the panel" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Make local edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide the panel" }));
  expect(screen.getByText("Local edits: 1")).toBeTruthy();
  expect(screen.queryByRole("complementary", { name: "Add to the page" })).toBeNull();
  fireEvent.click(within(toolbar).getByRole("button", { name: "Undo" }));
  expect(screen.getByText("Local edits: 0")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Make local edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Show the panel" }));
  expect(screen.getByText("Local edits: 1")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  expect(within(toolbar).getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(within(screen.getByRole("complementary", { name: "Add to the page" })).queryByRole("button", { name: "Undo" })).toBeNull();
});

it("moves the open mobile drawer back into the desktop sidebar without hiding its contents or resetting edits", () => {
  state.desktop = false;
  render(<ReportPage />);
  fireEvent.click(screen.getByRole("button", { name: "Make local edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Open the panel" }));
  expect(within(screen.getByRole("dialog", { name: "Add to the page" })).getByRole("button", { name: "Browse data" })).toBeTruthy();
  resize(true);
  expect(screen.queryByRole("dialog", { name: "Add to the page" })).toBeNull();
  expect(within(screen.getByRole("complementary", { name: "Add to the page" })).getByRole("button", { name: "Browse data" })).toBeTruthy();
  expect(screen.getByText("Local edits: 1")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  resize(false);
  expect(screen.queryByRole("dialog", { name: "Add to the page" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open the panel" }));
  expect(within(screen.getByRole("dialog", { name: "Add to the page" })).getByRole("button", { name: "Browse data" })).toBeTruthy();
  expect(screen.getByText("Local edits: 1")).toBeTruthy();
});

it("focuses the mobile panel and closes it with Escape without losing local edits", async () => {
  state.desktop = false;
  render(<ReportPage />);
  fireEvent.click(screen.getByRole("button", { name: "Make local edit" }));
  const trigger = screen.getByRole("button", { name: "Open the panel", exact: true });
  trigger.focus();
  fireEvent.click(trigger);
  const drawer = screen.getByRole("dialog", { name: "Add to the page", exact: true });
  expect(drawer.getAttribute("aria-modal")).toBe("true");
  await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
  fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add to the page" })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.getByText("Local edits: 1")).toBeTruthy();
});

it("contains sidebar scrolling so reaching its end does not scroll the document", () => {
  render(<ReportPage />);
  const sidebar = screen.getByRole("complementary", { name: "Add to the page" });
  const scroller = sidebar.querySelector('[class*="overflow-y-auto"]');
  expect(scroller?.classList.contains("overscroll-contain")).toBe(true);
});
