// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const enabled = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/modules", () => ({ useModuleEnabled: () => enabled.value }));
import { RawDataSources } from "./RawDataSources";
afterEach(() => { cleanup(); enabled.value = true; });
it("presents coexisting raw sources, without a separate application", () => {
  render(<RawDataSources />);
  expect(screen.getAllByRole("link").map(a => a.getAttribute("href"))).toEqual(["/orders/new?source=facility", "/orders/import?source=cami", "/orders/import?source=sra"]);
  expect(screen.getByRole("heading", { name: "Import module store" })).toBeTruthy();
  expect(screen.getAllByText("Bundled · Enabled")).toHaveLength(2);
  expect(screen.queryByText(/Canvas/)).toBeNull();
});
it("filters loaded modules without hiding the facility card or inventing new modules", () => {
  render(<RawDataSources />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search import modules" }), { target: { value: "CAMI" } });
  expect(screen.getByRole("heading", { name: "CAMI benchmark reads" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "SRA / ENA reads" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Facility sequencing" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "unsupported-module" } });
  expect(screen.getByRole("status").textContent).toContain("No loaded import modules match");
});
it("preserves the named collection when switching sources", () => {
  const collection = { key: "00e55dcb-9697-4b89-af56-af51bd557a17", name: "Marine & controls" };
  render(<RawDataSources collection={collection} />);
  for (const link of screen.getAllByRole("link")) {
    const query = new URL(link.getAttribute("href")!, "http://localhost").searchParams;
    expect(query.get("collection")).toBe(collection.key);
    expect(query.get("name")).toBe(collection.name);
  }
});
it("does not offer disabled modules as links", () => {
  enabled.value = false; render(<RawDataSources />);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(screen.getAllByRole("button", { name: "Disabled by administrator" })).toHaveLength(3);
});
