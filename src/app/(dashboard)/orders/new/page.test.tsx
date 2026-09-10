// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ source: "", facility: true }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams({ source: state.source }) }));
vi.mock("@/lib/modules", () => ({ useModuleEnabled: () => state.facility }));
vi.mock("@/components/layout/PageContainer", () => ({ PageContainer: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/app/(dashboard)/orders/order-wizard-page", () => ({ OrderWizardPage: () => <div>Facility request form</div> }));
vi.mock("@/components/orders/SequencingDataImportFlow", () => ({ SequencingDataImportFlow: () => <div>New collection form</div> }));

import NewOrderPage from "./page";

afterEach(() => { cleanup(); state.source = ""; state.facility = true; });

it("keeps facility requests separate from collection creation", () => {
  render(<NewOrderPage />);
  expect(screen.getByText("New collection form")).toBeTruthy();
  expect(screen.queryByText("Facility request form")).toBeNull();
  expect(screen.getByRole("link", { name: "Request sequencing" }).getAttribute("href")).toBe("/orders/new?source=facility");
});

it("opens the facility request form only for an enabled explicit request", () => {
  state.source = "facility";
  render(<NewOrderPage />);
  expect(screen.getByText("Facility request form")).toBeTruthy();
  expect(screen.queryByText("New collection form")).toBeNull();
});

it("hides unavailable facility actions and explains an old facility link", () => {
  state.source = "facility";
  state.facility = false;
  render(<NewOrderPage />);
  expect(screen.getByRole("alert").textContent).toContain("not enabled");
  expect(screen.queryByRole("link", { name: "Request sequencing" })).toBeNull();
  expect(screen.queryByText("Facility request form")).toBeNull();
});
