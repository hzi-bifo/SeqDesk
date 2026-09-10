// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const modules = vi.hoisted(() => ({ disabled: [] as string[] }));
vi.mock("@/lib/modules", () => ({ useModuleEnabled: (id: string) => !modules.disabled.includes(id) }));
import { RawDataSources } from "./RawDataSources";

afterEach(() => { cleanup(); modules.disabled = []; });

it("offers repository importers without presenting facility requests as imports", () => {
  render(<RawDataSources />);
  const store = within(screen.getByRole("region", { name: "Import module store" }));
  expect(store.getAllByRole("article")).toHaveLength(2);
  expect(store.queryByRole("article", { name: "Facility sequencing" })).toBeNull();
  expect(store.getAllByRole("link").map(a => a.getAttribute("href"))).toEqual([
    "/orders/import?source=cami", "/orders/import?source=sra",
  ]);
  expect(store.getAllByText("Enabled")).toHaveLength(2);
  expect(store.getAllByText("Included with SeqDesk")).toHaveLength(2);
  for (const name of ["CAMI benchmark reads", "SRA / ENA reads"]) {
    expect(store.getByRole("link", { name: `Open module: ${name}` })).toBeTruthy();
  }
  expect(store.getByRole("status").textContent).toBe("2 modules");
  expect(screen.queryByText(/Canvas/)).toBeNull();
});

it("searches repository modules without suggesting a facility request", () => {
  render(<RawDataSources />);
  const search = screen.getByRole("searchbox", { name: "Search import modules" });
  fireEvent.change(search, { target: { value: "CAMI" } });
  expect(screen.getByRole("heading", { name: "CAMI benchmark reads" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "SRA / ENA reads" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Facility sequencing" })).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("1 of 2 modules");
  fireEvent.change(search, { target: { value: "facility" } });
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(screen.getByRole("heading", { name: "No modules found" })).toBeTruthy();
});

it.each([
  ["Benchmarks", "CAMI benchmark reads"],
  ["Public repositories", "SRA / ENA reads"],
])("filters the store by %s", (category, title) => {
  render(<RawDataSources />);
  const filter = screen.getByRole("button", { name: category, exact: true });
  fireEvent.click(filter);
  expect(filter.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "All modules" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: title })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All modules" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
});

it("searches formats and metadata using case-insensitive words", () => {
  render(<RawDataSources />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  pAiReD   FaStQ  " } });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: "SRA / ENA reads" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "   " } });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByRole("status").textContent).toBe("2 modules");
});

it("combines search and category filters and clears them without navigation", () => {
  render(<RawDataSources />);
  fireEvent.click(screen.getByRole("button", { name: "Benchmarks" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "SRA" } });
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(screen.getByRole("heading", { name: "No modules found" })).toBeTruthy();
  expect(screen.getByText(/No modules match “SRA” in Benchmarks/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("0 of 2 modules");

  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("button", { name: "Benchmarks" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("article")).toHaveLength(1);

  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unsupported-module" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("button", { name: "All modules" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("article")).toHaveLength(2);
});

it("preserves the named collection when switching sources", () => {
  const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Marine & controls / Küste" };
  render(<RawDataSources collection={collection} orderId="imported-data-existing" />);
  for (const link of screen.getAllByRole("link")) {
    const query = new URL(link.getAttribute("href")!, "http://localhost").searchParams;
    expect(query.get("collection")).toBe(collection.key);
    expect(query.get("name")).toBe(collection.name);
    expect(query.get("orderId")).toBe("imported-data-existing");
  }
});

it.each([
  ["import-cami", "CAMI benchmark reads"],
  ["import-sra", "SRA / ENA reads"],
])("keeps a disabled %s module visible without a selectable link", (id, name) => {
  modules.disabled = [id];
  render(<RawDataSources />);
  const card = within(screen.getByRole("article", { name }));
  expect(card.getByText("Disabled")).toBeTruthy();
  expect(card.queryByRole("link")).toBeNull();
  expect((card.getByRole("button", { name: "Disabled by administrator" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: name } });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.queryByRole("link")).toBeNull();
});

it("does not offer disabled modules as links", () => {
  modules.disabled = ["sequencing-management", "import-cami", "import-sra"];
  render(<RawDataSources />);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Disabled by administrator" })).toHaveLength(2);
});
