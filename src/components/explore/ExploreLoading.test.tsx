// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExploreLoading, ReportLoadingLayout } from "./ExploreLoading";

afterEach(cleanup);

describe("shared report loading states", () => {
  it.each(["report", "cards", "table", "chart", "metric", "metrics", "canvas", "text"] as const)("announces %s once without exposing decorative data or controls", variant => {
    const { container } = render(<ExploreLoading variant={variant} label="Loading saved content…" />);
    const status = screen.getByRole("status", { name: "Loading saved content…" });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status.getAttribute("aria-busy")).toBe("true");
    const shapes = container.querySelectorAll('[data-slot="skeleton"]');
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(shape.classList.contains("motion-reduce:animate-none")).toBe(true);
    }
    expect(container.querySelectorAll("button, a, input, select, canvas, img, table")).toHaveLength(0);
  });

  it.each([320, "100%"])("reserves the caller's %s viewport height", height => {
    render(<ExploreLoading variant="chart" label="Loading chart…" height={height} className="my-3" />);
    const status = screen.getByRole("status");
    expect(status.style.height).toBe(typeof height === "number" ? `${height}px` : height);
    expect(status.classList.contains("my-3")).toBe(true);
  });

  it.each(["page", "canvas", "list"] as const)("supports the %s layout without edit controls or pipeline assumptions", view => {
    const { container } = render(<ReportLoadingLayout view={view} />);
    expect(screen.getByRole("status", { name: "Loading report…" })).toBeTruthy();
    expect(container.querySelector("[data-report-loading-sidebar]")).toBeNull();
    expect(container.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("reserves a desktop editor sidebar only when requested", () => {
    const { container } = render(<ReportLoadingLayout sidebar />);
    const sidebar = container.querySelector("[data-report-loading-sidebar]");
    expect(sidebar?.classList.contains("hidden")).toBe(true);
    expect(sidebar?.classList.contains("lg:block")).toBe(true);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("uses one placeholder for a single value rather than inventing multiple values", () => {
    const { container, rerender } = render(<ExploreLoading variant="metric" label="Loading value…" />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    rerender(<ExploreLoading variant="metrics" label="Loading values…" />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
  });
});
