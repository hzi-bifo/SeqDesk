// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportImage } from "./ReportImage";

beforeEach(() => { vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("report image loading", () => {
  it("holds the figure's height until its image loads", () => {
    const { container } = render(<ReportImage src="/saved/figure.png" alt="Saved figure" height={240} />);
    const viewport = container.firstElementChild as HTMLElement;
    expect(viewport.style.height).toBe("240px");
    expect(viewport.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status", { name: "Loading Saved figure…" })).toBeTruthy();
    const image = screen.getByRole("img", { name: "Saved figure" });
    expect(image.classList.contains("opacity-0")).toBe(true);
    fireEvent.load(image);
    expect(screen.queryByRole("status")).toBeNull();
    expect(viewport.getAttribute("aria-busy")).toBeNull();
    expect(image.classList.contains("opacity-0")).toBe(false);
    expect(viewport.style.height).toBe("240px");
  });

  it("replaces a failed image with a useful error instead of an endless skeleton", () => {
    render(<ReportImage src="/saved/figure.svg" alt="Saved figure" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Could not load the image");
    expect(screen.getByRole("link", { name: "Open original" }).getAttribute("href")).toBe("/saved/figure.svg");
  });

  it("loads each new URL independently and ignores events from a replaced image", () => {
    const { rerender } = render(<ReportImage src="/saved/first.png" alt="Saved figure" />);
    const first = screen.getByRole("img");
    fireEvent.load(first);
    rerender(<ReportImage src="/saved/second.png" alt="Saved figure" />);
    expect(screen.getByRole("status")).toBeTruthy();
    const second = screen.getByRole("img");
    expect(second).not.toBe(first);
    fireEvent.error(first);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.load(second);
    fireEvent.load(first);
    expect(screen.queryByRole("status")).toBeNull();
    expect(second.classList.contains("opacity-0")).toBe(false);
  });

  it("clears a previous error when changing the image URL", () => {
    const { rerender } = render(<ReportImage src="/saved/broken.png" alt="Figure" />);
    fireEvent.error(screen.getByRole("img"));
    rerender(<ReportImage src="/saved/other.png" alt="Figure" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.load(screen.getByRole("img"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([0, 640])("handles an image already completed before handlers attached (width %s)", naturalWidth => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(naturalWidth);
    render(<ReportImage src="/saved/cached.png" alt="Figure" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(Boolean(screen.queryByRole("alert"))).toBe(naturalWidth === 0);
    expect(screen.getByRole("img").classList.contains("opacity-0")).toBe(naturalWidth === 0);
  });
});
