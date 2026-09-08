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
