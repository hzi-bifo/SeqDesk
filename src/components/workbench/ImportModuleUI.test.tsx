// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ImportModuleHeader, ImportStepHeading, importModuleTheme } from "./ImportModuleUI";
import { dataSourceModuleCatalog } from "@/lib/modules/import-catalog";

afterEach(cleanup);

it.each(dataSourceModuleCatalog.map(module => module.source))("keeps the %s module header consistent with its store theme", source => {
  const theme = importModuleTheme[source];
  render(<ImportModuleHeader source={source} title="Module title" titleId="module-title" description="Source metadata is included."><span>Supported reads</span></ImportModuleHeader>);
  const heading = screen.getByRole("heading", { level: 2, name: "Module title" });
  expect(heading.id).toBe("module-title");
  expect(heading.closest("header")?.className).toContain(theme.surface);
  expect(screen.getByText(new RegExp(theme.category))).toBeTruthy();
  expect(screen.getByText("Supported reads")).toBeTruthy();
  expect(screen.getByText("Source metadata is included.")).toBeTruthy();
});

it("labels import sections without adding decorative numbers to their accessible names", () => {
  render(<ImportStepHeading source="cami" step={2} title="Samples" />);
  expect(screen.getByRole("heading", { level: 3, name: "Samples" })).toBeTruthy();
  expect(screen.getByText("2").getAttribute("aria-hidden")).toBe("true");
});
