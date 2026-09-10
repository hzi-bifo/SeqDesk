// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ImportProgress } from "./ImportProgress";
afterEach(cleanup);
it("shows actual download percentage rather than weighted job progress", () => {
  render(<ImportProgress status="running" phase="Downloading · 512 MiB / 1.00 GiB · 50.0% · ~1 min download remaining" />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
});
it("does not invent a percentage for extraction", () => {
  render(<ImportProgress status="running" phase="extracting read inputs" />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
});
it("stops animation at completion", () => {
  render(<ImportProgress status="success" phase="complete" />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("Ready — files validated")).toBeTruthy();
});
it("can put the progress bar before long text in compact sample cards", () => {
  render(<ImportProgress status="running" phase="Downloading · 512 MiB / 1.00 GiB · 50.0% · ~1 min download remaining" barFirst />);
  const bar = screen.getByRole("progressbar");
  expect(bar.parentElement?.firstElementChild).toBe(bar);
  expect(screen.getByText(/~1 min download remaining/)).toBeTruthy();
});
it.each([['cami', 'bg-teal-600'], ['sra', 'bg-sky-600']] as const)("keeps %s download progress in the module's color", (source, color) => {
  render(<ImportProgress source={source} status="running" phase="Downloading · 25.0%" />);
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("25");
  expect(bar.firstElementChild?.className).toContain(color);
  expect(bar.firstElementChild?.className).toContain("motion-reduce:transition-none");
});
